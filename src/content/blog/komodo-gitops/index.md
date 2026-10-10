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

在一台或多台服务器上运行多个自托管服务（如书库、媒体服务、记账工具）时，传统的手动维护方式很容易出现配置碎片化问题：

- 服务配置分散在各处的 `docker-compose.yml`、临时修改的 `.env` 以及未记录的挂载路径中；
- 机器故障或需要迁移时，很难快速还原整套环境；
- 依赖 `latest` 标签会导致更新不可控；固定版本号又容易因忘记跟踪 changelog 而长期缺失安全更新。

将这套环境迁移到 GitOps 模式的核心逻辑是：将所有 Compose 配置提交到 Git 仓库，由 Komodo 负责拉取并执行部署，再通过 Renovate 定期检查上游镜像版本并自动发起更新 PR。

![overview of the article](./assets/gitops-banner.png)

## Docker 单机环境下的 GitOps

GitOps 的核心原则是将基础设施的期望状态以声明式代码存放在版本控制系统（如 Git）中，并由代理程序自动将实际运行环境同步至期望状态。

在大型 Kubernetes 集群中，Argo CD 或 Flux 通常通过常驻进程不断比对状态并处理配置漂移。但在资源有限的个人服务器或小型 VPS 上，运行高强度的对账循环开销较大。更务实的方案是采用**事件驱动**：

1. **版本声明**：服务的镜像版本、端口、挂载目录全部通过 `compose.yaml` 显式声明；
2. **变更留痕**：所有的配置修改、版本升级都以 Git Commit 记录，可直接比对历史与回滚；
3. **Webhook 驱动同步**：向主分支合并代码后，Git 仓库通过 Webhook 触发部署工具执行更新。

![gitops-loop](./assets/gitops-loop.png)

## Komodo 架构与仓库组织

[Komodo](https://komo.do) 是一套开源的容器构建与部署管理平台。其架构分为两个核心组件：

- **Core**：提供 Web 界面、API，并运行后端数据库（默认 MongoDB），用于存储资源定义、全局变量、用户权限和部署记录；
- **Periphery**：运行在各目标服务器上的轻量代理客户端，Core 通过它向目标主机的 Docker 守护进程下发指令。单个 Core 可以管理多个 Periphery 节点。

![komodo-architecture](./assets/komodo-architecture.png)

Komodo 支持通过 TOML 文件管理平台自身的配置。借助 **Resource Sync** 功能，可以将所有服务的定义写入文件并在 Git 中维护。

### 目录结构规划

推荐使用单一 Git 仓库集中管理所有机器和服务配置：

```bash
homelab-infra/
├── komodo/
│   └── sync.toml          # Stack、Procedure 与 Server 的集中声明文件
├── stacks/                # 服务目录，按服务名称划分
│   ├── wallos/
│   │   └── compose.yaml
│   └── immich/
│       ├── compose.yaml
│       └── config.example.yaml  # 抹去敏感信息的配置模板
├── bootstrap/             # Komodo 控制平面本身及主机底座配置（防火墙等）
│   ├── komodo/
│   ├── firewall/
│   └── fail2ban/
├── scripts/
│   └── validate.sh        # CI 与本地使用的语法检查脚本
├── renovate.json          # Renovate 升级规则
└── docs/
    └── ports.md           # 端口分配记录表
```

- `stacks/` 目录下每个服务分配独立文件夹，包含该服务的 `compose.yaml`；
- 持久化数据与运行时文件不存入 Git 仓库，统一挂载到主机固定目录（如 `/srv/<service>/`）；
- Komodo 自身的 Core 和 Periphery 在主机上手动拉起一次即可，其运行配置在 `bootstrap/` 留存备份。

### 服务声明定义

在 `komodo/sync.toml` 中，每个服务被定义为一个 `[[stack]]` 资源：

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

关键配置项说明：
- `server`：指定执行部署的 Periphery 节点；
- `linked_repo`：指向已在 Komodo 界面中配置好的 Repo 名称（代码仓库地址与凭据保存在 Core 中）；
- `run_directory` 与 `file_paths`：指定项目工作目录与 Compose 文件路径；
- `deploy = false`：关闭 Resource Sync 阶段的自动部署，交由后续的 Procedure 统一编排，避免并发部署产生资源锁竞争。

对应的 `compose.yaml` 保持标准写法，可脱离平台直接通过 `docker compose` 运行：

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

![komodo-stacks](./assets/komodo-stacks.png)

## 自动化流水线：从 Git Push 到触发部署

为了避免在新增服务时出现“配置尚未同步到 Core 即触发部署”的竞态问题，需要利用 Komodo 的 **Procedure**（执行流程编排）将更新流程拆分为顺序执行的两个 Stage：

1. **Stage 1 (RunSync)**：拉取最新的 Git 提交，更新 Core 内所有 Stack 的配置元数据；
2. **Stage 2 (BatchDeployStackIfChanged)**：检查实际 Compose 文件或变量是否有变动，仅针对有变更的 Stack 执行重新部署。

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

### Webhook 配置

在 Git 仓库（如 GitHub、Gitea）的 Webhook 设置中，将请求指向该 Procedure：

- **URL 格式**：`https://<CORE_DOMAIN>/listener/github/procedure/Redeploy%20On%20Push/run`
- **Content type**：`application/json`
- **Secret**：填入与 Komodo 一致的 Webhook 密钥。Komodo 会基于请求头中的签名进行鉴权校验。

### 前置语法校验 (CI)

为避免错误的配置提交导致服务端构建异常，建议在代码仓库中配置 CI 流程（如 GitHub Actions），在合并 PR 前运行静态检查：

```bash
# 检查 YAML 结构
yamllint -c .yamllint.yml stacks/
# 校验 Compose 解析与语法
find stacks -name "compose.yaml" -exec docker compose -f {} config -q \;
```

## 通过 Renovate 自动化管理镜像升级

[Renovate](https://docs.renovatebot.com) 可定期扫描仓库中的 `compose.yaml` 文件，向上游 Registry 检查镜像版本，并自动发起带有 Changelog 的更新 PR。

### 版本锁定策略

为了兼顾稳定与可维护性，建议采取差异化的锁定策略：

- **无状态应用**：精确锁定到具体 Patch 版本（如 `app:1.2.3`），由 Renovate 自动提 PR 升级；
- **数据库与中间件**：锁定大版本号（如 `postgres:17`、`redis:8`），跨大版本升级可能涉及数据迁移，需人工介入处理。

### 配置文件示例

```json
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

- `groupName`：将同属于一个应用的多镜像组件合并为单个 PR，避免跨服务升级时产生中间版本不兼容；
- `prConcurrentLimit` 和 `prHourlyLimit`：取消并发更新数量限制，避免更新队列堆积。

![renovate-pr](./assets/renovate-pr.png)

## 环境变量与敏感配置分离

Docker Compose 中变量的使用包含两个不同阶段：

1. **配置插值**：Compose 解析文件时，将 `${VAR}` 替换为主机环境变量或本地 `.env` 文件中的值。该步骤只负责文本替换，并不直接将变量注入容器；
2. **容器环境注入**：通过 `environment:` 或 `env_file:` 字段将变量实际传递至容器进程中。

![compose-env](./assets/compose-env.png)

### 密钥管理方案

生产环境中严禁将明文密码直接写入 Git 仓库，应根据密钥类型分别处理：

1. **环境变量型密钥**（数据库密码、Token 等）：
   - 在 Compose 文件中使用插值占位：
     ```yaml
     environment:
       POSTGRES_PASSWORD: ${APP_DB_PASSWORD}
     ```
   - 在 Komodo 的 **Variables & Secrets** 页面添加真实密文字段；
   - 在 `sync.toml` 中映射该变量：
     ```toml
     environment = """
     APP_DB_PASSWORD=[[APP_DB_PASSWORD]]
     """
     ```
     部署时，Komodo 会将密钥注入到工作目录临时生成的 `.env` 文件中供 Compose 消费，该文件不会提交至 Git。

2. **配置文件型密钥**（如包含敏感信息的 `config.yaml`）：
   - 真实配置文件直接存放在宿主机的持久化路径（如 `/srv/<service>/config.yaml`）；
   - 在 `compose.yaml` 中通过 bind mount 方式挂载至容器内；
   - Git 仓库中仅留存去除了敏感信息的 `config.example.yaml`。

## 基础设施约定：端口、网络与数据持久化

为了防止服务数量增多后产生冲突，需要建立统一的资源规范：

1. **端口按需递增并集中记录**：
   - 外部监听端口从基数（如 `20000`）开始顺序递增，由 `docs/ports.md` 统一登记；
   - 仅供内部通信的容器（如 Postgres、Redis）不映射 Host 端口，直接通过 Docker 内部网络通信。

2. **显式声明默认网络名称**：
   ```yaml
   networks:
     default:
       name: <service_name>
   ```
   避免 Docker 使用默认的前缀命名，方便排查网络及跨 Stack 引用。

3. **数据目录绝对路径挂载**：
   - 严禁将数据写入 Compose 项目相对目录，防止 Git 重新克隆拉取时误删；
   - 持久化数据统一存放在宿主机固定路径（如 `/srv/<service>/`）；
   - 优先使用 bind mount 代替 Docker 命名卷（Named Volumes），便于统一备份和迁移。

4. **宿主机文件权限处理**：
   - 数据目录的权限应匹配镜像内进程的运行身份（例如 Postgres 容器常用 uid `999`）；
   - 迁移目录时使用 `cp -a` 保留原始所属 UID/GID 与访问权限。

## 迁移已有服务

将以往手动部署的服务迁移到当前流水线时，推荐遵循以下步骤：

1. **导出与备份**：
   - 停止旧服务并记录其镜像的完整 Digest（避免直接拉取 tag 时引入意外版本变动）；
   - 将原有 Docker Volume 或本地目录完整拷贝至 `/srv/<service>/`：
     ```bash
     mkdir -p /srv/<service>
     cp -a /var/lib/docker/volumes/<volume_name>/_data /srv/<service>/<dir_name>
     ```
2. **解耦共享数据库**：
   - 尽量避免多个应用共用一个全局数据库实例；
   - 可针对单个数据库执行逻辑导出，并在应用 Stack 中内置独立的 Postgres 容器：
     ```bash
     # 导出指定数据库
     docker exec -i shared-pg pg_dump -U postgres -Fc --no-owner --no-acl db_name > db_name.dump
     ```
3. **编写并提交声明**：
   - 编写 `compose.yaml` 并分配专属端口；
   - 在 Komodo 中维护对应密钥，并在 `sync.toml` 中配置 Stack；
   - 提交代码，触发自动化部署，验证数据一致性后清理旧容器。

## 宿主机网络与防火墙防护

Docker 在暴露端口时会直接修改 iptables 的 PREROUTING 规则，导致入站流量绕过常规的 `INPUT` 链。因此，直接在 `INPUT` 链配置的防护规则无法拦截访问容器端口的请求。

正确的做法是在 Docker 专门预留的 `DOCKER-USER` 链上做限制。

### 规则配置示例

假设仅允许来自反向代理节点（IP: `192.0.2.10`）的流量访问容器对外映射的端口，其余外网连接全部拦截：

```bash
# 1. 允许已有连接的后续包通过
iptables -A DOCKER-USER -i eth0 -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN

# 2. 仅允许指定的反代服务器访问
iptables -A DOCKER-USER -i eth0 -s 192.0.2.10 -j RETURN

# 3. 针对个别确实需要暴露给公网的端口，按原始目的端口放行（基于 ctorigdstport）
iptables -A DOCKER-USER -i eth0 -p tcp -m conntrack --ctorigdstport 2222 -j RETURN

# 4. 其余来自公网网卡（eth0）的流量全部拒绝
iptables -A DOCKER-USER -i eth0 -j DROP
```

> **注意**：经过 DNAT 转换后，传统的 `--dport` 匹配的是容器内部端口，必须使用 `-m conntrack --ctorigdstport` 匹配转换前的宿主机端口。

![firewall-path](./assets/firewall-path.png)

可通过编写 systemd 服务在 Docker 启动后自动应用上述规则，防止 Docker 守护进程重启后覆盖自定义链表。

## 备份体系规划

为了确保整机可恢复，数据备份需划分为三个层次：

| 层次 | 包含内容 | 存储位置 | 备份方案 |
| :--- | :--- | :--- | :--- |
| **1. 基础设施代码** | Compose 配置、sync.toml、自动化脚本 | 远端 Git 仓库 | Git 托管服务自带高可用 |
| **2. 控制平面数据** | 部署元数据、密钥变量、主机连接配置 | Komodo 数据库（MongoDB） | 定期执行 `km database backup` |
| **3. 业务应用数据** | 数据库存储、上传文件、应用私有状态 | 宿主机 `/srv` 目录 | 数据库 `pg_dumpall` 结合全量文件归档 |

![backup-layers](./assets/backup-layers.png)

应用备份的核心是逻辑备份配合文件打包：

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/srv/_backups/$(date +%F_%H-%M-%S)" mkdir -p "$BACKUP_DIR/databases"

# 遍历所有运行中的 Postgres 容器导出数据
for container in $(docker ps --format '{{.Names}}'); do if docker inspect "$container" --format '{{.Config.Image}}' | grep -q postgres; then
    docker exec "$container" pg_dumpall -U postgres \vert{} gzip > "$BACKUP_DIR/databases/$container.sql.gz"
  fi
done

# 打包文件目录（排除临时与可重建数据）
tar --exclude='/srv/_backups' \
    --exclude='/srv/*/cache' \
    -czf "$BACKUP_DIR/srv_data.tar.gz" /srv
```

备份产物建议使用 `restic` 或 `rclone` 进行端到端加密，并同步到异地对象存储中。

## 多服务器接入

当纳管的主机数量增加时，只需在目标机器上部署 Periphery 节点，即可纳入同一个 Core 进行统一调度。

![multi-server](./assets/multi-server.png)

根据网络环境的不同，Periphery 与 Core 之间支持两种通信模式：

1. **Inbound 模式**（Core 主动连接 Periphery）：
   适用于有固定公网 IP 的独立 VPS。Periphery 监听端口（默认 8120），由 Core 发起 TCP 连接。
2. **Outbound 模式**（Periphery 主动连接 Core）：
   适用于家庭宽带内网或处于 NAT 后的节点。在 Core 界面生成 Onboarding Key，节点通过 WebSocket 主动拨向 Core，无需配置公网穿透或端口映射。

接入新节点后，在 `komodo/sync.toml` 中添加节点定义，即可直接将 Stack 分发至该主机执行：

```toml
[[server]]
name = "server-home"
description = "内网存储主机"

[server.config]
address = "http://localhost:8120"
enabled = true
```

## 总结与落地路线

构建基于 Komodo + Renovate 的 Docker Compose 运维环境，核心在于建立标准化的规范：

1. **搭建基础组件**：在首台宿主机部署 Komodo 控制平面；
2. **建立代码基线**：创建基础设施 Git 仓库，收敛敏感环境变量并建立端口使用登记；
3. **编排部署流程**：编写 `sync.toml`，配置 RunSync 与 BatchDeploy 两阶段 Procedure，接入 Git Webhook；
4. **接入自动升级**：配置 Renovate 规则，实现版本依赖检查与可视化提单；
5. **完善安全与容灾**：部署 `DOCKER-USER` 链防火墙，制定数据定期加密导出策略。

通过将零散的 Compose 项目纳入版本控制与自动化流水线中，可以大幅减少手工登录服务器操作的频率，确保每一项系统变更都有迹可循。

### 参考链接

- [Komodo 官方文档](https://komo.do/docs/intro)，Core/Periphery 架构、Stack、Resource Sync、Procedure、Webhook 的相关说明
- [Komodo Resource Sync 文档](https://komo.do/docs/sync)，用 TOML 声明资源
- [Renovate 官方文档](https://docs.renovatebot.com)，docker-compose manager、packageRules、调度与分组
- [OpenGitOps 原则（CNCF）](https://opengitops.dev)，GitOps 四原则的权威定义
- [Docker Compose 环境变量与插值官方文档](https://docs.docker.com/compose/how-tos/environment-variables/)，`environment`、`env_file` 与 `.env` 的区别
- [How to automate version updates for self-hosted Docker containers with Gitea, Renovate and Komodo](https://nickcunningh.am/blog/how-to-automate-version-updates-for-your-self-hosted-docker-containers-with-gitea-renovate-and-komodo)，同一套链路的相关教程
- [Migrating to Komodo（foxxmd）](https://blog.foxxmd.dev/posts/migrating-to-komodo/)，从其他工具迁移到 Komodo
- [Komodo Tips and Tricks（foxxmd）](https://blog.foxxmd.dev/posts/komodo-tips-tricks/)，Komodo 的实用技巧
- [Scaling Renovate（foxxmd）](https://blog.foxxmd.dev/posts/scaling-renovate/)，多仓库、多服务下如何压住 PR 噪音
- [Docker Compose Envs Explained（foxxmd）](https://blog.foxxmd.dev/posts/compose-envs-explained/)，环境变量
- [Komodo: a better alternative to Portainer（skyblog）](https://skyblog.one/komodo-the-better-alternative-to-portainer-for-container-management/)，Komodo 的定位与使用
