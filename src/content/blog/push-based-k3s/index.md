---
title: "Push-based GitOps 管理 k3s 小集群"
description: "Manage a small k3s cluster as code with push-based GitOps"
date: 2026-06-21
authors:
  - lkw123
draft: false
tags:
  - gitops
  - k3s
  - kubernetes
ai: true
---

上一篇[通过 Komodo + Renovate 构建 Docker Compose GitOps 流水线](https://lkwplus.com/blog/komodo-gitops)写的是 Docker Compose 那套：主机上常驻一个 Komodo，收到 push webhook 就拉取仓库、重新部署，Renovate 盯着上游镜像提升级 PR。它的核心是有一个常驻服务，替你把 Git 里的状态搬到机器上。

后来我把一部分服务挪到了一个四节点的 k3s 小集群：Oracle 的一台 arm64 当 control-plane、两台 amd64 当 agent，外加一台腾讯云新加坡节点，四台机器跨两家云，节点间用 Tailscale 组网。到了 Kubernetes 上，顺着惯性最容易想到的是 Argo CD 或 Flux，把 pull 式 GitOps 原样搬过来。但这次我选了相反的方向：仓库仍是唯一事实来源，但集群从不读它，所有改动都从控制机 push 进去。

这篇不是要论证 push 比 pull 好；对一个跑几十个服务、多人协作的环境，结论多半相反。这里记录的是：四个节点、一个人维护的小集群，把 controller 这一层拿掉之后，整套 GitOps 流水线怎么补齐。

## push 和 pull 的分界

两种模型的差别只在一个问题上：**谁主动发起那次同步**。

| | pull（Argo CD / Flux） | push（这套做法） |
| --- | --- | --- |
| 谁在 reconcile | 集群里的 controller，持续运行 | 控制机上的一条命令，手动触发 |
| 集群是否读 Git | 是，controller 直连仓库 | 否，集群完全不知道 GitHub 的存在 |
| 凭据放在哪 | 集群里要有 repo 的读权限、可能还有解密用的私钥 | 全在控制机：kubeconfig、SSH key、age 私钥 |
| drift 怎么发现 | controller 自动对账并纠偏 | 自己跑 `make diff` 查，不会自动纠偏 |
| 改坏了的拦截点 | controller / admission webhook | push 之前的 `make lint` |

pull 模型的好处是实打实的：自动对账意味着就算不小心直接 `kubectl edit` 改了线上，controller 也会把它纠回来；新机器接管也简单，controller 一跑就收敛。代价是集群里多了一个常驻组件，而且这个组件需要能读到仓库、有时还要能解密 secret，**集群本身成了一个需要被授权、被信任的 Git 客户端**。

对四个节点来说，我更在意另一面：

- 集群里少一个常驻 controller，就少一处要升级、要排障、要授权的东西。k3s 本身已经够小，不必再叠一层 GitOps 平台。
- 凭据全留在控制机。集群里没有任何能回连 GitHub 的东西，仓库可以放心公开（这个仓库就是公开的），泄露面只剩控制机一台。
- 集群挂了不影响恢复能力。解密密钥不在集群里，集群没了和还能不能恢复是两件独立的事。

这套取舍能成立，前提是把 pull 模型免费附带的两样东西自己补上：**自动对账**换成手动的 drift 检查，**集群侧的拦截**换成 push 前的本地校验。下面几节基本都在讲这两件事怎么补。

## 仓库是线上状态的镜像，靠 diff 验证

push 模型最容易退化的地方，是仓库和集群慢慢对不上：仓库里躺着几个早就删掉的 app，或者线上被临时改过、却没有回写进 Git。pull 模型靠 controller 强制两者一致；push 模型没有这层强制，只能靠两条约定：

1. **`apps/` 下一个文件夹对应一个真实部署着的 app**，不放任何打算以后上的东西。服务上线就加文件夹（新服务从 `templates/service-with-tls` 拷一份改名开始，Namespace、Deployment、Service、Ingress 四件套齐全），下线就删。仓库始终是线上的镜像，而不是愿望清单。
2. **让这条约定可以被检验**，也就是 `make diff`：预览出如果现在把每个 apply 都跑一遍会改动什么，但什么都不应用。

```
helm diff   →  本地 chart pin + values.yaml   vs   集群里存着的 release
kubectl diff →  仓库里的 manifest             vs   线上对象
ssh arm cat …/traefik-config.yaml | diff …   →  仓库里的 traefik 配置 vs ARM 上那份
```

最后一行有点特殊：traefik 的配置不是用 kubectl 管的（原因见下一节），所以 diff 也得 ssh 到 ARM 节点把那份文件抓回来比对。输出里某一段是空的，就说明那部分没有 drift。这条命令是这套 push 模型里对账的全部：它不纠偏，只告诉我哪里偏了，纠不纠、怎么纠由我决定。

## 文件放在哪个目录，决定它怎么到达集群

pull 模型里怎么应用这件事基本是统一的，controller 包办。push 模型里它是显式的，这个仓库用**目录**来编码：一个文件该用什么机制 apply，看它在哪个目录就知道。

| 路径 | 机制 | 怎么应用 |
| --- | --- | --- |
| `apps/<name>/`（kustomize app，如 wallos） | Kustomize | `kubectl apply -k apps/<name>/` |
| `apps/multica/values.yaml`、`apps/supabase/values.yaml` | Helm | `helm upgrade --install <release> <chart> -f values.yaml` |
| `platform/cert-manager/`、`platform/headlamp/` | Helm + 附带的 plain manifest | `helm upgrade …` 再 `kubectl apply -f …` |
| `platform/traefik/traefik-helmchartconfig.yaml` | k3s auto-deploy | **scp 到 ARM** 的 `/var/lib/rancher/k3s/server/manifests/`，**不是 kubectl** |
| `node-config/<node>.config.yaml` | k3s 节点配置 | 渲染后**经 ssh** 写进 `/etc/rancher/k3s/config.yaml`，再重启 k3s，**不是 kubectl** |

平台层就三样：k3s 自带的 Traefik 当公网入口，cert-manager 走 Cloudflare DNS-01 签 Let's Encrypt 证书，Headlamp 是网页 dashboard；app 层目前跑着 wallos、multica、supabase 三个。前三种路径是常规的 kubectl / helm，后两种需要特别注意，它们看着像普通 manifest，却不能用 kubectl apply：

- traefik 那份是 `HelmChartConfig`，定制的是 k3s 自带的 Traefik。k3s 会监视 server 节点上的 auto-deploy 目录（`/var/lib/rancher/k3s/server/manifests/`）并自动 reconcile 里面的文件，所以它的应用动作是把文件 scp 到那个目录，k3s 自己接手；持久状态以节点上那份文件为准，仓库里的副本是留档和重建依据。
- `node-config/` 下是 k3s 节点的 `config.yaml`，配的是 k3s 进程本身（比如 `node-external-ip`，跨云组网时每个节点都要把自己的公网 IP 显式告诉 k3s）。这层比任何 Kubernetes 对象都低，只能写文件加重启进程。

这些命令不用记，都收进了 `Makefile`，每个 target 都是底层那条 `kubectl` / `helm` / `scp` / `ssh` 命令的薄包装：

```bash
make app APP=wallos       # kubectl apply -k apps/wallos/
make multica              # helm upgrade --install plus its cert and backup CronJob
make traefik              # scp the ARM-pinned config to the server node
make node-config NODE=sg  # render sg's k3s config, push it, restart k3s-agent
make platform             # apply all platform components in the right order
```

顺序也编码在里面：`make platform` 先建 Cloudflare 的 token Secret，再装 cert-manager（ClusterIssuer 要等 CRD 就位），最后 Headlamp 和 traefik，重建集群时不用回忆先后。把怎么 apply 显式写进目录和 Makefile，某种程度上是在补 controller 的课：pull 模型里这套知识沉淀在 controller 的实现里，push 模型里它得沉淀在仓库结构和 `make` target 里，否则就只存在我脑子里，过半年就忘。

## 一切 pin 到 ARM 节点

集群里几乎所有东西都带着 `nodeSelector: kubernetes.io/arch: arm64`，固定在那台 ARM 节点上。这不是随手写的，是几个事实叠加出来的约束：

- ARM 节点是 control-plane（server），其余三台是 agent；
- 默认存储用的是 k3s 自带的 `local-path`，它是**节点本地**的：PV 建在哪台机器的磁盘上，数据就只存在那台机器上；
- 于是任何带 PVC 的 stateful pod 都必须回到它数据所在的节点，一旦被调度到别的节点，要么挂载不上原来的 PV，要么挂上一个空的新目录。

所以这行 nodeSelector 不能去掉：它保证 wallos 的 SQLite、multica 的 pgvector、supabase 的 Postgres 重启后都回到 ARM，找回自己的盘。traefik 也一并固定在 ARM，因为公网入口要稳定指向 control-plane 这一台。代价是 ARM 节点成了单点，对一个家用规模的集群，我接受这笔交换：数据和入口都在一台已知的机器上，换掉一整套分布式存储的复杂度。新加坡那台 agent 额外打了 `location=singapore` 的 taint，默认不接收 workload，只跑明确容忍它的。

## 密钥只以密文进 Git

push 模型在 secret 这件事上反而比 pull 干净，因为它把一个本来很别扭的问题直接绕开了。

pull 模型下，集群要自己从 Git 拿配置，加密的 secret 也得能在集群里解开：要么上 Sealed Secrets，集群里跑一个持有私钥的 controller；要么给 Argo 配解密插件。无论哪种，**解密能力都得放进集群**。

push 模型不需要：apply 从控制机发起，解密也在控制机做。这个仓库用的是 SOPS + age：

- 所有 secret 值，外加不算机密但也不想公开的 `NODE_IP_*` 节点公网 IP，都存在 `secrets.enc.env` 里。这个文件**提交进 Git**：变量名和注释明文可读，每个值是一段 `ENC[...]` 密文。age 的 recipient 写在 `.sops.yaml`，对应的私钥只在控制机和密码管理器里有备份。
- `scripts/apply-secrets.sh` 在内存里 `sops -d` 解密（密钥不在就直接失败，不会默默跳过），再用 `kubectl create … --dry-run=client | apply` 把 Secret 对象建出来，幂等，明文不写入磁盘。脚本里一个 app 一段，没填值的 app 自动跳过，所以拉起平台不依赖任何 app 密钥。
- manifest 本身不读环境变量，pod 通过 `secretKeyRef` 引用这些建好的 Secret。

这套流程贴合 push 模型的原因是它**纯客户端**：集群里没有任何解密组件，集群挂了也不会把解密密钥一起带走。灾备路径因此短到一句话：这个仓库，加上那把 age 私钥。

明文绝不进库这条规则，可以交给机器来守：`make lint` 里有一步专门扫描 `secrets.enc.env`，逐行确认每个值要么是 `ENC[...]` 要么为空，发现明文就让构建失败。节点公网 IP 也顺带被保护了：仓库公开，但 IP 只以密文出现，apply 时才由 `make node-config` 渲染进节点配置模板，直接流式写到节点上，本地不留渲染后的副本。

## CI 只做校验，永远碰不到集群

pull 模型里有 controller 和 admission webhook 在集群边上把关，写坏的 manifest 进不了线上；push 模型把这道关挪到了 push 之前。这个仓库的 CI（GitHub Actions）每次 push 只跑一条 `make lint`，包含四步：

1. `lint-manifests`：把 `apps/` 和 `templates/` 下每个 kustomization build 出来，连同所有 plain manifest 一起交给 `kubeconform -strict` 校验；
2. `lint-helm`：用各自 pin 的版本和 `values.yaml` 把四个 Helm chart `helm template` 渲染出来，同样过 `kubeconform -strict`；
3. `lint-scripts`：`shellcheck` 扫描 `scripts/`；
4. `lint-secrets`：上一节的明文扫描。

`-strict` 会拒绝未知字段，校验又是对着集群真实的 Kubernetes 版本（`1.36.1`，跟集群一起升级）做的，所以一个 YAML 拼写错误、或者 values 和 chart 对不上，在 CI 里就会失败，而不是拖到 apply 时才发现。

对 push 模型来说还有一个要紧的设计：**CI 在结构上就够不到集群**。GitHub 那边没有 kubeconfig、没有 SSH key、没有 age 私钥，哪怕 CI 流程被改坏或被人钻了空子，它能做的最坏的事也只是校验不通过，动不到线上。pull 模型把信任放在集群里那个能读 Git 的 controller 上；push 模型把信任收在控制机，CI 只是一个无害的 linter。对一个公开仓库，CI 天生无权限这一点让人放心。

## 把版本钉死

push 模型没有 controller 持续把集群拉回声明的状态，所以以为没动过的东西必须真的没动过，否则 drift 会悄悄累积。具体要求是：**任何一次 re-run 都不能静默升级任何东西**。

四个 Helm release 的 chart 版本全部 pin 在 `Makefile` 的变量里（`cert-manager v1.20.2`、`headlamp 0.42.0`、`multica 0.3.19`、`supabase 0.5.6`），kustomize app 的镜像 tag pin 在各自的 `deployment.yaml`，不用 `:latest`。于是 `make platform` 跑十遍结果都一样，不会因为上游发了新版就把集群顺手带上去。

升级是一个**显式**动作：`make bump APP=<name>` 列出可选的新版本、或把指定版本写进对应的 pin，改动就是一行 diff，过一遍 CI，再由我决定哪天 apply。升级和手改一行配置走同一条路：先改 Git、再 push 到集群。Renovate 那套改 tag 也要过 PR 的思路还在，只是提 PR 的机器人换成了我自己。

## stateful app 都带一个夜间备份

local-path 是节点本地存储，没有副本，ARM 节点的磁盘坏了数据就没了。所以每个 stateful app 都配了一个夜间备份的 CronJob（`apps/<name>/backup.yaml`），把状态 dump 出来上传到 Cloudflare R2，保留 30 天，三个 app 的时间错开在 03:10 / 03:30 / 03:50（Asia/Shanghai）。

以 multica 为例，它同时有数据库和上传文件两种状态，Job 分两段、共用一个 emptyDir：

1. init 容器用 `postgres:17-alpine` 的 `pg_dump` 客户端，走集群网络连到 `multica-postgres:5432` 把库 dump 下来、gzip 压缩。这里特地开了 `set -o pipefail`，否则 `pg_dump` 失败、`gzip` 却退出 0，整个 Job 会假装成功；
2. main 容器把 uploads PVC 以只读方式挂进来打成 tar（同节点的 RWO 多挂载在 local-path 上是允许的），再用 rclone 把两个文件 copy 到 `r2:<bucket>/backups/multica/`，顺带删掉 30 天前的旧备份。

R2 的凭据走前面那套 secret 流程：`BACKUP_R2_*` 在 `secrets.enc.env` 里，经 `apply-secrets.sh` 变成每个 app namespace 下的 `backup-r2` Secret，它的几个 key 经 `envFrom` 注入后直接拼成一个免配置文件的 rclone remote；非机密的 `TYPE`/`PROVIDER` 写在 CronJob 的 manifest 里。想立刻验证一次就 `make backup-now APP=multica`，它会从 CronJob 现建一个 Job，等运行结束把日志打出来。备份是这套模型里少数由集群自己定时执行的活，但它只向 R2 写数据，不读 Git，不破坏集群从不回连 GitHub 这条原则。

## 这套做法的边界

把上面几块连起来看：GitOps 平时由 controller 负责的几件事，在这里拆开交给了仓库结构（怎么 apply）、`make diff`（对账）、`make lint` 加 CI（拦截）、SOPS（解密）和 Makefile 里的 version pin（防漂移）。controller 那层的复杂度没有消失，只是摊薄成了一组约定和一个 `Makefile`。

它适用的前提很具体：节点数个位数、基本一个人维护、能接受 drift 靠手动 `make diff` 发现而不是自动纠偏。一旦节点和服务多起来、需要多人协作、要审计每一次实际下发，常驻 controller 的价值就会超过它的成本，该上 Argo / Flux 就上。对现在这个四节点的小集群，我还乐意自己当那个 controller。

完整的代码在 [synthpop123/k3s-manifests](https://github.com/synthpop123/k3s-manifests)，每个子目录都有自己的 README，写清了各自的 apply 步骤和 bootstrap 顺序。
