---
title: "基于 Push 模式的 GitOps 管理个人 k3s 集群"
description: "Manage a k3s cluster as code with push-based GitOps"
date: 2026-06-21
updatedDate: 2026-10-10
authors:
  - lkw123
draft: false
tags:
  - gitops
  - k3s
  - kubernetes
ai: true
---

在上一篇[通过 Komodo + Renovate 构建 Docker Compose GitOps 流水线](/blog/komodo-gitops)中，我记录了单机 Docker Compose 的自动部署方案：宿主机上运行 Komodo 监听 Webhook 拉取仓库，配合 Renovate 自动发起镜像更新 PR。

后来我把一部分自建服务迁到了一个四节点的 k3s 集群：Oracle Cloud 上的 1 台 `arm64` 实例作为控制面（server）、2 台 `amd64` 实例作为工作节点（agent），外加 1 台腾讯云新加坡节点，四台机器通过 Tailscale 跨云组网。

在 Kubernetes 生态中，主流的 GitOps 实践通常使用 Argo CD 或 Flux 这类 Pull 模式工具，由集群内的控制器主动拉取 Git 仓库并持续同步。但对于只有四个节点、单人维护的小集群，我选择了更轻量的 **Push 模式**：Git 仓库依然是声明式配置的唯一来源，但集群内部不运行任何常驻同步控制器，所有变更都由本地控制机通过命令直接推送到集群。

## 为什么在小集群上选择 Push 模式

Pull 模式和 Push 模式的核心差异，在于由谁发起同步，以及凭据存放在哪里：

| 对比维度 | Pull 模式（Argo CD / Flux） | 本文的 Push 模式 |
| :--- | :--- | :--- |
| **同步发起方** | 集群内常驻 Controller，持续轮询或接收 Webhook | 本地控制机，按需执行 `make` 命令 |
| **集群是否访问 Git** | 是，集群需持有 Git 仓库的读取凭据 | 否，集群无需感知 Git 仓库的存在 |
| **密钥与解密位置** | 集群内运行解密组件（如 Sealed Secrets、SOPS 插件） | `kubeconfig`、SSH 密钥与 `age` 私钥均留在本地控制机 |
| **配置漂移（Drift）处理** | Controller 自动比对并覆盖线上手工改动 | 本地运行 `make diff` 检查差异，人工决定如何处理 |
| **配置合法性拦截** | 集群侧 Controller 或 Admission Webhook | 推送前在本地与 CI 阶段执行 `make lint` |

在多人协作或微服务众多的大型集群里，Pull 模式的自动收敛能防止线上配置被随意篡改。但在个人维护的四节点小集群上，Push 模式有几个很实在的好处：

1. **节省集群资源与维护成本**：k3s 本身非常轻量，不额外部署 Argo CD 等常驻组件，就能省下一截内存开销，也少了一套需要定期升级和排障的控制面依赖。
2. **收敛凭据暴露面**：集群内部不保存任何连向 GitHub 的 Token，也不存放解密私钥。即便某个集群节点出现安全问题，攻击者也拿不到代码仓库权限和未挂载的敏感配置，配置仓库本身也可以放心设为公开。
3. **排错链路直接**：模板渲染、密钥解密和配置下发全部在本地终端完成，执行报错时直接看命令行输出即可，不需要去排查控制器的异步对账状态。

相应地，去掉集群内的控制器之后，原本由控制器承担的**配置漂移检查**和**下发前语法校验**，就需要靠仓库目录约定、`Makefile` 和 CI 工具链自己补齐。

## 目录结构与下发方式

在 Pull 模式下，各类资源统一由集群内的控制器识别并应用；而在 Push 模式下，需要明确规定每种配置用什么命令下发。仓库通过顶层目录来区分管理机制：

| 仓库路径 | 管理机制 | 下发命令 |
| :--- | :--- | :--- |
| `apps/<name>/` | Kustomize | `kubectl apply -k apps/<name>/` |
| `apps/multica/values.yaml` 等 | Helm | `helm upgrade --install <release> <chart> -f values.yaml` |
| `platform/cert-manager/` 等 | Helm + 原生清单 | 先执行 `helm upgrade`，再执行 `kubectl apply -f` |
| `platform/traefik/traefik-helmchartconfig.yaml` | k3s Auto-deploy | 通过 `scp` 写入主节点的 `/var/lib/rancher/k3s/server/manifests/` |
| `node-config/<node>.config.yaml` | k3s 节点进程配置 | 渲染后通过 SSH 写入 `/etc/rancher/k3s/config.yaml` 并重启服务 |

目前集群的 `platform/` 层跑着三样基础组件：k3s 自带的 Traefik 作为公网入口网关、cert-manager 通过 Cloudflare DNS-01 自动签发 Let's Encrypt 证书、Headlamp 提供 Web 仪表盘；`apps/` 层运行着 `wallos`、`multica`、`supabase` 等业务应用（新增服务时直接从 `templates/service-with-tls` 模板目录复制修改，里面备好了全套 Namespace、Deployment、Service 与 Ingress）。

表格中前三种路径走的都是标准的 `kubectl` 和 `helm`，而后两种底层配置虽然也是 YAML 文件，却不能通过 `kubectl apply` 下发：

- **Traefik 自定义配置**：k3s 默认通过内置的 `HelmChartConfig` 管理自带的 Traefik，并持续监听 server 节点的 `/var/lib/rancher/k3s/server/manifests/` 目录。因此修改 Traefik 配置的方式是把文件 `scp` 到控制面节点的该目录下，由 k3s 自动检测并热加载。
- **节点级参数（`node-config/`）**：跨云通过 Tailscale 组网时，每个节点都需要在启动参数里显式声明自己的公网 IP（`node-external-ip`）与 Flannel 网卡。这类配置属于宿主机上 `k3s` 或 `k3s-agent` 守护进程的启动配置文件，处在 Kubernetes API 之下，只能通过 SSH 写入节点文件并重启系统服务生效。

为了不用每次手敲长串参数，仓库用 `Makefile` 把这些下发动作和初始化顺序封装成了固定指令：

```bash
make app APP=wallos       # 应用 apps/wallos/ 下的 Kustomize 清单
make multica              # 更新 multica 的 Helm Release、证书与备份 CronJob
make traefik              # 将 Traefik HelmChartConfig 同步至主节点
make node-config NODE=sg  # 渲染新加坡节点的 k3s 配置，经 SSH 写入并重启 k3s-agent
make platform             # 按依赖顺序初始化平台层组件
```

组件之间的先后依赖也固化在 `make platform` 中：先创建 Cloudflare API Token 的 Secret，再安装 cert-manager 并等待 CRD 就绪后下发 `ClusterIssuer`，最后部署 Headlamp 和 Traefik。这样隔了半年重装集群时，也不需要凭记忆去试先后顺序。

## 状态对账与前置校验

没有常驻控制器自动纠偏，Push 模式最容易出现的问题就是本地仓库代码和集群实际状态慢慢脱节。为了保证仓库始终反映线上真实状态，主要靠两条机制配合。

### 本地对账：make diff

首先在目录管理上遵守一条简单规则：`apps/` 目录下只放线上真正运行着的应用，不留废弃服务或半成品草稿；服务下线就在删掉集群资源的同时删掉对应目录。

其次是在每次下发前后运行 `make diff`，预览本地配置与线上集群的差异而不实际写入：

```bash
# Makefile 内部执行的比对逻辑
helm diff -C 3 ...              # 对比本地 Chart 版本 + values.yaml 与线上 Helm Release
kubectl diff -k apps/...        # 对比 Kustomize 渲染结果与线上资源对象
ssh arm cat ... | diff -u - ... # 对比主节点上的 Traefik 配置文件与本地仓库版本
```

因为 Traefik 配置不走 `kubectl`，脚本会通过 SSH 读取主节点上的文件回来做 `diff`。当三段命令输出均为空时，就说明仓库与集群完全对齐；如果平时排障用 `kubectl edit` 临时改过线上参数，也能在这里一眼看出来，再决定是补写回 Git 还是重新 apply 覆盖掉。

### 静态校验：make lint 与 CI

Pull 模式通常靠集群侧的控制器报错或 Admission Webhook 拦住写坏的 YAML，Push 模式则把拦截点前移到了 Git 提交阶段。仓库的 GitHub Actions 每次触发只跑一条 `make lint`，包含四个步骤：

1. **Manifest 校验（`lint-manifests`）**：将 `apps/` 和 `templates/` 下的 Kustomize 目录全部构建展开，连同普通 YAML 清单一起交给 `kubeconform -strict`，按集群当前真实的 Kubernetes 版本（`v1.36.1`）校验 Schema。
2. **Helm 模板校验（`lint-helm`）**：用锁定的 Chart 版本和本地 `values.yaml` 执行 `helm template` 离线渲染，输出结果同样过一遍 `kubeconform -strict`。开启 `-strict` 后，缩进错位或拼错的未知字段都会直接报错。
3. **脚本检查（`lint-scripts`）**：用 `shellcheck` 检查 `scripts/` 下的运维脚本。
4. **明文扫描（`lint-secrets`）**：逐行检查加密环境变量文件，防止误提交未加密的明文密钥。

值得一提的是，**GitHub Actions 没有任何访问集群的权限**。CI 环境里不配 `kubeconfig`、SSH 私钥或解密密钥，即使公开仓库的 CI 流程出现异常，最坏结果也只是静态检查失败，绝对碰不到线上集群。

## 密钥管理：SOPS + age 本地解密

在 Pull 模式下，既然集群要自己拉取仓库部署，就必须把解密能力也放进集群（比如部署 Sealed Secrets 控制器，或者给 Argo CD 挂载解密私钥）。而在 Push 模式下，解密动作完全可以在本地控制机完成，集群只需要接收标准的 Kubernetes `Secret` 对象。

这套仓库使用 **SOPS + age** 管理敏感信息：

1. **密文提交入库**：所有业务密钥以及不便公开的节点公网 IP（`NODE_IP_*`）统一存放在 `secrets.enc.env` 中。文件里的键名和注释保持明文，等号后面的值则通过 SOPS 配合 `.sops.yaml` 中声明的 `age` 公钥加密为 `ENC[...]` 密文，可以直接提交到公开仓库。
2. **内存管道下发**：执行 `scripts/apply-secrets.sh` 时，脚本在控制机本地调用 `sops -d` 解密，通过内存管道直接传给 `kubectl create secret ... --dry-run=client -o yaml | kubectl apply -f -`。整个过程明文不落盘；如果某个应用还未配置密钥，脚本会自动跳过，不会阻塞基础平台组件的初始化。
3. **节点配置流式渲染**：节点公网 IP 也走同一套加密文件。运行 `make node-config` 时，本地在内存中解密出 IP 并填入节点配置模板，直接通过 SSH 管道写入远端节点的 `/etc/rancher/k3s/config.yaml`，本地不留存渲染后的临时文件。

本地的 `age` 私钥保存在密码管理器中。只要手里有这份公开的 Git 仓库和这一把 `age` 私钥，就能在任何一台新控制机上完整恢复集群配置。

## 存储与节点调度：固定到主节点

在跨云、跨地域的小集群里，如果为了实现 Pod 跨节点漂移而部署 Longhorn 或 Rook-Ceph 等分布式存储，不仅吃内存，跨云同步块数据还会占满节点间的 Tailscale 隧道带宽。因此集群直接采用了 k3s 内置的 **`local-path`** 存储类，把持久化数据落在宿主机本地磁盘上。

由于 `local-path` 创建的 PV 绑定在具体某一台机器的硬盘上，一旦有状态 Pod 重启后被调度到其他节点，就会因为找不到原有磁盘路径而启动失败。为此，集群里所有带 PVC 的有状态工作负载（如 `wallos` 的 SQLite、`multica` 的 pgvector、`supabase` 的 PostgreSQL）都统一加上了 `nodeSelector: kubernetes.io/arch: arm64`，固定在配置最高的 Oracle Cloud `arm64` 控制面节点上运行；公网入口网关 Traefik 也同样固定在该节点，让入口流量与后端数据库留在同一台机器内部交互。

至于腾讯云新加坡那台跨国节点，则被打上了 `location=singapore:NoSchedule` 污点（Taint），默认不参与常规应用调度，只运行明确声明了对应容忍度（Toleration）的特定网络任务。

## 有状态应用的夜间备份

把所有有状态服务集中在一台单节点的本地磁盘上，代价就是这台机器的硬盘成了单点。为了兜住磁盘损坏的风险，每个有状态应用都在各自目录下配了一个夜间备份 `CronJob`（`apps/<name>/backup.yaml`），每天凌晨错峰在 `03:10`、`03:30`、`03:50`（`Asia/Shanghai`）运行，把数据打包上传到 Cloudflare R2 对象存储，并保留最近 30 天的历史版本。

以同时包含 PostgreSQL 数据库和本地上传附件的 `multica` 为例，备份 Job 的 Init 容器与主容器共用一个临时 `emptyDir` 卷，分两步完成备份：

1. **数据库导出（Init 容器）**：使用与线上大版本一致的 `postgres:17-alpine` 镜像，通过集群内部 DNS 连接 `multica-postgres:5432` 执行 `pg_dump` 并经 `gzip` 压缩写入临时卷。脚本开头显式加上 `set -o pipefail`，防止 `pg_dump` 连接报错但后面的 `gzip` 正常返回 `0`，导致失败的任务被误判为成功。
2. **附件打包与上传（主容器）**：以只读方式挂载应用的 `uploads` PVC（在同一节点上，`local-path` 的 `ReadWriteOnce` 卷允许被多个 Pod 同时挂载使用），将附件目录打包成 `tar`，随后调用 `rclone` 把数据库备份和附件包一并上传到 `r2:<bucket>/backups/multica/`，并清理 30 天前的旧文件。

备份所用的 R2 凭据（`BACKUP_R2_*`）同样存放在 `secrets.enc.env` 中，由 `apply-secrets.sh` 分发为各应用命名空间下的 `backup-r2` Secret。CronJob 通过 `envFrom` 注入环境变量，直接拼成免配置文件的 `rclone` 远端参数。平时修改备份逻辑后，执行 `make backup-now APP=multica` 就能基于线上 CronJob 立即创建一个临时 Job 并跟随打印日志，方便随时验证备份是否正常。

## 版本锁定与升级流程

没有常驻控制器替集群维持状态，就更需要保证任何时候重跑 `make` 命令都不会在后台静默升级组件。因此仓库把所有外部依赖的版本都固定了下来：

- 四个 Helm Release 的 Chart 版本统一定义在 `Makefile` 顶部的变量中（如 `cert-manager v1.20.2`、`headlamp 0.42.0`、`multica 0.3.19`、`supabase 0.5.6`）。
- Kustomize 应用的容器镜像 Tag 全部在各自的 `deployment.yaml` 中固定为具体的语义化版本号，不使用 `:latest`。

这样无论 `make platform` 或 `make app` 执行多少次，哪怕上游发布了新版本，集群里部署出来的东西也完全一致。需要升级时，运行 `make bump APP=<name>` 查看并替换为新版本号，提交一道只改版本号的 Commit，等 CI 的 `kubeconform` 校验通过后，再在本地执行 apply 下发到集群。

## 方案边界

回顾整套设置，常规 GitOps 控制器负责的几项工作并没有消失，只是被拆解到了几个基础工具里：用目录结构与 `Makefile` 管下发顺序，用 `make diff` 做状态对账，用 `kubeconform` 和 CI 做前置拦截，用 SOPS + age 做客户端解密，再用固定的版本号防止配置漂移。

这套做法的适用边界很清楚：它适合节点数在个位数、单人维护、希望集群自身保持极简的个人环境。如果后续节点和应用规模继续扩大，或者需要多人协作、审计每一次线上变更，引入常驻控制器的收益就会超过它的资源开销，到那时再平滑迁移到 Argo CD 或 Flux 即可。

文中的目录结构、`Makefile` 与备份脚本均整理在公开仓库 [synthpop123/k3s-manifests](https://github.com/synthpop123/k3s-manifests) 中，各个子目录下附有详细的初始化与操作说明。
