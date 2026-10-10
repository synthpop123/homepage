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

在之前的文章[通过 Komodo + Renovate 构建 Docker Compose GitOps 流水线](https://lkwplus.com/blog/komodo-gitops)中，我记录了基于 Docker Compose 的自动部署方案：服务器运行 Komodo 监听 Webhook 并拉取仓库，配合 Renovate发起镜像更新 PR。

后续我将部分自建服务迁移到了一个四节点的 k3s 集群。节点分布在两家云服务商（Oracle Cloud 的 1 台 arm64 作为控制面、2 台 amd64 作为工作节点，外加 1 台腾讯云新加坡节点），节点之间通过 Tailscale 组网。

在 Kubernetes 生态中，通常采用 Ago CD 或 Flux 等 Pull 模式的 GitOps 工具。但对于节点数较少、以个人维护为主的小集群，我选择采用 Push 模式：Git 仓库依然作为声明式配置的单一来源，但集群内部不运行常驻同步组件，所有配置都由本地运维机通过脚本或命令直接应用到集群。

## 为什么选择 Push 模式

Pull 模式（如 Argo CD / Flux）和 Push 模式（本地或 CI 直接执行 apply）的核心区别在于同步动作的发起方和凭据的管理位置：

| 对比项 | Pull 模式（Argo CD / Flux） | 本文采用的 Push 模式 |
| --- | --- | --- |
| **同步执行方** | 集群内常驻 Controller，持续轮询或监听 Webhook | 本地控制机，按需手动执行命令 |
| **集群访问仓库权限** | 集群需要访问 Git 仓库的 Deploy Key 或 Token | 集群无需访问 Git 仓库 |
| **凭据存储位置** | 集群内部通常需要解密组件（如 Sealed Secrets、SOPS 插件） | 凭据与解密密钥均留在本地控制机 |
| **配置漂移（Drift）处理** | Controller 自动对比并强制覆盖漂移 | 通过 `make diff` 查看差异，手动决定是否处理 |
| **配置校验拦截** | 集群端 Admission Webhook 或 Controller 校验 | 推送前在本地/CI 阶段通过 Lint 工具拦截 |

对于几十人协作或运行大量微服务的团队，Pull 模式能保证状态实时收敛，避免线上手工修改导致的不一致。但在个人维护的四节点集群中，Pull 模式带来了一些不必要的维护负担：

1. **降低集群资源消耗与维护成本**：无需在小配置云服务器上常驻 Argo CD 等重型组件，减少了需要升级与排障的控制面依赖。
2. **凭据隔离**：集群节点无需任何 Git 读权限，也不需要持有解密敏感配置的私钥。就算集群节点受损，敏感凭据与 Git 仓库权限也不会泄露。
3. **流程可控**：配置的渲染、解密与应用全部在本地终端完成，没有黑盒调度逻辑。

相应地，Push 模式需要我们通过工具链自行补齐两点：**配置漂移的主动检查**与**下发前的合规校验**。

## 目录结构与应用方式

在 Pull 模式下，通常由 Controller 统一识别并应用各类资源。而在 Push 模式下，不同层级的配置有不同的下发方式：

| 路径 | 管理机制 | 应用方式 |
| --- | --- | --- |
| `apps/<name>/` | Kustomize | `kubectl apply -k apps/<name>/` |
| `apps/multica/values.yaml` 等 | Helm | `helm upgrade --install <release> <chart> -f values.yaml` |
| `platform/cert-manager/` 等 | Helm + 原生资源 | 组合执行 `helm upgrade` 与 `kubectl apply -f` |
| `platform/traefik/` | k3s 内置 Auto-deploy | 通过 `scp` 写入控制面节点的 `/var/lib/rancher/k3s/server/manifests/` |
| `node-config/<node>.config.yaml` | k3s 守护进程配置 | 渲染后通过 SSH 写入 `/etc/rancher/k3s/config.yaml` 并重启 k3s 进程 |

对于常规的工作负载，采用标准的 `kubectl` 与 `helm` 下发；但针对部分底层组件，需要走特定机制：

- **Traefik 配置**：k3s 默认通过内置的 `HelmChartConfig` 管理自带的 Traefik。针对 Traefik 的自定义参数，k3s 会监控 server 节点的 `/var/lib/rancher/k3s/server/manifests/` 目录。因此，Traefik 的配置是通过 `scp` 直接同步到主节点指定目录，由 k3s 自行热加载。
- **节点级配置**：涉及节点 IP 绑定、跨云组网声明等配置，属于宿主机上 k3s 进程本身的运行参数。这部分通过 SSH 写入配置文件后重启 `k3s` 或 `k3s-agent` 服务生效。

为了避免手动输入复杂的下发参数，仓库使用 `Makefile` 将这些步骤进行了标准化封装：

```bash
make app APP=wallos       # 应用 apps/wallos 下的 Kustomize 配置
make multica              # 更新 multica 的 Helm 发布及备份 CronJob
make traefik              # 同步 Traefik HelmChartConfig 至控制节点
make node-config NODE=sg  # 渲染并更新新加坡节点的 k3s 配置并重启服务
make platform             # 按依赖顺序初始化平台层组件（Secret、cert-manager、Traefik 等）
```

## 校验与漂移检测

Push 模式最常见的问题是本地代码与线上实际状态脱节。为了保持状态可控，主要依靠两个机制：

### 1. 本地 Diff 检查

在执行实际改动前，可通过 `make diff` 进行全量或单项对账：

```bash
# Makefile 内部执行逻辑
helm diff -C 3 ...              # 对比 Helm release 的当前状态与本地 values.yaml
kubectl diff -k apps/...        # 对比 Kustomize 生成的清单与线上资源
ssh arm cat ... | diff -u - ... # 对比主节点上的 Traefik 配置与仓库文件
```

只有当 `diff` 输出为空时，才说明仓库与集群线上配置完全一致。若存在临时排查产生的手动修改，可以清晰地识别出来并决定是写回仓库还是覆盖重置。

### 2. CI 静态校验

集群不暴露给 GitHub Actions，但 CI 依然作为提交前的质量关卡。每次 push 触发的 CI 只执行 `make lint`，包含四个步骤：

1. **Manifest 校验**：使用 `kustomize build` 编译所有清单，通过 `kubeconform -strict` 对齐集群目标版本（如 v1.36.1）进行 Schema 校验。
2. **Helm 模板校验**：利用固定的 Chart 版本与 `values.yaml` 执行 `helm template`，渲染后的输出同样通过 `kubeconform` 检查语法错误与未知字段。
3. **脚本检查**：使用 `shellcheck` 检查运维脚本的规范性。
4. **敏感信息扫描**：确保无未加密的明文密钥提交。

通过在 CI 阶段拦截掉格式错误与拼写问题，避免了在下发到集群时才出现语法报错。

## 密钥管理方案：SOPS + age

在 Push 模式下，集群内部无需配置类似 Sealed Secrets 或 External Secrets Operator 的组件。密钥加解密均在控制机本地完成：

1. **密文入库**：非敏感配置和密钥结构存放在 `secrets.enc.env` 中。键名保持明文，取值均通过 SOPS 使用 age 公钥加密为 `ENC[...]` 格式。这个文件可以安全地提交到公开仓库。
2. **内存解密与应用**：`scripts/apply-secrets.sh` 脚本在控制机上调用 `sops -d` 解密环境变量文件，直接通过内存管道传递给 `kubectl create secret ... --dry-run=client -o yaml | kubectl apply -f -`。解密后的明文不会落盘。
3. **容器引用**：工作负载通过标准 Kubernetes `Secret` 对象的 `secretKeyRef` 或 `envFrom` 挂载使用。

本地的 age 私钥保存在密码管理器中，只要本地保有私钥与 Git 仓库，即可在新环境完整重建集群状态。

## 存储拓扑与单节点绑定

在小型多云集群中，跨地域的分布式存储（如 Longhorn 或 Rook-Ceph）往往需要较高的网络带宽和硬件开销。因此，该集群采用了更务实的存储策略：

- 默认存储类采用 k3s 自带的 `local-path`，数据直接存储在节点的宿主机磁盘上。
- 由于 `local-path` 的 PV 不具备跨节点漂移能力，所有挂载了 PVC 的有状态应用（如 Wallos 的 SQLite、Multica 与 Supabase 的 PostgreSQL）均统一配置了 `nodeSelector`，明确固定在 Oracle Cloud 的 arm64 控制面节点上运行。
- 入口网关（Traefik）同样固定在主节点，保持公网入口与数据就近交互。

对于新加坡等海外单节点，通过打上 `location=singapore:NoSchedule` 污点，防止无状态或有状态服务被默认调度过去，仅供明确配置容忍度（toleration）的特定任务使用。

## 有状态应用的离线备份

由于本地单节点存储存在单点故障风险，集群中所有有状态应用均配套配置了夜间异地备份任务。以 `multica` 为例，应用目录中包含独立的 CronJob 清单：

1. **数据导出（Init 容器）**：使用匹配版本的 `postgres:17-alpine` 镜像，通过 `pg_dump` 经由集群内部网络导出数据库并使用 gzip 压缩。脚本设置 `set -o pipefail`，防止中间环节报错被静默吞掉。
2. **文件归档与上传（主容器）**：以只读方式挂载本地附件目录（local-path 允许在同一节点上以 ReadWriteOnce 多次挂载只读卷），打包后通过 `rclone` 将备份同步至 Cloudflare R2 对象存储，并自动清理 30 天前的旧备份。
3. **凭据解耦**：备份任务所需的 R2 Access Key 等参数，复用前述的 SOPS 流程分发为各个 Namespace 下的 Secret，在 CronJob 中通过环境变量直接组合成 rclone 的配置，避免在镜像内硬编码。

## 版本锁定与升级流程

为了避免重复执行命令时引入未预期的上游变更，仓库对所有外部组件进行了版本锁定：

- Helm Release 依赖的 Chart 版本均显式定义在 `Makefile` 变量中（例如 `cert-manager v1.20.2`、`headlamp 0.42.0` 等）。
- 自建服务的镜像 Tag 在各自的 `deployment.yaml` 中固定为具体语义化版本号，不使用 `:latest`。

需要升级时，手动修改对应配置文件的版本号或使用 `make bump APP=<name>` 脚本进行替换。变更经过 Git Commit 和 CI 校验后，再由人工执行 apply 操作下发。

---

## 总结

在小规模集群中，Push 模式将通常由 GitOps Controller 负责的状态同步与校验工作，拆解为了相对简单的标准工具链：

- **目录结构与 Makefile**：明确定义每个组件的应用机制与执行顺序。
- **SOPS + age**：解决密钥入库与零集群依赖解密。
- **kubeconform + CI**：在提交阶段保障资源语法的有效性。
- **`make diff`**：提供可视化的配置漂移检测。

这种方案降低了集群本身的资源占用与系统复杂度，适合单人维护、节点数量有限的个人运维场景。当集群规模扩大或协作人数增加时，再逐步过渡到 Pull 模式也是平滑的演进路径。
