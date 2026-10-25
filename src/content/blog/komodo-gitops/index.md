---
title: "通过 Komodo + Renovate 构建 Docker Compose GitOps 流水线"
description: "Implement self-hosted GitOps and version control Docker Compose infrastructure through Git repositories"
date: 2026-06-16
updatedDate: 2026-10-10
authors:
  - lkw123
tags:
  - gitops
  - komodo
  - docker
ai: true
---

在一台或多台服务器上维护十几二十个自托管服务（订阅记账、电子书库、照片备份、媒体服务器等）时，纯靠手动操作很容易让环境状态失控。

首先是配置碎片化。一个服务的真实运行状态往往散落在各处：SSH 进去敲过的临时命令、不同目录下的 `docker-compose.yml`、未归档的 `.env` 密钥，以及半年前顺手改过的一行配置文件。一旦机器故障需要迁移重建，或者隔了几个月想排查某个参数的来历，只能靠记忆去拼凑。

其次是镜像版本难以兼顾稳定与更新。图省事直接写 `image: app:latest`，每次拉取都可能引入破坏性变更，出问题时连之前的正常版本是哪个都查不到；如果把版本号锁死，日常又很难挨个去盯几十个上游项目的 Changelog，往往一放就是一两年，连安全补丁也一起漏掉。

把这套环境迁到 GitOps 的思路很直接：将所有服务的 Compose 配置收进同一个 Git 仓库并锁定镜像版本，由 Komodo 监听仓库变更并自动执行部署，再交给 Renovate 定期检查上游镜像更新、自动发起带 Changelog 的升级 PR。

![overview of the article](./assets/gitops-banner.png)

## Docker 单机环境下的 GitOps

GitOps 最早出自 Kubernetes 社区，但核心做法并不绑死编排引擎，放在跑 Docker Compose 的服务器上同样适用。CNCF 的 OpenGitOps 将其归纳为四条原则：

1. **声明式配置**：只描述系统期望处于什么状态，具体执行步骤交给工具。一份 `compose.yaml` 就是对镜像版本、端口映射和挂载目录的完整声明。
2. **版本化与不可变存储**：期望状态保存在 Git 仓库中，每次改动都有带时间戳和说明的 Commit，出问题时直接 `git revert` 即可回退。
3. **自动拉取同步**：由部署代理自动从仓库拉取最新配置并应用，不再人工登录服务器执行 `git pull` 和 `docker compose up`。
4. **状态对账**：保持实际运行环境与仓库声明一致。

在大型 Kubernetes 集群中，Argo CD 或 Flux 会通过常驻控制器不断轮询并修正配置漂移。但在资源有限的个人服务器上，跑一套高频轮询的对账循环没太大必要。更务实的做法是采用**事件驱动**：向主分支推送或合并代码时，通过 Git Webhook 触发一次同步和按需部署。这样既省资源，也能保证每一次变更都有迹可循。

![gitops-loop](./assets/gitops-loop.png)

## Komodo 架构与仓库组织

[Komodo](https://komo.do) 是一个开源的容器构建与部署管理平台，提供 Web 界面、API、告警和权限管理。它把每个 Compose 项目抽象为一个 **Stack** 资源，查看容器状态、检索日志和触发部署都在同一套界面里完成。

它的运行架构分为两部分：

- **Core**：控制平面，运行 Web 界面、API 以及后端数据库（默认使用 MongoDB），存放资源定义、全局变量、用户权限和部署审计日志。
- **Periphery**：运行在各台被纳管服务器上的轻量级代理，Core 通过它向目标主机的 Docker 守护进程下发指令。一个 Core 可以连接多台运行 Periphery 的服务器。

![komodo-architecture](./assets/komodo-architecture.png)

*Core 作为控制平面统一调度，Periphery 作为节点代理在目标主机上执行 Docker 命令*

Komodo 支持用 TOML 文件声明平台自身的资源配置。借助 **Resource Sync** 功能，可以把所有 Stack、Server 和自动化流程的定义写进 `sync.toml` 并提交到 Git 仓库，由 Komodo 读取文件并自动创建或更新对应资源。

在 `komodo/sync.toml` 中，每个服务对应一个 `[[stack]]` 块：

```toml
[[stack]]
name = "wallos"
description = "https://wallos.example.com"
deploy = false
tags = ["app"]

[stack.config]
server = "server-a"
linked_repo = "homelab-infra"
run_directory = "stacks/wallos"
file_paths = ["compose.yaml"]
```

这几个关键字段的作用如下：

- `server`：指定部署到哪台被纳管的服务器（即对应的 Periphery 节点名称）。
- `linked_repo`：指向在 Komodo 界面中预先配好的 Repo 资源名称。Git 仓库地址和访问令牌等凭据保存在 Komodo 数据库里，仓库配置文件中只引用名称，方便跨环境迁移。
- `run_directory` 与 `file_paths`：指定该服务在仓库中的子目录和 Compose 文件路径。
- `deploy = false`：关闭 Resource Sync 阶段的自动部署，把部署动作交给后续的 Procedure 统一编排。

对应的 `compose.yaml` 完全遵循标准 Docker Compose 语法，不依赖平台专有字段，脱离 Komodo 直接执行 `docker compose up -d` 也能正常启动：

```yaml
services:
  wallos:
    container_name: wallos
    image: bellamy/wallos:4.9.6
    ports:
      - "20000:80/tcp"
    environment:
      TZ: Asia/Shanghai
    volumes:
      - /srv/wallos/db:/var/www/html/db
      - /srv/wallos/logos:/var/www/html/images/uploads/logos
    restart: unless-stopped

networks:
  default:
    name: wallos
```

整套体系里唯一需要手动执行 `docker compose up` 的是 Komodo 自身。它由 Core、Periphery 和数据库组成，无法自己部署自己，首次在主机上按官方文档拉起即可。它的 Compose 文件以及宿主机层的防火墙、fail2ban 配置可以脱敏后放在仓库的 `bootstrap/` 目录下，作为版本记录和灾备参考。

![komodo-stacks](./assets/komodo-stacks.png)

### 目录结构规划

所有机器和服务的声明统一放在同一个 Git 仓库中，这样一套 Renovate 规则和一条流水线就能覆盖全部服务，跨服务的调整也可以在单个 Commit 里完成：

```text title="仓库目录结构"
homelab-infra/
├── komodo/
│   └── sync.toml          # Stack、Procedure 与 Server 的集中声明
├── stacks/                # 服务目录，每个子目录对应一个 Stack
│   ├── wallos/
│   │   └── compose.yaml
│   └── immich/
│       ├── compose.yaml
│       └── config.example.yaml  # 去除敏感信息的配置文件模板
├── bootstrap/             # 手动部署的控制平面与宿主机基础配置
│   ├── komodo/            # Komodo 自身的 Compose 与环境变量模板
│   ├── firewall/          # DOCKER-USER 防火墙脚本与 systemd 单元
│   └── fail2ban/          # SSH 防爆破配置
├── scripts/
│   └── validate.sh        # 本地与 CI 共用的静态校验脚本
├── renovate.json          # Renovate 自动升级规则
└── docs/
    └── ports.md           # 宿主机端口分配登记表
```

Komodo 会把仓库克隆到宿主机的工作目录（默认位于 `/etc/komodo/repos/`）。因此仓库内只存放声明式配置，运行期产生的数据和敏感信息全部留在仓库目录之外：应用持久化数据统一放在 `/srv/<service>/`，真实密钥保存在 Komodo 的变量库中（部署时动态生成 `.env`），控制平面自身的状态则存放在 Komodo 数据库里。

## 从 Git Push 到触发部署

如果直接把 Git 仓库的 Webhook 指向 Resource Sync 并开启同步即部署，当服务数量增多时很容易遇到两个问题：

1. **并发抢锁**：如果 Resource Sync 和额外部署任务同时触发，两者会争抢同一个 Stack 的部署锁，导致 Komodo 报错 `Resource is busy`。
2. **新增服务首次推送漏部署**：新加入的 Stack 在定义还没被 `RunSync` 创建出来之前就进入了部署阶段，导致第一次推送无法自动拉起，还得去界面上手动点一次。

为了解决执行顺序问题，可以利用 Komodo 的 **Procedure**（流程编排）将更新拆分为按顺序执行的两个 Stage。Procedure 保证前一个 Stage 内的操作全部完成后，再进入下一个 Stage：

```text
Renovate / 人工合并 PR 到 main
        │
        ▼
Git Push Webhook ──► Procedure "Redeploy On Push"
                       │
                       ├─ Stage 1: RunSync "homelab"
                       │   读取 sync.toml，创建或更新 Stack 资源定义
                       ▼
                       └─ Stage 2: BatchDeployStackIfChanged "*"
                           比对文件内容，仅重新部署有变动的 Stack
```

在 `sync.toml` 中声明该 Procedure：

```toml
[[procedure]]
name = "Redeploy On Push"

[procedure.config]
webhook_enabled = true

[[procedure.config.stage]]
name = "Sync resource definitions"
executions = [
  { execution.type = "RunSync", execution.params.sync = "homelab" },
]

[[procedure.config.stage]]
name = "Redeploy changed stacks"
executions = [
  { execution.type = "BatchDeployStackIfChanged", execution.params.pattern = "*" },
]
```

Stage 1 先执行 `RunSync` 将所有 Stack 的元数据对齐到最新 Commit；Stage 2 再执行 `BatchDeployStackIfChanged`，用通配符 `*` 检查所有 Stack，只有当 `compose.yaml` 或关联变量发生变化时才触发重新部署。

### Webhook 与前置 CI 校验

在 GitHub 或 Gitea 仓库的 Webhook 设置中，只挂载这一条指向 Procedure 的 Webhook（Resource Sync 自身的 Webhook 保持关闭，避免重复触发）：

- **Payload URL**：`https://<CORE_DOMAIN>/listener/github/procedure/Redeploy%20On%20Push/run`
- **Content type**：`application/json`
- **Secret**：填入与 Komodo 一致的 `WEBHOOK_SECRET`，Komodo 会校验请求头中的 `X-Hub-Signature-256` 签名。

由于合并主分支后会直接触发线上部署，建议在仓库里配一条轻量 CI（如 GitHub Actions），在 PR 合并前拦住低级语法错误。CI 脚本只需在托管 Runner 上运行，不需要访问服务器：

```bash
# 检查 YAML 缩进与格式
yamllint -c .yamllint.yml stacks/
# 使用 Docker Compose 解析器校验配置合法性
find stacks -name "compose.yaml" -exec docker compose -f {} config -q \;
```

## 用 Renovate 自动管理镜像升级

[Renovate](https://docs.renovatebot.com) 会定时扫描仓库中的 `compose.yaml`，去上游镜像仓库查询新版本，并自动提交附带 Release Notes 的更新 PR。如果代码托管在 GitHub，最省事的方式是直接安装官方托管的 Mend Renovate App；如果使用自建 Gitea，也可以用 Docker 容器或定时 CI 任务自托管运行。

### 版本锁定策略

要让 Renovate 正常工作并保证环境可复现，镜像 Tag 需要按服务性质分两类锁定：

- **无状态应用锁精确版本**：例如 `bellamy/wallos:4.9.6`。这样每次升级都是一行清晰的版本号变更，出问题能随时回退。
- **数据库与缓存锁大版本线**：例如 `pgvector/pgvector:pg17`、`redis:8`。区分标准是升级时是否需要人工介入迁移数据：跨大版本升级数据库往往需要导出导入或运行升级脚本，锁住大版本线后，日常补丁更新照常拉取，而跨大版本升级会以单独的 Major PR 提醒人工处理。

### 配置示例

仓库根目录下的 `renovate.json` 配置如下：

```json title="renovate.json"
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":dependencyDashboard", ":semanticCommits"],
  "timezone": "Asia/Shanghai",
  "labels": ["dependencies"],
  "prConcurrentLimit": 0,
  "prHourlyLimit": 0,
  "packageRules": [
    {
      "matchManagers": ["docker-compose"],
      "matchPackageNames": ["ghcr.io/mastodon/**"],
      "groupName": "mastodon"
    }
  ]
}
```

几个核心配置项的作用：

- `:dependencyDashboard`：在仓库自动维护一个汇总 Issue，列出所有待更新、已暂停或有冲突的依赖项，方便集中查看和手动勾选触发。
- `prConcurrentLimit` 与 `prHourlyLimit`：Renovate 默认限制并发和每小时新建的 PR 数量，服务较多时容易排队积压，设为 `0` 即取消限制。
- `packageRules`：用来给关联镜像分组。例如 Mastodon 的 `web`、`sidekiq` 和 `streaming` 拆分在不同镜像里但必须同步升级，通过 `groupName` 合并到同一个 PR 中，可以避免组件间版本错配。

虽然 Renovate 支持给补丁版本开启自动合并（`automerge`），但在个人自托管环境中，扫一眼 Changelog 再点合并花不了几秒钟，还能清楚知道当天更了哪个服务，所以我保留了人工合并这一步。

![renovate-pr](./assets/renovate-pr.png)

## 环境变量与密钥分离

要把敏感信息从 Git 仓库里剥离出去，需要先理清 Docker Compose 处理环境变量的两个阶段：

1. **配置插值（Interpolation）**：Compose 解析 `compose.yaml` 时，会将文件中形如 `${VAR}` 的占位符替换为当前宿主机的 Shell 环境变量或同目录下 `.env` 文件中的值。这一步发生在创建容器之前，纯粹是文本替换；同目录 `.env` 文件里的变量**不会自动进入容器内部**。
2. **容器环境变量注入**：通过服务定义下的 `environment:` 或 `env_file:` 字段，把变量真正传递给容器内的运行进程。

```yaml
services:
  app:
    environment:
      - TZ=Asia/Shanghai
      - DB_PASS=${DB_PASS}  # 先读取同目录 .env 完成文本插值，再注入容器进程
    env_file:
      - ./app.env           # 将该文件内的所有 KEY=VAL 直接注入容器进程
```

这里有几个容易踩坑的细节：`environment:` 中的同名变量优先级高于 `env_file:`；`.env` 文件里的 `KEY=VAL` 等号两侧不能留空格；如果需要在 `compose.yaml` 中保留字面量的 `$`（比如在健康检查命令里引用容器自身的环境变量），必须写成 `$$` 转义，避免被 Compose 在插值阶段提前替换成空串：

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
```

![compose-env](./assets/compose-env.png)

### 两类密钥的处理方式

理清插值机制后，可以根据服务读取配置的方式，把密钥分为两类管理：

**环境变量型密钥**（如数据库密码、API Token）：在 `compose.yaml` 中只写占位符，如 `POSTGRES_PASSWORD: ${APP_DB_PASSWORD}`。真实密钥填写在 Komodo 界面的 **Variables & Secrets** 中，再在 `sync.toml` 对应 Stack 下声明映射：

```toml
environment = """
APP_DB_PASSWORD=[[APP_DB_PASSWORD]]
APP_REDIS_PASSWORD=[[APP_REDIS_PASSWORD]]
"""
```

部署时，Komodo 会将 `[[...]]` 解析为真实值，写入该 Stack 工作目录下的 `.env` 文件供 `docker compose` 插值消费。这个临时 `.env` 位于宿主机的工作目录内，不会进入 Git 仓库。时区、`PUID`/`PGID` 等非敏感参数则直接明文写在 `compose.yaml` 里。

**配置文件型密钥**（如把密钥和常规设置混在一起的 `config.yaml`）：真实文件直接存放在宿主机的持久化目录（如 `/srv/<service>/config.yaml`），通过 bind mount 挂载进容器，跟随应用数据一起备份；Git 仓库里只提交一份隐去密钥的 `config.example.yaml` 作为结构参考。需要注意 Docker 的一个默认行为：用 bind mount 挂载单个文件时，宿主机上的目标文件必须在容器启动前就已经存在，否则 Docker 会自动在宿主机创建一个同名空目录，导致容器内应用读取配置报错。

## 端口、网络与数据目录约定

当一台机器上跑起几十个容器后，靠临时起意配路径和端口很容易撞车。在仓库里统一遵守四条基础约定能省去很多维护麻烦：

1. **端口从固定基数递增，集中登记**：宿主机对外暴露的端口统一从 `20000` 起按顺序分配，每个需要映射宿主机端口的服务占一个号，并在 `docs/ports.md` 中登记。只在容器网络内部通信的组件（如 Postgres、Redis、Meilisearch）不配置 `ports:` 映射，既减少暴露面，也避开了 `3000`、`8080` 等常见默认端口的冲突。
2. **显式命名默认网络**：在每个 `compose.yaml` 底部加上 `networks: default: name: <service_name>`。如果不指定，Docker 会自动拼接出 `<project>_default` 这类依赖目录名的网络名称；显式命名后，排查网络或跨 Stack 互通时更加直观。
3. **持久化数据统一用绝对路径挂载到 `/srv/<service>/`**：Komodo 部署时会操作其工作目录下的仓库克隆，如果把数据放在 `./data` 这类相对路径下，重新克隆仓库时有被连带清空的风险；而 Docker 命名卷（Named Volumes）藏在 `/var/lib/docker/volumes/` 深处，备份不便且容易被 `docker compose down -v` 误删。统一用绝对路径 bind mount 到 `/srv/<service>/` 后，数据与代码仓库彻底分离，备份整机应用数据也只需要打包 `/srv` 目录。
4. **数据目录权限跟随镜像自身的用户 UID/GID**：不同镜像内部的运行用户各不相同（LinuxServer 系镜像通过 `PUID`/`PGID` 指定，部分 Web 应用使用 uid `82` 的 `www-data`，官方 Postgres 镜像默认使用 uid `999`）。不必强行在宿主机统一成一个全局 UID，让 `/srv/<service>/` 下各子目录的属主匹配对应容器的运行用户即可。

## 迁移手工部署的旧服务

把服务器上原先散落在 `/opt/<service>/` 等目录的旧服务迁入这套流水线时，可以按确认现状、准备声明、停机拷贝、切换验证四步逐个推进。核心的数据迁移命令很简单，重点是用 `cp -a` 完整保留原有的文件属主与权限：

```bash
# 停止旧服务
cd /opt/<service> && docker compose down

# 将原命名卷或目录的数据完整拷贝至 /srv，保留 UID/GID 与权限
mkdir -p /srv/<service>
cp -a /var/lib/docker/volumes/<volume_name>/_data /srv/<service>/<dir_name>

# 核对拷贝后的目录属主与权限
stat -c '%n  %U:%G  %a' /srv/<service>/*
```

在实际搬迁过程中，有几个容易踩坑的地方值得留意：

- **藏在数据目录或匿名卷里的状态**：有些应用会在首次启动时自动生成加密密钥并写进数据目录（例如聊天工具的 `secret_key` 或自建 Git 服务的 `INTERNAL_TOKEN`），迁移时必须连同目录原封不动拷过去，否则已加密的数据无法解密。此外，迁移前建议跑一次 `docker inspect <container> --format '{{json .Mounts}}'`，确认是否有未在旧 `compose.yaml` 中显式声明的匿名卷（Anonymous Volumes）存有业务数据。
- **沿用原有的数据库密码**：Postgres、MySQL 等容器的环境变量密码只在首次初始化空数据目录时生效，随后便固化在数据文件里。迁入 Komodo 时，变量库里配置的密码必须与旧库一致；如果顺手换了新密码，应用容器会用新密码去连沿用旧密码的数据目录，直接报认证失败。
- **从 `:latest` 切换到固定版本号前先比对 Digest**：不少项目的 `:latest` 标签指向的是主分支构建，版本可能比最新的正式 Release 还要新。如果直接把 `:latest` 改成最新的正式版 Tag，实际上会变成一次降级，可能引发数据库 Schema 不兼容。稳妥的做法是先对比本地正在运行的镜像 Digest 与目标版本 Tag 的 Digest，确认一致或兼容后再锁定。
- **将共享数据库拆分为每个 Stack 独立部署**：早期手动部署时很容易图省事让多个应用共用一个全局 Postgres 容器。趁迁移的机会，建议为每个带数据库的应用在它自己的 `compose.yaml` 里配一个独立的 Postgres 容器：用 `pg_dump -Fc` 导出单个库的数据，恢复到新容器中，再把应用的数据库连接地址改为容器服务名。这样各个应用的数据库版本、启停和备份互不干扰，宿主机也不必再对外暴露 `5432` 端口。（顺带一提，从 `postgres:18` 镜像起，容器内的数据挂载路径从 `/var/lib/postgresql/data` 改为了父目录 `/var/lib/postgresql`，升级时需留意挂载点。）
- **用 Sidecar 容器代替修改官方镜像**：如果需要给某个服务配一个定时通知脚本或辅助工具，不要进官方容器手装依赖，否则下次更新镜像就会丢失。可以在同一个 Stack 目录里放一个子目录写 `Dockerfile`，通过 `build: ./notify` 作为并排的 Sidecar 服务启动，并在 `sync.toml` 中为该 Stack 加上 `extra_args = "--build"`。

切换完成并确认服务读写正常后，旧的命名卷和 `/opt/<service>/` 目录可以先保留几天作为回退保底，等运行稳定后再彻底清理。

## 宿主机防火墙：用 DOCKER-USER 链保护容器端口

常见架构中，对外服务都会挂在反向代理后面（反代可以跑在本机，也可以跑在另一台线路更好的前置服务器上）：域名解析指向反代节点，由反代统一处理 TLS 证书和访问控制，再回源到应用服务器。

但 Docker 映射端口时默认绑定在 `0.0.0.0`。一旦写下 `"20000:80/tcp"`，任何扫到应用服务器公网 IP 的人都能通过 `http://<IP>:20000` 直接访问容器，彻底绕开反向代理和前置鉴权。更麻烦的是，Docker 在发布端口时会往内核 iptables 的 `PREROUTING` 链插入 DNAT 规则，入站流量直接经由 `FORWARD` 链转发给容器，根本不会经过守护宿主机自身的 `INPUT` 链。因此在 `INPUT` 链或 `ufw` 里配的拦截规则，对 Docker 暴露出去的端口往往不起作用。

正确的拦截位置是 Docker 在 `FORWARD` 路径上专门预留的 **`DOCKER-USER` 链**。这条链在 Docker 自身的放行规则之前执行，且 Docker 重建容器网络时不会覆盖它。配置宿主机防火墙时建议遵循四条原则：

1. **只在 `DOCKER-USER` 链过滤来自公网网卡的入站流量**：指定 `-i eth0`（公网网卡名），这样容器之间的内部桥接通信以及容器主动访问外网的出站流量都不会受影响。
2. **不动 `INPUT` 链默认策略**：宿主机自身的 SSH 等服务走 `INPUT` 链，只改 `DOCKER-USER` 链可以确保哪怕规则写错，也不会把自己锁在 SSH 外面。
3. **直接用原生 `iptables` / `ip6tables` 管理**：不要混用 `ufw`、`firewalld` 或 `iptables-persistent`，这些工具接管全局规则集时很容易与 Docker 动态维护的链表冲突，导致容器断网。
4. **IPv4 与 IPv6 同步配置**：Docker 默认在双栈同时发布端口，如果只拦了 IPv4，公网依然能顺着 IPv6 地址直连容器端口。

以仅允许反向代理服务器（`192.0.2.10`）回源访问容器端口、同时单独放行 `2222` 端口（如 Git SSH）为例，IPv4 的 `DOCKER-USER` 规则如下：

```bash
# 1. 放行已建立连接的后续数据包
iptables -A DOCKER-USER -i eth0 -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN

# 2. 放行反向代理服务器的回源流量
iptables -A DOCKER-USER -i eth0 -s 192.0.2.10 -j RETURN

# 3. 按 DNAT 转换前的宿主机原始端口，放行确需公开的个别容器端口
iptables -A DOCKER-USER -i eth0 -p tcp -m conntrack --ctorigdstport 2222 -j RETURN

# 4. 拒绝公网网卡上访问其余容器端口的所有流量
iptables -A DOCKER-USER -i eth0 -j DROP
```

注意第 3 条规则使用的是 `-m conntrack --ctorigdstport 2222` 而不是普通的 `--dport`。因为流量到达 `DOCKER-USER` 链时已经完成了 DNAT 地址转换，`--dport` 看到的是容器内部端口（如 `80` 或 `22`），必须通过 `conntrack` 模块的 `--ctorigdstport` 才能匹配宿主机对外暴露的原始端口号。

![firewall-path](./assets/firewall-path.png)

*Docker 映射端口的流量走 DNAT 与 FORWARD，由 DOCKER-USER 链拦截；SSH 等宿主机进程走 INPUT 链，互不干扰*

为了让规则在重启宿主机或重启 Docker 守护进程后依然生效，可以把上述脚本包装成一个 `Type=oneshot` 的 systemd 服务，配置 `After=docker.service` 和 `PartOf=docker.service`，让它随 Docker 一起重载。另外，在远程调试防火墙规则前，可以用 `systemd-run` 挂一个 10 分钟后自动恢复的定时任务兜底，确认新规则无误后再手动取消：

```bash
iptables-save > /root/fw-backup.rules
systemd-run --on-active=600 --unit=fw-rollback \
  /bin/sh -c 'iptables-restore < /root/fw-backup.rules'

# 应用并测试新规则，确认一切正常后取消自动回滚：
systemctl stop fw-rollback.timer
```

## 备份与恢复：三层状态分别处理

虽然所有部署声明都在 Git 里，但单靠 `git clone` 无法在空机器上还原整套服务。系统的完整状态分布在三个层次，需要分别安排备份：

| 层次 | 包含内容 | 存储位置 | 备份方式 |
| :--- | :--- | :--- | :--- |
| **1. 基础设施代码** | `compose.yaml`、`sync.toml`、脚本与文档 | Git 仓库 | 推送至远端代码托管平台 |
| **2. 控制平面数据** | 资源元数据、环境变量密钥、主机连接信息 | Komodo 数据库与宿主机配置 | 每日运行 `km database backup`，单独备份环境文件与通信密钥卷 |
| **3. 业务应用数据** | 各服务的数据库、上传附件、应用内部密钥 | 宿主机 `/srv` 目录 | 数据库 `pg_dumpall` 逻辑导出结合 `/srv` 文件打包 |

![backup-layers](./assets/backup-layers.png)

第一层直接靠 Git 远端保存。

第二层是 Komodo 控制平面自身的数据。自 v1.19 起，Komodo 默认会创建一个每日运行的 `Backup Core Database` 任务，调用内置的 `km database backup` 将 MongoDB 数据导出为压缩包。这里有两样东西不在数据库导出包内，必须额外备份：一是启动 Komodo Core 自身的 `.env` 文件（包含数据库凭据与 Webhook Secret），二是存放 Core 与 Periphery 通信密钥对的目录。此外，Komodo 变量库中的密钥在 MongoDB 内部是以明文存储的（勾选 `is_secret` 只是在界面和日志中隐藏显示），因此数据库备份包本身等同于明文密码本，上传到外部存储前必须加密。

第三层是 `/srv` 下的业务数据。为了避免直接打包正在写入的数据库文件造成数据损坏，可以写一段定时脚本：先遍历所有运行中的 Postgres 容器执行 `pg_dumpall` 做一致性逻辑导出，再打包 `/srv` 目录（排除缓存和可重建的搜索索引）：

```bash title="backup-script.sh"
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/srv/_backups/$(date +%F_%H-%M-%S)"
mkdir -p "$BACKUP_DIR/databases"

# 遍历所有运行中的 Postgres 容器执行逻辑导出
for container in $(docker ps --format '{{.Names}}'); do
  if docker inspect "$container" --format '{{.Config.Image}}' | grep -q postgres; then
    docker exec "$container" pg_dumpall -U postgres | gzip > "$BACKUP_DIR/databases/$container.sql.gz"
  fi
done

# 打包应用数据目录（排除备份目录自身与可重建的缓存、搜索索引）
tar --exclude='/srv/_backups' \
    --exclude='/srv/*/cache' \
    --exclude='/srv/*/elasticsearch' \
    -czf "$BACKUP_DIR/srv_data.tar.gz" /srv
```

生成本地备份包后，用 `restic` 或 `rclone crypt` 在客户端完成加密，再同步到异地对象存储（如 Cloudflare R2 或 Backblaze B2），避免磁盘故障把线上数据和备份一并带走。

遇到整机灾难需要在一台新服务器上重建时，按先恢复控制平面与数据、最后触发部署的顺序执行：

1. 安装 Docker，恢复 Komodo 自身的配置文件与通信密钥，拉起空的 Komodo Core；
2. 导入 Komodo 的 MongoDB 备份，找回所有变量密钥、仓库凭据与 Stack 定义；
3. 解压还原 `/srv` 目录，并将各数据库的 `.sql.gz` 备份导入对应实例；
4. 触发一次 `Redeploy On Push` Procedure，让所有 Stack 在已有数据之上重新拉起；
5. 重建 Elasticsearch 等派生搜索索引。

## 多服务器接入

借助 Core 与 Periphery 分离的设计，纳管新服务器只需要在目标机器上安装 Periphery 代理并接入同一个 Core。根据新机器所处的网络环境，有两种连接方向可选：

![multi-server](./assets/multi-server.png)

*公网 VPS 由 Core 主动连入，处于 NAT 后的内网主机则由 Periphery 主动向外拨号连接 Core*

1. **Inbound 模式（Core 主动连接 Periphery）**：适用于有固定公网 IP 的 VPS。在新机器上启动 Periphery 监听端口（默认 `8120`），防火墙只放行来自 Core 的连接，然后在 Komodo 中填入该机器的地址。
2. **Outbound 模式（Periphery 主动连接 Core）**：适用于家庭内网或处于 NAT 之后、没有公网入口的机器。先在 Komodo 界面生成一个 Onboarding Key，再在内网机器上运行安装脚本，Periphery 就会通过双向 WebSocket 主动拨向 Core，无需配置内网穿透或端口映射：
   ```bash
   curl -sSL https://raw.githubusercontent.com/moghtech/komodo/main/scripts/setup-periphery.py \
     | python3 - \
     --core-address="https://<CORE_DOMAIN>" \
     --connect-as="$(hostname)" \
     --onboarding-key="O-..."
   ```

节点接入后，同样可以在 `komodo/sync.toml` 中用代码声明：

```toml title="komodo/sync.toml"
[[server]]
name = "server-home"
description = "内网存储主机"
tags = ["home"]

[server.config]
address = "http://localhost:8120"
enabled = true
```

后续想把某个服务从公网 VPS 迁移到内网存储主机，在迁好数据后只需把对应 `[[stack]]` 块下的 `server = "server-a"` 改为 `server = "server-home"` 并推送代码即可。不同主机之间的容器如果需要内网互通，可以用 Tailscale 等组网工具将各台宿主机接进同一个虚拟局域网。

## 适用场景与搭建顺序

这套方案适合拥有一两台长期运行的服务器、自托管服务在十个以上、希望日常升级和迁移都有版本记录的个人运维场景。如果一共只有两三个容器，直接手敲 `docker compose` 反而更轻便；而如果到了几十台机器、多人协作的团队规模，则应该直接使用 Kubernetes 配合 Argo CD 或 Flux。

从零开始搭建这套流水线，可以按以下顺序推进：

1. 在首台主机上手动部署 Komodo（Core、Periphery 与数据库）；
2. 创建基础设施 Git 仓库，放入第一个测试服务的 `compose.yaml`，将数据挂载到 `/srv` 并在 `docs/ports.md` 登记端口；
3. 在 Komodo 界面配置好 Git 仓库凭据与环境变量，编写 `sync.toml` 声明该 Stack（设 `deploy = false`）；
4. 配置包含 `RunSync` 与 `BatchDeployStackIfChanged` 两阶段的 Procedure，并将它的 Webhook 挂到 Git 仓库上；
5. 为仓库加上 `yamllint` 和 `docker compose config` 的 CI 检查，再接入 Renovate 自动提单；
6. 配好宿主机的 `DOCKER-USER` 防火墙规则与每日异地加密备份脚本。

文中的目录结构、Procedure 配置、防火墙脚本与备份方案，均可在我的公开仓库 [synthpop123/homelab-infra](https://github.com/synthpop123/homelab-infra) 中查看完整脱敏版本。

## 参考链接

- [Komodo 官方文档](https://komo.do/docs/intro)，Core/Periphery 架构、Stack、Resource Sync、Procedure、Webhook 的相关说明
- [Komodo Resource Sync 文档](https://komo.do/docs/sync)，用 TOML 声明资源
- [Renovate 官方文档](https://docs.renovatebot.com)，docker-compose manager、packageRules、调度与分组
- [OpenGitOps 原则（CNCF）](https://opengitops.dev)，GitOps 四原则的定义
- [Docker Compose 环境变量与插值官方文档](https://docs.docker.com/compose/how-tos/environment-variables/)，`environment`、`env_file` 与 `.env` 的区别
- [How to automate version updates for self-hosted Docker containers with Gitea, Renovate and Komodo](https://nickcunningh.am/blog/how-to-automate-version-updates-for-your-self-hosted-docker-containers-with-gitea-renovate-and-komodo)，同一套链路的相关教程
- [Migrating to Komodo（foxxmd）](https://blog.foxxmd.dev/posts/migrating-to-komodo/)，从其他工具迁移到 Komodo
- [Komodo Tips and Tricks（foxxmd）](https://blog.foxxmd.dev/posts/komodo-tips-tricks/)，Komodo 的实用技巧
- [Scaling Renovate（foxxmd）](https://blog.foxxmd.dev/posts/scaling-renovate/)，多仓库、多服务下如何控制 PR 数量
- [Docker Compose Envs Explained（foxxmd）](https://blog.foxxmd.dev/posts/compose-envs-explained/)，环境变量机制详解
- [Komodo: a better alternative to Portainer（skyblog）](https://skyblog.one/komodo-the-better-alternative-to-portainer-for-container-management/)，Komodo 的定位与使用
