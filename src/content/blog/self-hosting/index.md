---
title: "我的 Self-hosting 记录"
description: "Brief notes on my self-hosting experience"
date: 2024-09-27
authors:
  - lkw123
tags:
  - docker
  - serverless
  - cloudflare
  - vercel
  - paas
---

:::note
这篇博文主要用于备份，方便自己在迁移服务时做个参考。
:::

## 前景提要

我的 lkwplus.com 域名最初注册于 Namesilo，后迁移至 Cloudflare，域名解析和 CDN 由 Cloudflare 提供，项目代码托管于 GitHub（Private & Public repo）。

- VPS：腾讯云 2C2G30M 新加坡 LightHouse 服务器、~~VKVM 4C8G500M 洛杉矶 9950X 高性能服务器~~、FameSystems 6C24G EPYC 9654 Root Server；
  - Containerized；
- PaaS：Cloudflare (Pages/Workers)、Vercel、fly.io、Zeabur、~~Netlify、Heroku、Render、Koyeb、Glitch~~；
  - Serverless；
  - Containerized；

## 云服务器

### 媒体库管理方案

:::note
在这里插一句，简要记录下我目前使用的媒体库管理方案。后面有时间可能会单独开一篇文章展开说下。
:::

我的主要媒体资源存放于 115 网盘 (~130 TB)，通过 [p115dav](https://hub.docker.com/r/cgkings/p115dav) 转换为对外的 WebDAV 服务，并使用 [Clouddrive2](https://www.clouddrive2.com/) 将 WebDAV 挂载到本地，采用 [Plex](https://www.plex.tv/) 作为媒体库管理工具进行元数据刮削和影视播放。

个人采用 [Prowlarr](https://prowlarr.com/) 管理各类 Indexer (PT/Usenet)，分别对接下载器 [qBittorrent](https://blog.lkwplus.com/posts/self-hosting#qbittorrent) 和 [SABnzbd](https://blog.lkwplus.com/posts/self-hosting#sabnzbd)，完成资源的下载，使用脚本采用 [torcp](https://github.com/ccf-2012/torcp) 对资源进行符合规范的命名后上传至网盘。

而 [Radarr](https://radarr.video/)（适用于电影）和 [Sonarr](https://sonarr.tv)（适用于剧集）又采用 Prowlarr 作为后端，完成对各类影视剧（已上映和未上映）的资源追踪和格式管理等，感兴趣的各位可以参考 [TRaSH-Guides](https://trash-guides.info/) 实现更高级的媒体自动化请求流程管理。

相比较 Prowlarr 而言，其更多的在自动化方面派上用场，当需要进行手动资源检索时，我个人更倾向使用 [NZBHydra2](https://github.com/theotherp/nzbhydra2)，如下图：

![NZBHydra2](./assets/nzbhydra-ss.jpg)

除此之外，使用 [Overseerr](https://overseerr.dev/) 进行媒体库请求管理，它通过对接 Radarr 和 Sonarr，对媒体请求进行一层代理，并监控媒体请求的进程。它也能很方便展示近期热门的影视海报墙，并呈现库中是否已有该影片，从而可以便携的对未入库的影视发起请求。如下图所示：

![overseerr](./assets/overseerr-ss.jpg)

[Tautulli](https://tautulli.com/) 则可以对整个影视库进行追踪和监控，对各类播放数据进行整理，并自定义通知信息，如新入库的资源和新的串流等。

### 准备工作

#### [安装 Docker](https://docs.docker.com/engine/install/debian/)

1. 卸载旧版本：

```shell
for pkg in docker.io docker-doc docker-compose podman-docker containerd runc; do sudo apt-get remove $pkg; done
```

2. 配置 Docker apt 仓库：

```shell
# Add Docker's official GPG key:
sudo apt-get update
sudo apt-get install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources:
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
```

3. 安装最新版本 Docker：

```shell
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 验证安装成功
sudo docker run hello-world
```

#### 配置 Node 环境

1. 安装 pnpm：

```shell
curl -fsSL https://get.pnpm.io/install.sh | sh -
```

2. 安装 Node.js：

```shell
# LTS 版本
pnpm env use --g lts

# Latest 版本：
pnpm env use --g latest
```

3. 安装 PM2：

```shell
pnpm install -g pm2
```

### Caddy

[文档地址](https://caddyserver.com/docs/)，配置文件路径：`/etc/caddy/Caddyfile`

stable releases 安装方式：

```shell
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

Caddyfile 配置文件示例：

```nginx title="/etc/caddy/Caddyfile" showLineNumbers /reverse_proxy/
# The Caddyfile is an easy way to configure your Caddy web server.
#
# Unless the file starts with a global options block, the first
# uncommented line is always the address of your site.
#
# To use your own domain name (with automatic HTTPS), first make
# sure your domain's A/AAAA DNS records are properly pointed to
# this machine's public IP, then replace ":80" below with your
# domain name.
{
	servers {
		metrics
	}
}

:2019 {
	metrics /metrics
}

:80 {
	# Set this path to your site's directory.
	root * /usr/share/caddy

	# Enable the static file server.
	file_server

	# Another common task is to set up a reverse proxy:
	# reverse_proxy localhost:8080

	# Or serve a PHP site through php-fpm:
	# php_fastcgi localhost:9000
}

alist.lkwplus.com {
	reverse_proxy 127.0.0.1:5244
}
# Refer to the Caddy docs for more information:
# https://caddyserver.com/docs/caddyfile
```

常用命令：

```shell
# 启动
systemctl start caddy
caddy start --config /etc/caddy/Caddyfile
# 关闭
systemctl stop caddy
caddy stop
# 重载配置文件
caddy reload --config /etc/caddy/Caddyfile
# 格式化 Caddyfile
caddy fmt --overwrite /etc/caddy/Caddyfile
```

### [SABnzbd](https://sabnzbd.lkwplus.com/)

Usenet 即新闻组，是一种历史久远的互联网产物，在早期主要用于论坛式的交流讨论，现在已经逐渐转化为文件存档类的服务，如想更多了解这个方向，可以在 [r/usenet](https://www.reddit.com/r/usenet/) 等社区论坛上进行探索。

现在 Usenet 的使用体系由三部分构成：

- Indexer（索引器）：负责在 Usenet 站点上搜集并索引内容，存储在索引库中。由于很多文件在上传时会经过加密或混淆处理，没有合适的 Indexer 很难从 Usenet 上获取高质量的资源。互联网上有少数的免费 Indexer 可供选择，但质量参差不齐，往往需要付费订阅多个 Indexer 站点从而获取更高质量的资源、更多的 API Quota；
- Provider（服务商）：提供 Usenet 资源的 Post 和 Download 服务，由于 Usenet 上的资源十分庞大，各大服务商会根据自己的策略选择性地同步和存储部分内容。为了优雅的使用 Usenet 服务，往往需要付费订阅多个 Provider（不同 Backbone 的 Provider 间互相补充）来获取你所需的资源；
- Downloader（下载器）：Downloader 是传入 nzb 文件，将 Usenet 上的资源下载到本地的工具。SABnzbd 是目前使用体验最好的两个 nzb 下载器之一（另一个是 [NZBGet](https://github.com/nzbgetcom/nzbget)）。

可以配合 [Sonarr](https://github.com/Sonarr/Sonarr)、[Radarr](https://github.com/Radarr/Radarr)、[Overseerr](https://github.com/sct/overseerr) 等各类媒体管理工具，从而实现影视资源的自动入库和刮削，这是一个漫长的但有意思的折腾之路。

```yaml title="docker-compose.yml" showLineNumbers
services:
  sabnzbd:
    image: lscr.io/linuxserver/sabnzbd:latest
    container_name: sabnzbd
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Asia/Shanghai
    volumes:
      - /opt/sabnzbd/config:/config
      - /opt/sabnzbd/downloads:/downloads
      - /opt/sabnzbd/tmp:/incomplete-downloads
    ports:
      - 127.0.0.1:12467:8080
    restart: unless-stopped
```

### [Alist](https://alist.lkwplus.com/)

[文档地址](https://alist.nn.ci/zh/guide/)，安装目录: `/opt/alist`

```shell
# 安装
curl -fsSL "https://alist.nn.ci/v3.sh" | bash -s install
# 更新
curl -fsSL "https://alist.nn.ci/v3.sh" | bash -s update
# 卸载
curl -fsSL "https://alist.nn.ci/v3.sh" | bash -s uninstall
```

服务状态则通过 systemctl 管理：

```shell
# 启动
systemctl start alist
# 关闭
systemctl stop alist
# 状态
systemctl status alist
# 重启
systemctl restart alist
```

创建管理员密码：

```shell
/path/to/alist/alist admin set NEW_PASSWORD
```

对于个人而言，在配置文件 `data/config.json` 中修改以下内容：

```json title="data/config.json" showLineNumbers
{
  "site_url": "https://alist.lkwplus.com",
  "token_expires_in": 48,
  "scheme": {
    "address": "127.0.0.1", // 限制本机访问，外网访问通过 Caddy 反向代理
    "http_port": 5244
  }
}
```

添加如下存储源：

- 坚果云：协议为 WebDAV；
- 115 网盘：WebDAV 策略为 302 重定向，使得本地可快速访问，Cookie 则通过 [Stream](https://apps.apple.com/us/app/stream-network-debug-tool/id1312141691) 软件获取自 115 官方微信小程序，有效期可达一年；
- Cloudflare R2：对象存储，有多个 Bucket 需要添加，统一置于 `/cloudflare-r2` 顶层目录下；
  - 地区：不可填默认的 auto，需要根据实际情况填入 Bucket 所在区域，如 apac、wnam；
  - 自定义 host：根据个人在 Cloudflare 上为 R2 绑定的域名进行填写，如 `https://img.lkwplus.com`；
- 本机存储。

### [Dozzle](https://dozzle.lkwplus.com/)

[文档地址](https://dozzle.dev/)，安装目录 `/opt/dozzle`。

Dozzle 是一个轻量的 Docker 容器日志监视器，可以实时监视 Docker 容器的日志输出，并以可视化的方式呈现，同时还支持 SQL Analytics 等，功能强大，如下图：

![Dozzle 界面](https://img.lkwplus.com/dozzle-screenshot.webp)

首先建立数据目录 `/opt/dozzle/data`，然后通过 Dozzle 的 generate 命令创建 users.yaml 文件，用于 Web 界面用户鉴权：

```shell
docker run amir20/dozzle generate lkw123 --password password --email test@email.net --name "John Doe" > data/users.yml
```

生成的 users.yml 文件内容中记录了用户信息和经过 hash 后的密码，对于版本在 8.5.1 前的 Dozzle 实例，采用 sha-256 算法进行加密，存在[安全隐患](https://security.stackexchange.com/questions/195563/why-is-sha-256-not-good-for-passwords)，而自 Patched version 8.5.3 起，则采用 bcrypt 算法加密密码。

`data/users.yml` 形如：

```yaml title="data/users.yml" showLineNumbers
users:
  lkw123:
    email: test@example.com
    name: lkw123
    password: $2a$11$jZEMe2xxxxx
```

`docker-compose.yml` 文件内容如下：

```yaml title="docker-compose.yml" showLineNumbers
services:
  dozzle:
    image: amir20/dozzle:latest
    container_name: dozzle
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /opt/dozzle/data:/data
    environment:
      - DOZZLE_AUTH_PROVIDER=simple # 开启 auth 功能
      - DOZZLE_NO_ANALYTICS=true # 关闭向 Dozzle 发送匿名统计数据
    ports:
      - 127.0.0.1:18083:8080
    restart: unless-stopped
```

可以在多台服务器上运行 Dozzle agent，另一台服务器上通过 `DOZZLE_REMOTE_AGENT` 环境变量指定 Remote Agent 的地址，即可实现多主机的日志展示，详见[文档](https://dozzle.dev/guide/agent)。

### [Open WebUI](https://oi.lkwplus.com/)

[文档地址](https://docs.openwebui.com/)，安装目录 `/opt/open-webui`。

#### Docker 安装

```yaml title="docker-compose.yml" showLineNumbers
services:
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    container_name: open-webui
    ports:
      - 127.0.0.1:18081:8080
    environment:
      - ENABLE_OLLAMA_API=false
      - OPENAI_API_KEY={your_secret_key}
      - OPENAI_API_BASE_URL={your_openai_api_base_url}
      - DEFAULT_MODELS=gpt-4o
      - ENABLE_MESSAGE_RATING=false
    volumes:
      - /opt/open-webui/data:/app/backend/data
    restart: unless-stopped
```

#### pip 安装

采用 [uv](https://github.com/astral-sh/uv) 管理 Python 虚拟环境，安装方式如下：

```shell
curl -LsSf https://astral.sh/uv/install.sh | sh
```

创建虚拟环境并安装 Open WebUI：

```shell
uv venv
source .venv/bin/activate
uv pip install open-webui
```

创建 `ecosystem.config.js` 用于 pm2 进行进程管理：

```javascript title="ecosystem.config.js" showLineNumbers
module.exports = {
  apps: [
    {
      name: 'open-webui',
      script: '.venv/bin/open-webui',
      args: 'serve',
      cwd: '/opt/open-webui',
      interpreter: '/bin/bash',
      interpreter_args: '-c "source .venv/bin/activate && exec $0 $@"',
      error_file: './logs/open-webui-error.log',
      out_file: './logs/open-webui-out.log',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
}
```

启动 Open WebUI：

```shell
pm2 start ecosystem.config.js

# 保存状态
pm2 save
# 设置开机自启
pm2 startup
```

### [Glance](https://glance.lkwplus.com/)

[文档地址](https://github.com/glanceapp/glance/blob/main/docs/configuration.md)，安装目录 `/opt/glance`。

Glance 是一个定制化程度比较高的、用于各类信息源集中展示的 dashboard。

官方给出了一个 [Preconfigured page](https://github.com/glanceapp/glance/blob/main/docs/configuration.md#preconfigured-page) 对应的配置文件，可以先上手按照搭建出来，后面再根据自己的需求逐步修改面板的布局、功能、信息源等。配置文件路径为：`/opt/glance/glance.yml`

```yaml title="docker-compose.yml" showLineNumbers
services:
  glance:
    image: glanceapp/glance:latest
    container_name: glance
    volumes:
      - /opt/glance/glance.yml:/app/glance.yml
      - /etc/timezone:/etc/timezone:ro
      - /etc/localtime:/etc/localtime:ro
    ports:
      - 127.0.0.1:13242:8080
    restart: unless-stopped
```

### n8n

n8n 可用于构建自动化工作流，是 IFTTT 的开源替代，有各类软件集成，通过 Web UI 可以很方便的对自动化流程进行编辑与配置。[文档地址](https://docs.n8n.io/hosting/installation/docker)。

```yaml title="docker-compose.yml" showLineNumbers
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n:latest
    container_name: n8n
    restart: unless-stopped
    environment:
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=host.docker.internal
      - DB_POSTGRESDB_PORT=5444
      - DB_POSTGRESDB_DATABASE=n8n
      - DB_POSTGRESDB_USER=n8n
      - DB_POSTGRESDB_PASSWORD=<PASSWORD>
    ports:
      - 127.0.0.1:15678:5678
    volumes:
      - /opt/n8n/n8n-storage:/home/node/.n8n
    extra_hosts:
      - host.docker.internal:host-gateway
```

---

下面介绍的是一个简单的 Grafana + Prometheus + blabla-exporter + cAdvisor 构建的个人服务器监控体系：

### Node Exporter

参考官方的 [GitHub README](https://github.com/prometheus/node_exporter)，照抄配置文件即可。

Node Exporter 和下面的 Postgres Exporter 均采用 host 模式，直接使用宿主机的网络，从而便携的对相关资源进行监控。

```yaml title="docker-compose.yml" showLineNumbers
services:
  node_exporter:
    image: quay.io/prometheus/node-exporter:latest
    container_name: node_exporter
    command:
      - '--path.rootfs=/host'
    network_mode: host
    pid: host
    restart: unless-stopped
    volumes:
      - '/:/host:ro,rslave'
```

### Postgres Exporter

用于监控 PostgreSQL 数据库的 Exporter。

```yaml title="docker-compose.yml" showLineNumbers
services:
  postgres-exporter:
    image: quay.io/prometheuscommunity/postgres-exporter:latest
    container_name: postgres_exporter
    environment:
      DATA_SOURCE_URI: 'localhost:5444/postgres?sslmode=disable'
      DATA_SOURCE_USER: '{your_username}'
      DATA_SOURCE_PASS: '{your_password}'
    network_mode: host
    restart: unless-stopped
```

### cAdvisor

监控容器资源可以有多种方案，这里采用 cAdvisor，它是一个运行在 Docker 容器内的、提供容器资源监控的工具。[GitHub README](https://github.com/google/cadvisor?tab=readme-ov-file)

由于 Prometheus 实例和 cAdvisor 实例间通信通过 docker network 内部完成，因此可以省略掉 `ports` 配置。

```yaml title="docker-compose.yml" showLineNumbers
services:
  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    container_name: cadvisor
    privileged: true
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
      - /dev/disk/:/dev/disk:ro
    devices:
      - /dev/kmsg
    command:
      - '--docker_only=true'
      - '--housekeeping_interval=10s'
      - '--disable_metrics=disk,udp,referenced_memory,cpu_topology,resctrl,tcp,advtcp,sched,process,hugetlb,percpu'
    restart: unless-stopped
    networks:
      - monitoring

networks:
  monitoring:
    external: true
```

### [Beszel](https://beszel.lkwplus.com/)

Beszel 是一个轻量级的服务器监控工具，功能强大、前端界面美观，支持 Docker 监控和告警等。暂时选用 Beszel 作为容器资源监控的方案，替换掉了之前的 cAdvisor。[GitHub README](https://github.com/henrygd/beszel?tab=readme-ov-file)。

```yaml title="docker-compose.yml" showLineNumbers
services:
  beszel:
    image: henrygd/beszel:latest
    container_name: beszel
    restart: unless-stopped
    ports:
      - 127.0.0.1:18096:8090
    volumes:
      - /opt/beszel/beszel_data:/beszel_data
    extra_hosts:
      - host.docker.internal:host-gateway
```

进入页面后会要求设置初始管理员账户，添加需要进行监控的主机的相关 IP、端口信息，Beszel 会自动生成 agent 部署所需的 `docker-compose.yml`。在放行相关端口的防火墙策略后，便可在目标主机启动 agent 开启监控。

### Prometheus

为了使得 Prometheus 实例和 Grafana、cAdvisor 实例间顺畅通信，可以创建一个 docker network，命名为 monitering，并在相关的 docker-compose 配置文件中做好相关的定义，使其加入到这个 network 中。

同时，为了使得 Promethus 可以向 Node Exporter 和 Postgres Exporter 等采集数据，可以配置 `extra_hosts` 选项，将宿主机的 IP 地址映射到容器内的 `host.docker.internal`。

```yaml title="docker-compose.yml" showLineNumbers
services:
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    hostname: prometheus
    restart: unless-stopped
    volumes:
      - /opt/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - /opt/prometheus/data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--web.enable-lifecycle'
    ports:
      - 127.0.0.1:19090:9090
    networks:
      - monitoring
    extra_hosts:
      - host.docker.internal:host-gateway

networks:
  monitoring:
    external: true
```

同时，通过 Prometheus 的配置文件 `prometheus.yml`，定义各类 job，如下：

```yaml title="prometheus.yml" showLineNumbers
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']
        labels:
          instance: prometheus
  - job_name: node
    static_configs:
      - targets: ['host.docker.internal:9100']
  - job_name: postgres
    static_configs:
      - targets: ['host.docker.internal:9187']
  - job_name: caddy
    static_configs:
      - targets: ['host.docker.internal:2019']
  - job_name: cadvisor
    scrape_interval: 30s
    static_configs:
      - targets: ['cadvisor:8080']
```

共定义了五个 job，每个 job 后续在 Grafana 对应一个 Dashboard，展示相关数据：

- `prometheus`：Prometheus 自身的监控指标，默认对外提供服务于 `http://localhost:9090`；
- `node`：Node Exporter 采集的主机资源数据，由于采用 host 模式，可以通过 `http://host.docker.internal:9100` 访问宿主机的 9100 端口获取数据；
- `postgres`：Postgres Exporter 采集的数据库资源数据，由于采用 host 模式，可以通过 `http://host.docker.internal:9187` 访问宿主机的 9187 端口获取数据；
- `caddy`：Caddy 自身提供 Metrics 获取接口以供 Prometheus 采集，需要在 Caddyfile 中进行配置，开启 Metrics 接口：

  ```nginx title="/etc/caddy/Caddyfile" showLineNumbers
  {
    servers {
      metrics
    }
  }

  :2019 {
    metrics /metrics
  }
  ```

- `cadvisor`：cAdvisor 采集的容器资源数据，由于 Prometheus 和 cAdvisor 在同一个 docker network 中，因此通过 `http://cadvisor:8080` 可以访问到。

### [VictoriaMetrics](https://victoriametrics.lkwplus.com/)

经过对比，由 Prometheus 切换至单节点部署的 VictoriaMetrics，在存储空间、性能、系统资源占用方面都有明显提升。需要部署两个容器：

- `victoria-metrics`：用于存储和查询时间序列数据，采用单机模式部署；
- `vmagent`：用于从数据源抓取信息，并将其上报到 VictoriaMetrics。

`docker-compose.yml` 文件内容如下：

```yaml title="docker-compose.yml" showLineNumbers
services:
  victoriametrics:
    image: victoriametrics/victoria-metrics:latest
    container_name: victoriametrics
    hostname: victoriametrics
    restart: unless-stopped
    volumes:
      - /opt/victoriametrics/data:/victoria-metrics-data
    command:
      - '--storageDataPath=/victoria-metrics-data'
      - '--httpListenAddr=:8428'
      - '--retentionPeriod=1'
    ports:
      - 127.0.0.1:18428:8428
    networks:
      - monitoring
    extra_hosts:
      - host.docker.internal:host-gateway

  vmagent:
    image: victoriametrics/vmagent:latest
    container_name: vmagent
    hostname: vmagent
    restart: unless-stopped
    volumes:
      - /opt/victoriametrics/vmagent.yml:/etc/vmagent/vmagent.yml
    command:
      - '--promscrape.config=/etc/vmagent/vmagent.yml'
      - '--remoteWrite.url=http://victoriametrics:8428/api/v1/write'
    networks:
      - monitoring
    depends_on:
      - victoriametrics
    extra_hosts:
      - host.docker.internal:host-gateway

networks:
  monitoring:
    external: true
```

配置文件 `vmagent.yml` 可与此前的 `prometheus.yml` 基本兼容，部分不支持的字段会默认跳过不进行严格校验。

下面简要描述为 [vmagent](https://vmagent.lkwplus.com/) 和 [VictoriaMetrics](https://victoriametrics.lkwplus.com/) 配置 Basic Auth 认证的过程。

- 修改 `docker-compose.yml`，在各 service 的 command 部分添加命令行参数：
  - 对于 VictoriaMetrics，添加 `--httpAuth.username={user1}` 和 `--httpAuth.password={pwd1}` 用于自身的身份认证；
  - 对于 vmagent，添加 `--remoteWrite.basicAuth.username={user1}` 和 `--remoteWrite.basicAuth.password={pwd1}`，用于 remote write 推送数据时进行认证；添加 `--httpAuth.username={user2}` 和 `--httpAuth.password={pwd2}` 用于自身的身份认证；
- 修改 `vmagent.yml`，为 vmagent 从自身拉取 metrics 指标时添加认证：
  ```yaml title="/opt/victoriametrics/vmagent.yml" ins={3-5,9-11}
  scrape_configs:
    - job_name: victoriametrics
      basic_auth:
        username: '{user1}'
        password: '{pwd1}'
      static_configs:
        - targets: ['victoriametrics:8428']
    - job_name: vmagent
      basic_auth:
        username: '{user2}'
        password: '{pwd2}'
      static_configs:
        - targets: ['localhost:8429']
  ```
- 在 Grafana 中配置数据源时选择 Prometheus，添加 VictoriaMetrics 实例，并添加 Basic Auth 认证信息。

认证会在三个阶段进行：

- 访问 vmagent 和 VictoriaMetrics 的 WebUI；
- vmagent 向 VictoriaMetrics 进行 remote write 推送数据指标；
- Grafana 对接 VictoriaMetrics 进行数据查询并展示为图表。

### [Grafana](https://grafana.lkwplus.com/)

安装 Grafana 时会默认将数据存储于 sqlite3。考虑到性能和高可用等因素，可以选用 Postgres 等作为数据库，在常规的 Docker Compose 配置文件中加入如下环境变量即可：

```yaml title="docker-compose.yml" showLineNumbers
- GF_DATABASE_TYPE=postgres
- GF_DATABASE_HOST=host.docker.internal:5444
- GF_DATABASE_NAME=grafana
- GF_DATABASE_USER=grafana
- GF_DATABASE_PASSWORD={your_password}
- GF_DATABASE_SSL_MODE=disable
```

`docker-compose.yml` 文件内容如下：

```yaml title="docker-compose.yml" showLineNumbers
services:
  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    restart: unless-stopped
    environment:
      - GF_SERVER_ROOT_URL=https://grafana.lkwplus.com/
    extra_hosts:
      - host.docker.internal:host-gateway
    ports:
      - 127.0.0.1:19823:3000
    volumes:
      - /opt/grafana/data:/var/lib/grafana
    networks:
      - monitoring

networks:
  monitoring:
    external: true
```

对应 Prometheus 中的五个 job，在 Grafana 中添加如下 Dashboard，用于不同类别的监控信息展示：

- [Prometheus 2.0](https://grafana.com/grafana/dashboards/3681-prometheus2-0/)
- [Node Exporter Full](https://grafana.com/grafana/dashboards/1860-node-exporter-full/)
- [PostgreSQL Database](https://grafana.com/grafana/dashboards/9628-postgresql-database/)
- [Caddy Exporter](https://grafana.com/grafana/dashboards/14280-caddy-exporter/)
- [cAdvisor Docker Insights](https://grafana.com/grafana/dashboards/19908-docker-container-monitoring-with-prometheus-and-cadvisor/)

### [Gitea](https://git.lkwplus.com/)

一个基于 Go 语言开发的轻量级的 Git 服务器，[文档地址](https://docs.gitea.cn/category/installation)。

```yaml title="docker-compose.yml" showLineNumbers
services:
  server:
    image: gitea/gitea:latest
    container_name: gitea
    environment:
      - USER_UID=1000
      - USER_GID=1000
      - GITEA__database__DB_TYPE=postgres
      - GITEA__database__HOST=host.docker.internal:5444
      - GITEA__database__NAME=gitea
      - GITEA__database__USER=gitea
      - GITEA__database__PASSWD={your_password}
    restart: unless-stopped
    extra_hosts:
      - host.docker.internal:host-gateway
    volumes:
      - /opt/gitea/data:/data
      - /etc/timezone:/etc/timezone:ro
      - /etc/localtime:/etc/localtime:ro
    ports:
      - 127.0.0.1:13099:3000
      - 222:22
```

### [qBittorrent](https://qb.lkwplus.com/)

安装目录 `/opt/qbittorrent`，`docker-compose.yml` 文件内容如下：

```yaml title="docker-compose.yml" showLineNumbers
services:
  qbittorrent:
    image: linuxserver/qbittorrent:latest
    container_name: qbittorrent
    environment:
      - TZ=Asia/Shanghai
      - UMASK_SET=022
      - WEBUI_PORT=8081
    volumes:
      - /opt/qbittorrent/config:/config
      - /opt/qbittorrent/downloads:/downloads
    ports:
      - 65231:65231
      - 65231:65231/udp
      - 127.0.0.1:8081:8081
    restart: unless-stopped
```

### [your_spotify](https://spotify.lkwplus.com/)

一个很美观的 Spotify 听歌记录展示页面，[项目地址](https://github.com/Yooooomi/your_spotify)，由三部分组成：

- `your_spotify_server`：后端服务，负责提供 API 接口；
- `your_spotify_client`：前端客户端，负责展示数据；
- `mongodb:6`：数据库，负责存储数据。

为了节省资源，我省去了部署 MongoDB 的步骤，使用的是来自外部的免费 [MongoDB](https://www.mongodb.com/) 实例，通过 `MONGO_ENDPOINT` 环境变量进行声明。

值得注意的是，在部署完毕后 Web 端和服务端一直无法进行通信导致无法 Auth，最终解决方案是在 Cloudflare 域名解析中将 `API_ENDPOINT` 的 Proxy Status 设置为 DNS only（即关闭小黄云）。

在管理面板创建 token 后，可以将自己的 Spotify 数据分析面板分享给访客，[示例效果](https://spotify.lkwplus.com/?token=55177428-8fac-4cd7-9b02-7b93db6f3541)。

```yaml title="docker-compose.yml" showLineNumbers
services:
  server:
    image: yooooomi/your_spotify_server:latest
    container_name: your_spotify_server
    restart: unless-stopped
    ports:
      - 127.0.0.1:18777:8080
    environment:
      API_ENDPOINT: https://your-spotify.lkwplus.com
      CLIENT_ENDPOINT: https://spotify.lkwplus.com
      TIMEZONE: Asia/Shanghai
      SPOTIFY_PUBLIC: { your_spotify_client_id }
      SPOTIFY_SECRET: { your_spotify_secret }
      MONGO_ENDPOINT: mongodb+srv://lkw123:{password}@cluster0.kopgi.mongodb.net/your_spotify?retryWrites=true&w=majority&appName=Cluster0
      MONGO_NO_ADMIN_RIGHTS: true
      CORS: i-want-a-security-vulnerability-and-want-to-allow-all-origins

  web:
    image: yooooomi/your_spotify_client:latest
    container_name: your_spotify_client
    restart: unless-stopped
    ports:
      - 127.0.0.1:13241:3000
    environment:
      API_ENDPOINT: https://your-spotify.lkwplus.com
```

### [Opengist](https://gist.lkwplus.com/)

GitHub Gist 的开源替代，[项目地址](https://github.com/thomiceli/opengist)。

```yaml title="docker-compose.yml" showLineNumbers
services:
  opengist:
    image: ghcr.io/thomiceli/opengist:1
    container_name: opengist
    restart: unless-stopped
    ports:
      - 127.0.0.1:16157:6157 # Web
      - 2222:2222 # SSH
    volumes:
      - /opt/opengist/data:/opengist
```

### [Hoarder](https://hoarder.lkwplus.com/)

此前一直使用 Omnivore 作为稍后读工具，存档一些值得阅读学习的文章、项目链接等，而近期该项目宣布停止服务，于是便开始寻找一款合适的开源自部署的「书签、网页存档、稍后读」工具。

在搜寻了一些社区的讨论后，通过筛选 [selfh.st](https://selfh.st/apps/?tag=Bookmarks) 中标签为 Bookmarks 的项目，了解到 [Linkwarden](https://github.com/linkwarden/linkwarden)、[Readeck](https://codeberg.org/readeck/readeck?ref=selfh.st)、[Linkding](https://github.com/sissbruecker/linkding) 等活跃的社区项目替代品。

我比较看重经由接入 OpenAI API 自动根据网页内容生成标签的功能，选择 [Hoarder](https://github.com/hoarder-app/hoarder) 作为新的稍后读工具。安装部署流程详见 [官方文档](https://docs.hoarder.app/Installation/docker)。

### [Redis](https://redis.lkwplus.com/)

安装目录 `/opt/redis`，`docker-compose.yml` 文件内容如下：

```yaml title="docker-compose.yml" showLineNumbers
services:
  redis:
    image: redis:latest
    container_name: redis
    restart: unless-stopped
    ports:
      - 6479:6379
    volumes:
      - /opt/redis/data:/data
      - /opt/redis/redis.conf:/usr/local/etc/redis/redis.conf
      - /opt/redis/logs:/logs
    command: redis-server /usr/local/etc/redis/redis.conf --appendonly yes --requirepass '{your_password}'
```

### [Vikunja](https://todo.lkwplus.com/)

[Vikunja](https://kolaente.dev/vikunja/vikunja) 是一个开源的 Todo 应用，整体体验还不错，但目前功能有一定的局限性，例如在 iOS 上工作不正常、无法离线使用等，后续可能会寻找其他 Todo 类的开源替代。

后端数据库可选用 mariadb、postgres、sqlite 等，`docker-compose.yml` 文件内容如下：

```yaml title="docker-compose.yml" showLineNumbers
services:
  vikunja:
    image: vikunja/vikunja:latest
    container_name: vikunja
    environment:
      VIKUNJA_SERVICE_PUBLICURL: https://todo.lkwplus.com
      VIKUNJA_DATABASE_HOST: vikunja_db
      VIKUNJA_DATABASE_PASSWORD: { db_password }
      VIKUNJA_DATABASE_TYPE: postgres
      VIKUNJA_DATABASE_USER: vikunja
      VIKUNJA_DATABASE_DATABASE: vikunja
      VIKUNJA_SERVICE_JWTSECRET: { jwt_secret }
      VIKUNJA_SERVICE_TIMEZONE: Asia/Shanghai
      VIKUNJA_DEFAULTSETTINGS_WEEK_START: 1 # 0 表示周日；1 表示周一
      VIKUNJA_SERVICE_ENABLEREGISTRATION: true
    ports:
      - 127.0.0.1:13456:3456
    volumes:
      - /opt/vikunja/files:/app/vikunja/files
    depends_on:
      vikunja_db:
        condition: service_healthy
    restart: unless-stopped

  vikunja_db:
    image: postgres:16
    container_name: vikunja_db
    environment:
      POSTGRES_PASSWORD: { db_password }
      POSTGRES_USER: vikunja
    volumes:
      - vikunja_db:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -h localhost -U $$POSTGRES_USER']
      interval: 10s

volumes:
  vikunja_db:
```

### [Changedetection.io](https://changedetection.lkwplus.com)

[Changedetection.io](https://github.com/dgtlmoon/changedetection.io) 是一个开源的网页变更监控工具，可以监控网页内容的变化并及时通知。它支持多种监控方式，包括文本内容、CSS 选择器、JSON 数据等，还可以设置过滤规则来忽略不需要关注的变化。可用于监测博客文章更新或是 VPS 商家补货等。

需要注意的是，Changedetection 通过 [apprise](https://github.com/caronc/apprise) 实现消息的实时通知，例如 Telegram Bot 的通知方式可定义为 `tgram://bottoken/ChatID`。

```yaml title="docker-compose.yml" showLineNumbers
services:
  changedetection:
    image: dgtlmoon/changedetection.io:latest
    container_name: changedetection
    hostname: changedetection
    volumes:
      - changedetection_data:/datastore
    environment:
      - PUID=1000
      - PGID=1000
      - BASE_URL=https://changedetection.lkwplus.com
      - DISABLE_VERSION_CHECK=true
      - TZ=Asia/Shanghai
    ports:
      - 127.0.0.1:15000:5000
    restart: unless-stopped

volumes:
  changedetection_data:
```

### [SFTPGo](https://sftpgo.lkwplus.com/)

[SFTPGo](https://github.com/drakkan/sftpgo) 是一个功能强大的 SFTP 服务器，可以通过界面美观简洁的 WebUI 进行用户管理和文件操作，支持 FTP、SFTP、SCP、WebDAV 等多种协议，并支持多种认证方式。

```yaml title="docker-compose.yml" showLineNumbers
services:
  sftpgo:
    image: drakkan/sftpgo:alpine
    container_name: sftpgo
    environment:
      - TZ=Asia/Shanghai
    ports:
      - 127.0.0.1:18080:8080 # WebUI
      - 8090:8090
      - 2022:2022
    volumes:
      - /opt/sftpgo/data:/srv/sftpgo
      - /opt/sftpgo/config:/var/lib/sftpgo
    restart: unless-stopped
```

### PG Back Web

[PG Back Web](https://github.com/eduardolat/pgbackweb) 是一个开源的 PostgreSQL 备份管理工具，可以通过 WebUI 进行备份管理，将数据库定期备份于本地和 S3 等对象存储。安装部署流程详见 [GitHub README](https://github.com/eduardolat/pgbackweb/?tab=readme-ov-file#installation)。类似的解决方案还有 [Docker PG Backup](https://github.com/kartoza/docker-pg-backup) 等。

### [WeWeRSS](https://wewerss.lkwplus.com/)

[文档地址](https://github.com/cooderl/wewe-rss#%E9%83%A8%E7%BD%B2)，用于将微信公众号转为 RSS Feed，体验还不错，订阅了一些技术类的公众号。

```yaml title="docker-compose.yml" showLineNumbers
services:
  app:
    image: cooderl/wewe-rss-sqlite:latest
    container_name: wewerss
    ports:
      - 127.0.0.1:4005:4000
    environment:
      # 数据库连接地址
      # - DATABASE_URL=file:../data/wewe-rss.db
      - DATABASE_TYPE=sqlite
      # 服务接口请求授权码
      # - AUTH_CODE=0211
      # 提取全文内容模式
      # - FEED_MODE=fulltext
      # 定时更新订阅源Cron表达式
      # - CRON_EXPRESSION=35 5,17 * * *
      # 服务接口请求限制，每分钟请求次数
      # - MAX_REQUEST_PER_MINUTE=60
      # 外网访问时，需设置为服务器的公网 IP 或者域名地址
      - SERVER_ORIGIN_URL=https://wewerss.lkwplus.com
    restart: unless-stopped
    volumes:
      # 映射数据库文件存储位置，容器重启后不丢失
      - /opt/wewerss/data:/app/data
```

### [Moments](https://moments.lkwplus.com/)

极简朋友圈风格的个人站点，用来无聊的时候瞎哔哔几句，[项目地址](https://github.com/kingwrcy/moments)。

```yaml title="docker-compose.yml" showLineNumbers
services:
  moments:
    image: kingwrcy/moments:latest
    container_name: moments
    ports:
      - 127.0.0.1:16237:3000
    volumes:
      - /opt/moments/data:/app/data
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro
    restart: unless-stopped
```

### [Remark42](https://remark42.lkwplus.com/)

用于博客评论，[项目地址](https://github.com/umputun/remark42)，和其它主流评论系统相比，Remark42 该有的功能都不缺，整体体验还不错，支持登录的社交媒体也相当全面。

若不方便部署在自己的服务器，也可以参考博文 [使用 Remark42 和 Fly.io 搭建免费评论系统](https://www.pseudoyu.com/zh/2024/07/22/free_commenting_system_using_remark42_and_flyio/) 选择部署在 Fly.io 上。

```yaml title="docker-compose.yml" showLineNumbers
services:
  remark:
    image: umputun/remark42:latest
    container_name: remark42
    hostname: remark42
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '5'
    ports:
      - 127.0.0.1:18431:8080
    environment:
      - TIME_ZONE=Asia/Shanghai
      - REMARK_URL=https://remark42.lkwplus.com
      - SECRET={your_secret} # openssl rand -hex 16
      - SITE=blog
      - ADMIN_SHARED_ID={your_admin_shared_id}
      - AUTH_GITHUB_CID={your_github_client_id}
      - AUTH_GITHUB_CSEC={your_github_client_secret}
      - AUTH_GOOGLE_CID={your_google_client_id}
      - AUTH_GOOGLE_CSEC={your_google_client_secret}
      - AUTH_DISCORD_CID={your_discord_client_id}
      - AUTH_DISCORD_CSEC={your_discord_client_secret}
      - AUTH_TELEGRAM=true
      - TELEGRAM_TOKEN={your_telegram_bot_token}
      - NOTIFY_ADMINS=telegram
      - NOTIFY_TELEGRAM_CHAN={your_telegram_channel_id}
    volumes:
      - /opt/remark42/var:/srv/var
```

### [PocketBase](https://pocketbase.lkwplus.com/)

[PocketBase](https://pocketbase.io/) 采用 Go 语言开发，是一个开源的实时后端解决方案，可以很方便的作为 Web 和移动应用的后端。

它集成了嵌入式 SQLite 数据库、实时数据订阅、用户管理、文件存储和管理仪表板等功能，可以做到开箱即用。

```yaml title="docker-compose.yml" showLineNumbers
services:
  pocketbase:
    image: ghcr.io/muchobien/pocketbase:latest
    container_name: pocketbase
    restart: unless-stopped
    command:
      - --encryptionEnv # optional
      - ENCRYPTION # optional
    environment:
      ENCRYPTION: { your_encryption_key } # openssl rand -hex 16
    ports:
      - 127.0.0.1:16487:8090
    volumes:
      - /opt/pocketbase/data:/pb_data
      - /opt/pocketbase/public:/pb_public # optional
      - /opt/pocketbase/hooks:/pb_hooks # optional
    healthcheck:
      test: wget --no-verbose --tries=1 --spider http://localhost:8090/api/health || exit 1
      interval: 10s
      timeout: 5s
      retries: 5
```

### [Wallos](https://wallos.lkwplus.com/)

[Wallos](https://github.com/ellite/Wallos) 是一个开源的个人订阅项目追踪器，可以很方便的记录如 Netflix、Spotify 等订阅项目的价格、到期时间等，有美观的图标展示，并支持多种通知方式，但美中不足的是对国内支付方式较少。

```yaml title="docker-compose.yml" showLineNumbers
services:
  wallos:
    container_name: wallos
    image: bellamy/wallos:latest
    ports:
      - 127.0.0.1:18289:80/tcp
    environment:
      - TZ=Asia/Shanghai
    volumes:
      - /opt/wallos/db:/var/www/html/db
      - /opt/wallos/logos:/var/www/html/images/uploads/logos
    restart: unless-stopped
```

### [code-server](https://code.lkwplus.com/)

[code-server](https://github.com/coder/code-server) 是一个开源的 Web 代码编辑器，它将 VS Code 的核心功能移植到服务器端，用户可以通过任何设备上的浏览器访问，从而很方便的进行代码编辑和调试。

```yaml title="docker-compose.yml" showLineNumbers
services:
  code-server:
    image: lscr.io/linuxserver/code-server:latest
    container_name: code-server
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Asia/Shanghai
      - HASHED_PASSWORD={your_hashed_password} # 网页登录密码
      - SUDO_PASSWORD={your_sudo_password} # 终端提权密码
      - PROXY_DOMAIN={your_domain}
      - DEFAULT_WORKSPACE=/config/workspace
    volumes:
      - /opt/code-server/config:/config
    ports:
      - 127.0.0.1:18453:8443
    restart: unless-stopped
```

### [Uptime-Kuma](https://uptime.lkwplus.com/)

用于监控各类网站、服务等的可用性，并即时通知，[文档地址](https://github.com/louislam/uptime-kuma?tab=readme-ov-file#-how-to-install)。

```yaml title="docker-compose.yml" showLineNumbers
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: uptime-kuma
    restart: unless-stopped
    ports:
      - 127.0.0.1:13059:3001
    volumes:
      - /opt/uptime-kuma/data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock # 用于监控 Docker 容器状态
```

### Watchtower

[文档地址](https://containrrr.dev/watchtower/)，用于（自动）更新 Docker 镜像。

```shell
# 拉取镜像
docker pull containrrr/watchtower
# 执行手动更新
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock containrrr/watchtower -cR {CONTAINER_NAME}
```

目前使用其用于每天自动更新镜像，并使用 Telegram Bot 进行通知。

对于不希望被 Watchtower 接管进行自动更新的 Container（例如 Immich），在相应的配置文件中添加 labels `"com.centurylinklabs.watchtower.enable=false"` 即可。[参考文档](https://containrrr.dev/watchtower/container-selection/#full_exclude)。

```yaml title="docker-compose.yml" showLineNumbers
services:
  watchtower:
    image: containrrr/watchtower:latest
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: container1 container2 container3 # 可选，仅更新指定容器
    environment:
      - TZ=Asia/Shanghai
      - WATCHTOWER_SCHEDULE=0 0 17 * * *
      - WATCHTOWER_NOTIFICATIONS_HOSTNAME={your_hostname}
      - WATCHTOWER_NOTIFICATIONS=shoutrrr
      - WATCHTOWER_NOTIFICATION_URL=telegram://{HTTP_API_TOKEN}@telegram/?chats={CHAT_ID}&notification=no
      - WATCHTOWER_CLEANUP=true
```

### Diun

[Diun](https://github.com/crazy-max/diun) (Docker Image Update Notifier) 是一个 Docker 镜像更新通知工具，暂时未使用，由 Watchtower 替代。

```yaml title="docker-compose.yml" showLineNumbers /TELEGRAM/
services:
  diun:
    image: crazymax/diun:latest
    container_name: diun
    command: serve
    volumes:
      - /opt/diun/data:/data
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - 'TZ=Asia/Shanghai'
      - 'DIUN_WATCH_WORKERS=20'
      - 'DIUN_WATCH_SCHEDULE=0 */6 * * *'
      - 'DIUN_WATCH_JITTER=30s'
      - 'DIUN_PROVIDERS_DOCKER=true'
      - 'DIUN_PROVIDERS_DOCKER_WATCHBYDEFAULT=true'
      - 'DIUN_NOTIF_TELEGRAM_TOKEN={your_bot_token}'
      - 'DIUN_NOTIF_TELEGRAM_CHATIDS={your_chat_id}'
    labels:
      - 'diun.enable=true'
    restart: unless-stopped
```

### [Restic](https://github.com/restic/restic)

增量备份方案，[文档地址](https://restic.readthedocs.io/)，类似的项目如 [Duplicati](https://www.duplicati.com/) (Linux 下运行需要 mono，所以排除)、[Borg](https://borgbackup.readthedocs.io/) 等，详见 [ArchLinux Wiki](https://wiki.archlinux.org/title/Synchronization_and_backup_programs#Incremental_backups)。

```shell showLineNumbers
export AWS_DEFAULT_REGION={your_region}
export AWS_ACCESS_KEY_ID={your_access_key}
export AWS_SECRET_ACCESS_KEY={your_secret_key}
export RESTIC_PASSWORD={your_restic_password}
export RESTIC_REPOSITORY=s3:https://{your_endpoint}.r2.cloudflarestorage.com/{your_bucket_name}
restic init
```

首先 dry-run 测试可以正常进行备份：

```shell
restic backup /which/path/to/backup --dry-run -vv
```

可以将备份任务添加至 crontab，如：

```shell
30 4 * * * /usr/bin/restic backup /which/path/to/backup --password-file /path/to/rc-password >> /path/to/backup.log 2>&1
```

### 资源使用情况

#### 腾讯云

腾讯云的新加坡 Lighthouse 实例，由于内存较小，很多项目的部署会比较吃紧，但对大陆的延迟相对较低，因此主要用于部署 Umami 和 New-API，内存使用情况大致如下：

```shell
$ free -h
               total        used        free      shared  buff/cache   available
Mem:           1.8Gi       919Mi       115Mi        16Mi       1.0Gi       919Mi
Swap:          2.0Gi       307Mi       1.7Gi
```

| NAME          | CPU % | MEM USAGE / LIMIT   | MEM % | NET I/O         | BLOCK I/O       | PIDS |
| ------------- | ----- | ------------------- | ----- | --------------- | --------------- | ---- |
| dozzle-agent  | 0.10% | 9.574MiB / 1.796GiB | 0.52% | 34.6kB / 31.5kB | 12.3kB / 86kB   | 8    |
| umami-db      | 0.01% | 39.94MiB / 1.796GiB | 2.17% | 351kB / 282kB   | 13.7MB / 14.1MB | 11   |
| new-api       | 0.00% | 84.17MiB / 1.796GiB | 4.58% | 10MB / 6.27MB   | 30.5MB / 17MB   | 7    |
| beszel-agent  | 0.00% | 8.172MiB / 1.796GiB | 0.44% | 0B / 0B         | 3.24MB / 2.15MB | 7    |
| watchtower    | 0.00% | 23.87MiB / 1.796GiB | 1.30% | 3.56MB / 1.21MB | 16.9MB / 4.53MB | 8    |
| wewerss       | 0.00% | 60.34MiB / 1.796GiB | 3.28% | 28.7MB / 125MB  | 78.9MB / 165MB  | 15   |
| umami         | 5.67% | 127.3MiB / 1.796GiB | 6.92% | 24.6MB / 81.6MB | 198MB / 155MB   | 49   |
| nezha         | 0.18% | 32.3MiB / 1.796GiB  | 1.76% | 6.83GB / 4.44GB | 164MB / 146MB   | 11   |
| node_exporter | 0.00% | 14.85MiB / 1.796GiB | 0.81% | 0B / 0B         | 39.4MB / 12MB   | 5    |

#### FameSystems

对于目前的主力机 (FameSystems)，内存使用情况大致如下：

```shell
$ free -h
               total        used        free      shared  buff/cache   available
Mem:            23Gi       8.0Gi       542Mi       401Mi        15Gi        15Gi
Swap:          1.0Gi       224Mi       799Mi
```

| Name                          | CPU % | MEM USAGE / LIMIT   | MEM % | NET I/O         | BLOCK I/O       | PIDS |
| ----------------------------- | ----- | ------------------- | ----- | --------------- | --------------- | ---- |
| maybe_app                     | 0.06% | 153.8MiB / 23.47GiB | 0.64% | 5.57MB / 7.92MB | 9.84MB / 881kB  | 16   |
| p115dav                       | 0.22% | 50.2MiB / 23.47GiB  | 0.21% | 644kB / 168kB   | 1.54MB / 1.37MB | 4    |
| dozzle                        | 0.00% | 16.5MiB / 23.47GiB  | 0.07% | 513kB / 35.6kB  | 0B / 0B         | 11   |
| remark42                      | 0.03% | 27.12MiB / 23.47GiB | 0.11% | 140MB / 35.2MB  | 4.01MB / 28.7MB | 13   |
| postgres                      | 0.01% | 47.12MiB / 23.47GiB | 0.20% | 26.3MB / 29.9MB | 7.46MB / 8.95MB | 10   |
| nextcloud-aio-mastercontainer | 0.55% | 62.62MiB / 23.47GiB | 0.26% | 2.06MB / 82.1kB | 283kB / 102kB   | 152  |
| metatube-postgres             | 0.01% | 16.8MiB / 23.47GiB  | 0.07% | 1.71MB / 0B     | 168kB / 32.8kB  | 6    |
| pocketbase                    | 0.00% | 29.66MiB / 23.47GiB | 0.12% | 2.88MB / 2.34MB | 94.2kB / 103MB  | 12   |
| homepage                      | 0.00% | 112.7MiB / 23.47GiB | 0.47% | 3.47MB / 962kB  | 26MB / 90.1kB   | 11   |
| syncthing                     | 0.03% | 38.25MiB / 23.47GiB | 0.16% | 6.38MB / 3.11MB | 270kB / 303kB   | 24   |
| beszel-agent                  | 0.00% | 10.83MiB / 23.47GiB | 0.05% | 0B / 0B         | 0B / 0B         | 9    |
| beszel                        | 0.02% | 41.73MiB / 23.47GiB | 0.17% | 25.3MB / 11.6MB | 1.32MB / 475MB  | 12   |
| hoarder_web                   | 0.37% | 324.3MiB / 23.47GiB | 1.35% | 6.76MB / 6.45MB | 24.9MB / 13.2MB | 63   |
| open-webui                    | 0.20% | 570.9MiB / 23.47GiB | 2.38% | 4.73MB / 7.14MB | 17.5MB / 41.9MB | 19   |
| qinglong                      | 0.83% | 346.6MiB / 23.47GiB | 1.44% | 24.2MB / 27.7MB | 89MB / 1.11MB   | 64   |
| plex                          | 0.22% | 343.8MiB / 23.47GiB | 1.43% | 0B / 0B         | 27MB / 1.37GB   | 56   |
| thelounge                     | 0.00% | 139.6MiB / 23.47GiB | 0.58% | 52.1MB / 24.7MB | 74.4MB / 6.22GB | 11   |
| nzbhydra2                     | 0.03% | 549.9MiB / 23.47GiB | 2.29% | 14.3MB / 105kB  | 24.3MB / 6.28MB | 33   |
| victoriametrics               | 0.23% | 172.5MiB / 23.47GiB | 0.72% | 1.1GB / 108MB   | 167MB / 1.68GB  | 13   |
| filecodebox                   | 0.39% | 62.02MiB / 23.47GiB | 0.26% | 7.11MB / 1.57MB | 2.44MB / 1.35MB | 4    |
| clouddrive2                   | 0.18% | 54.7MiB / 23.47GiB  | 0.23% | 0B / 0B         | 40.7MB / 530MB  | 39   |
| sabnzbd                       | 0.04% | 52.88MiB / 23.47GiB | 0.22% | 6.76MB / 11.3MB | 147kB / 459kB   | 30   |
| metatube                      | 0.00% | 119.9MiB / 23.47GiB | 0.50% | 815MB / 230MB   | 47.2MB / 56.5MB | 10   |
| vmagent                       | 0.13% | 40.55MiB / 23.47GiB | 0.17% | 565MB / 1.14GB  | 11.3MB / 483kB  | 13   |
| immich_server                 | 0.06% | 506.7MiB / 23.47GiB | 2.11% | 705MB / 1.51GB  | 50.7MB / 156MB  | 28   |
| immich_machine_learning       | 0.21% | 297.3MiB / 23.47GiB | 1.24% | 9.96MB / 67.8kB | 438MB / 11.2MB  | 15   |
| changedetection               | 0.08% | 206.2MiB / 23.47GiB | 0.86% | 35.3MB / 911kB  | 17MB / 4.18MB   | 14   |
| glance                        | 0.00% | 15.75MiB / 23.47GiB | 0.07% | 10.9MB / 3.12MB | 2.06MB / 41kB   | 8    |
| code-server                   | 0.00% | 70MiB / 23.47GiB    | 0.29% | 7.01MB / 464kB  | 2.87MB / 451kB  | 32   |
| vikunja_db                    | 0.00% | 22.5MiB / 23.47GiB  | 0.09% | 28.7MB / 23.5MB | 500kB / 627kB   | 6    |
| maybe_postgres                | 0.60% | 29.7MiB / 23.47GiB  | 0.12% | 120MB / 72.3MB  | 4.09MB / 378MB  | 8    |
| vikunja                       | 0.00% | 28.09MiB / 23.47GiB | 0.12% | 30.7MB / 26.7MB | 21MB / 127kB    | 12   |
| wallos                        | 0.01% | 21.84MiB / 23.47GiB | 0.09% | 8.58MB / 4.51MB | 4.78MB / 11.6MB | 8    |
| uptime-kuma                   | 0.37% | 147.8MiB / 23.47GiB | 0.62% | 6.72MB / 91.3kB | 1.41MB / 9.72GB | 19   |
| nextcloud-aio-apache          | 0.03% | 45.82MiB / 23.47GiB | 0.19% | 51.6MB / 58.5MB | 9.32MB / 24.6kB | 124  |
| nextcloud-aio-whiteboard      | 0.01% | 67.53MiB / 23.47GiB | 0.28% | 42MB / 46.1MB   | 2.02MB / 0B     | 23   |
| nextcloud-aio-notify-push     | 0.01% | 4.363MiB / 23.47GiB | 0.02% | 9.67MB / 5.05MB | 565kB / 0B      | 9    |
| nextcloud-aio-nextcloud       | 0.03% | 97.1MiB / 23.47GiB  | 0.40% | 346MB / 260MB   | 6.05MB / 4.59MB | 8    |
| nextcloud-aio-imaginary       | 0.01% | 13.31MiB / 23.47GiB | 0.06% | 6.72MB / 0B     | 1.53MB / 0B     | 14   |
| nextcloud-aio-redis           | 0.22% | 14.67MiB / 23.47GiB | 0.06% | 118MB / 65.9MB  | 6.05MB / 1.12GB | 7    |
| nextcloud-aio-database        | 0.00% | 195.9MiB / 23.47GiB | 0.82% | 172MB / 281MB   | 3.69MB / 3.26GB | 8    |
| nextcloud-aio-collabora       | 0.09% | 505.4MiB / 23.47GiB | 2.10% | 80.9MB / 22.1MB | 848kB / 438MB   | 13   |
| n8n                           | 0.03% | 158.6MiB / 23.47GiB | 0.66% | 19.2MB / 22.4MB | 35.8MB / 4.1kB  | 13   |
| moments                       | 0.00% | 14.28MiB / 23.47GiB | 0.06% | 7.54MB / 21.9MB | 3.59MB / 20.5kB | 10   |
| tautulli                      | 0.10% | 123.3MiB / 23.47GiB | 0.51% | 42.7MB / 9.87MB | 13.1MB / 121MB  | 32   |
| overseerr                     | 0.03% | 203.5MiB / 23.47GiB | 0.85% | 289MB / 72.6MB  | 31.3MB / 73MB   | 23   |
| autobrr                       | 0.00% | 48.61MiB / 23.47GiB | 0.20% | 25.4MB / 13.8MB | 29MB / 2.78MB   | 12   |
| opengist                      | 0.00% | 32.86MiB / 23.47GiB | 0.14% | 7.23MB / 11.2MB | 11.1MB / 61.4kB | 12   |
| gitea                         | 0.14% | 126.6MiB / 23.47GiB | 0.53% | 103MB / 104MB   | 18.8MB / 10.7MB | 16   |
| your_spotify_client           | 0.00% | 23.69MiB / 23.47GiB | 0.10% | 6.9MB / 85.6kB  | 8.65MB / 16.4kB | 12   |
| your_spotify_server           | 0.02% | 97.27MiB / 23.47GiB | 0.40% | 355MB / 66.4MB  | 13.7MB / 16.4kB | 23   |
| qbittorrent                   | 0.08% | 20.98MiB / 23.47GiB | 0.09% | 567MB / 281MB   | 9.1MB / 463kB   | 17   |
| calibre-web-automated         | 0.01% | 164MiB / 23.47GiB   | 0.68% | 6.98MB / 120kB  | 9.21MB / 8.22MB | 26   |
| grafana                       | 0.08% | 99.63MiB / 23.47GiB | 0.41% | 91MB / 68MB     | 34.1MB / 451kB  | 12   |
| hoarder_chrome                | 0.04% | 67.88MiB / 23.47GiB | 0.28% | 8.15MB / 1.51MB | 4.62MB / 1.64MB | 45   |
| hoarder_meilisearch           | 0.11% | 99.31MiB / 23.47GiB | 0.41% | 6.66MB / 8.12kB | 33.4MB / 25.6MB | 19   |
| sftpgo                        | 0.00% | 38.75MiB / 23.47GiB | 0.16% | 24.1MB / 18.9MB | 20.5MB / 115kB  | 12   |
| immich_postgres               | 0.00% | 133MiB / 23.47GiB   | 0.55% | 15.1MB / 312MB  | 61.8MB / 1.55GB | 22   |
| immich_redis                  | 0.18% | 12.34MiB / 23.47GiB | 0.05% | 1.48GB / 358MB  | 4.49MB / 351MB  | 5    |
| node_exporter                 | 0.00% | 31.16MiB / 23.47GiB | 0.13% | 0B / 0B         | 11.8MB / 36.9kB | 5    |
| watchtower                    | 0.00% | 32.24MiB / 23.47GiB | 0.13% | 11.3MB / 1.66MB | 13MB / 53.2kB   | 12   |

### TODO

- [x] 重要数据定期备份方案，上传至 Cloudflare R2；--> [Restic](https://github.com/restic/restic)
- [x] 容器镜像的自动更新方案，通过 Telegram Bot 通知；--> [Watchtower](https://containrrr.dev/watchtower/)
- [ ] ...

## Cloudflare

可以参考 [Awesome Cloudflare](https://cloudflare.chuhai.tools/)，发现更多有意思的基于 Cloudflare 的开源工具。

### Cloudflare Pages

#### [ChatGPT-Next-Web](https://ai.lkwplus.com)

调用各类 LLM api 进行对话的网页端项目，[文档地址](https://github.com/ChatGPTNextWeb/ChatGPT-Next-Web/blob/main/README_CN.md)，配置构建命令和输出目录如下：

- Build command: `npx @cloudflare/next-on-pages --experimental-minify`
- Build output: `.vercel/output/static`

配置如下环境变量：

```toml showLineNumbers
CODE = "{your_code}" # 网页端访问密码
BASE_URL = "https://new-api.lkwplus.com"
OPENAI_API_KEY = "{your_openai_api_key}"
NEXT_TELEMETRY_DISABLE = "1"
NODE_VERSION = "20.1"
PHP_VERSION = "7.4"
YARN_VERSION = "1.22.19"
```

PS: Next.js 项目还是 Vercel 的支持更好，应该优先部署到 Vercel 而非 Cloudflare ：）

#### [excalidraw](https://draw.lkwplus.com)

用于绘制手绘风格的流程图，[GitHub REAMDE](https://github.com/excalidraw/excalidraw?tab=readme-ov-file)，构建配置如下：

- Build command: `yarn --cwd ./excalidraw-app build`
- Build output: `excalidraw-app/build`

#### [BroadcastChannel](https://diary.lkwplus.com/)

用于将 Telegram Channel 转换为微博客，0 JS 的理念很有意思，[文档地址](https://github.com/ccbikai/BroadcastChannel/blob/main/README.zh-cn.md)，构建配置如下：

- Build command: `pnpm run build`
- Build output: `dist`

配置如下环境变量：

```toml showLineNumbers
CHANNEL = "lkw123_channel"
GITHUB = "synthpop123"
LOCALE = "zh-cn"
TELEGRAM = "lkw123"
TIMEZONE = "Asia/Shanghai"
TWITTER = "whoamamamiii"
```

#### [IT-Tools](https://tools.lkwplus.com)

IT 工具箱，功能丰富、UI 美观，[文档地址](https://github.com/CorentinTh/it-tools?tab=readme-ov-file#project-setup)，构建配置如下：

- Build command: `pnpm run build`
- Build output: `dist`

#### [Web Archive](https://archive.lkwplus.com/)

Web Archive 可以提供类似于使用 [Singlefile](https://github.com/gildas-lormeau/SingleFile) 插件进行网页存档的功能，服务基于 Cloudflare D1 数据库及 R2 存储桶。参考 [官方文档](https://github.com/ray-d-song/web-archive/blob/main/docs/README_zh.md#%E9%83%A8%E7%BD%B2%E6%8C%87%E5%8D%97) 进行一键部署，从 Release 页下载 Chrome 插件后即可开始使用。

#### [Quartz](https://quartz.lkwplus.com)

将 Obsidian 的笔记内容构建为静态网页，可定制性强，是一个很好的官方 Obsidian Publish 功能的替代方案，[文档地址](https://quartz.jzhao.xyz/)。我仿照一个非常好看 Quartz 实例 [Garden's Gate](https://www.pmcf.xyz/topo-da-mente/) 进行了一些修改。构建配置如下：

- Build command: `git fetch --unshallow && npx quartz build`
- Build output: `public`

#### [Slidev](https://slidev.lkwplus.com)

Slidev 是一个为开发者设计的基于 Web 的幻灯片制作工具，[文档地址](https://cn.sli.dev/guide/)，构建配置如下：

- Build command: `pnpm run build`
- Build output: `dist`
- Rewrites: `"source": "/(.*)", "destination": "/index.html"`

#### [MkDocs](https://wiki.lkwplus.com/)

采用 [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/getting-started/) 主题的文档站，[GitHub Repo](https://github.com/synthpop123/wiki)。构建配置如下：

- Build command: `mkdocs build`
- Build output: `site`

#### [R2 Uploader](https://r2.lkwplus.com/)

此前一直苦于没有美观好用的用于 Cloudflare R2 的 S3 兼容上传器，用如 PicGo 之类的软件会感觉太重，体验一般。

而 [jw-12138/r2-uploader](https://github.com/jw-12138/r2-uploader) 则很好的规避了太重的问题，保留核心功能，还支持传输大文件、自动压缩、自定义域名等，且密钥等均通过浏览器存在本地，保障了安全的问题，部署教程详见 [README](https://github.com/jw-12138/r2-uploader?tab=readme-ov-file#requirements-%EF%B8%8F)。

除此之外，轻量的命令行工具 [pluveto/upgit](https://github.com/pluveto/upgit) 也很不错，非常推荐。

#### [Sink](https://s.lkwplus.com/)

完全运行于 Cloudflare 的短链接生成工具，支持分析功能。部署教程详见 [README](https://github.com/ccbikai/sink?tab=readme-ov-file#%EF%B8%8F-deployment)。

#### [Dimension](https://dimension.lkwplus.com/)

此前的个人主页，稍稍修改自 [HTML5 UP](https://html5up.net/) 设计的静态页面。

#### [site-status](https://site-status.lkwplus.com/)

基于 UptimeRobot API 的在线状态面板，根据 [README](https://github.com/imsyy/site-status?tab=readme-ov-file#%E5%A6%82%E4%BD%95%E4%BD%BF%E7%94%A8) 中的部署教程，修改 `.env` 文件中的 UptimeRobot API Key 即可。

### Clouflare Workers

#### [gh-proxy](https://gh.lkwplus.com)

基于 Cloudflare Workers 对 GitHub Release、Archive 以及项目文件进行反代，从而实现加速访问，提供了一个简单的 Web UI，[部署教程](https://github.com/hunshcn/gh-proxy?tab=readme-ov-file#cf-worker%E7%89%88%E6%9C%AC%E9%83%A8%E7%BD%B2)。

#### [DeepLX](https://deepl.lkwplus.com/translate)

详见项目 [deeplx-for-cloudflare](https://github.com/ifyour/deeplx-for-cloudflare)，可以给如沉浸式翻译插件或 Bob 等软件提供翻译 API 接口。

#### [Reverse Proxy](https://proxy.lkwplus.com)

基于 Cloudflare Workers 的简单反向代理脚本，且可以处理跨域请求，偶尔用于给无法访问源网站的朋友分享内容时会用到，部署教程详见 [README](https://github.com/ymyuuu/Cloudflare-Workers-Proxy?tab=readme-ov-file#%E5%A6%82%E4%BD%95%E9%83%A8%E7%BD%B2)。

#### [Pastebin](https://pastebin.lkwplus.com/)

通过 Cloudflare KV 进行存储的 Pastebin 项目，用于临时分享代码或小文件等使用，部署教程详见 [README](https://github.com/SharzyL/pastebin-worker?tab=readme-ov-file#deploy)。

#### [ChatGPT-Telegram-Workers](https://t.me/lkw_chatgpt_bot)

部署教程详见 [README](https://github.com/TBXark/ChatGPT-Telegram-Workers/blob/master/doc/cn/DEPLOY.md)。环境变量如下：

```toml showLineNumbers
API_KEY = "{your_api_key}"
CHAT_WHITE_LIST = "{your_tg_id}"
CUSTOM_COMMAND_35 = "/setenvs {'OPENAI_CHAT_MODEL': 'gpt-3.5-turbo'}"
CUSTOM_COMMAND_4o = "/setenvs {'OPENAI_CHAT_MODEL': 'gpt-4o'}"
CUSTOM_COMMAND_4o-mini = "/setenvs {'OPENAI_CHAT_MODEL': 'gpt-4o-mini'}"
CUSTOM_COMMAND_ds-coder = "/setenvs {'OPENAI_CHAT_MODEL': 'deepseek-coder'}"
CUSTOM_COMMAND_cn2en = "/setenvs {'SYSTEM_INIT_MESSAGE': '你是一个翻译,下面将我说的话都翻译成英文'}"
CUSTOM_COMMAND_en2cn = "/setenvs {'SYSTEM_INIT_MESSAGE': '你是一个翻译，下面将我说的话都翻译成中文'}"
DALL_E_IMAGE_QUALITY = "hd"
DALL_E_IMAGE_SIZE = "1024x1024"
DALL_E_IMAGE_STYLE = "natural"
DALL_E_MODEL = "dall-e-3"
ENABLE_USAGE_STATISTICS = "true"
GROUP_CHAT_BOT_ENABLE = "false"
OPENAI_API_BASE = "https://new-api.lkwplus.com/v1"
OPENAI_CHAT_MODEL = "gpt-4o"
TELEGRAM_AVAILABLE_TOKENS= "{your_bot_token}"
```

#### [Oaifree Helper](https://oai.lkwplus.com/)

提取多个 ChatGPT 账号的 AccessToken/RefreshToken 后，基于 Cloudflare Workers 反代始皇的 [new.oaifree.com](https://new.oaifree.com) 镜像站，从而实现免梯访问 ChatGPT 和多号切换，部署教程详见 [README](https://github.com/jyx04/oaifree-helper?tab=readme-ov-file#worker-%E9%83%A8%E7%BD%B2%E4%B8%80%E9%94%AE%E7%9B%B4%E8%BE%BE)。

#### [Fuclaude](https://fuclaude.lkwplus.com/)

依赖于始皇的 [fuclaude](https://github.com/wozulong/fuclaude)，基于 Cloudflare Workers 实现号池分享，部署教程可参考 [L 站帖子](https://linux.do/t/topic/166030)。

#### [Letterboxd Diary Embed](https://letterboxd-embed.lkwplus.com/)

基于 Cloudflare Workers 获取任意用户的最新 Letterboxd 影评，并生成 HTML 代码以嵌入个人网站中，[项目地址](https://github.com/timciep/letterboxd-diary-embed)。

其逻辑是发出 GET 请求后会首先在 Cloudflare KV 中查询是否有缓存，若有则直接返回缓存内容，若没有则向 Letterboxd API 发出请求获取最新影评，并将结果 HTML 代码缓存到 KV 中。

个人对缓存逻辑和生成的影评 CSS 样式进行了简单修改后重新部署，以添加 `?username=lkw123` 参数为例发送请求，获取到的的内容如下：

```html showLineNumbers
<style>
  #letterboxd-embed-tc {
    margin-bottom: 1.5rem;
  }

  .letterboxd-embed-tc-diary-entry {
    margin-bottom: 1rem;
  }

  .letterboxd-embed-tc-content {
    display: flex;
    align-items: flex-start;
    gap: 2rem;
    margin-bottom: 1em;
    margin-top: 1em;
  }

  .letterboxd-embed-tc-poster img {
    margin: 0 !important;
    border-radius: 0.375rem;
    width: 70px;
    height: 105px;
    object-fit: cover;
  }

  .letterboxd-embed-tc-title {
    font-size: 1.125rem;
    font-weight: 700;
    line-height: 1.25;
  }

  .letterboxd-embed-tc-year {
    font-size: 0.875rem;
    font-weight: 400;
    color: #6c757d;
    margin-left: 0.25rem;
  }

  .letterboxd-embed-tc-date {
    font-size: 0.875rem;
    color: #6c757d;
    margin-top: 0.25rem;
    margin-bottom: 0.25rem;
  }

  .letterboxd-embed-tc-rating {
    font-size: 1.125rem;
    font-weight: 500;
    color: #16a34a;
  }

  .letterboxd-embed-tc-review {
    font-size: 0.875rem;
    color: #6c757d;
    margin-top: 0.25rem;
  }

  .letterboxd-embed-tc-divider {
    border-bottom: 1px solid #6c757d;
    margin-top: 1rem;
    margin-bottom: 1rem;
  }

  .letterboxd-embed-tc-more {
    font-size: 1rem;
    color: #6c757d;
    transition: color 0.2s;
  }

  .letterboxd-embed-tc-more:hover {
    color: #000000;
  }
</style>

<div id="letterboxd-embed-tc">
  <div class="letterboxd-embed-tc-diary-entry">
    <div class="letterboxd-embed-tc-content">
      <div class="letterboxd-embed-tc-poster">
        <a
          href="https://letterboxd.com/lkw123/film/the-volunteers-the-battle-of-life-and-death/"
          target="_blank"
        >
          <img
            src="https://a.ltrbxd.com/resized/film-poster/1/1/8/0/9/3/3/1180933-the-volunteers-the-battle-of-life-and-death-0-70-0-105-crop.jpg?v=998f8665cf"
            alt="The Volunteers: The Battle of Life and Death poster"
          />
        </a>
      </div>

      <div>
        <div class="letterboxd-embed-tc-title">
          The Volunteers: The Battle of Life and Death
          <span class="letterboxd-embed-tc-year"> 2024 </span>
        </div>

        <div class="letterboxd-embed-tc-date">October 3, 2024</div>

        <div class="letterboxd-embed-tc-rating">★★½</div>
      </div>
    </div>
  </div>

  <div class="letterboxd-embed-tc-divider"></div>

  <div class="letterboxd-embed-tc-diary-entry">
    <div class="letterboxd-embed-tc-content">
      <div class="letterboxd-embed-tc-poster">
        <a
          href="https://letterboxd.com/lkw123/film/the-cloud-in-her-room/1/"
          target="_blank"
        >
          <img
            src="https://a.ltrbxd.com/resized/film-poster/5/0/4/5/1/8/504518-the-cloud-in-her-room-0-70-0-105-crop.jpg?v=60cbaf1d17"
            alt="The Cloud in Her Room poster"
          />
        </a>
      </div>

      <div>
        <div class="letterboxd-embed-tc-title">
          The Cloud in Her Room
          <span class="letterboxd-embed-tc-year"> 2020 </span>
        </div>

        <div class="letterboxd-embed-tc-date">&#9850; September 7, 2024</div>

        <div class="letterboxd-embed-tc-rating">★★★½</div>

        <div class="letterboxd-embed-tc-review">
          One of my favorite film posters
        </div>
      </div>
    </div>
  </div>

  <div class="letterboxd-embed-tc-divider"></div>

  <div class="letterboxd-embed-tc-diary-entry">
    <div class="letterboxd-embed-tc-content">
      <div class="letterboxd-embed-tc-poster">
        <a href="https://letterboxd.com/lkw123/film/alien/" target="_blank">
          <img
            src="https://a.ltrbxd.com/resized/sm/upload/8v/f1/qw/aa/bg7K6VtUG7Ew70gQj6SSroD5d4R-0-70-0-105-crop.jpg?v=a932f9e98e"
            alt="Alien poster"
          />
        </a>
      </div>

      <div>
        <div class="letterboxd-embed-tc-title">
          Alien
          <span class="letterboxd-embed-tc-year"> 1979 </span>
        </div>

        <div class="letterboxd-embed-tc-date">August 25, 2024</div>

        <div class="letterboxd-embed-tc-rating">★★★★</div>
      </div>
    </div>
  </div>

  <div class="letterboxd-embed-tc-divider"></div>

  <div class="letterboxd-embed-tc-diary-entry">
    <div class="letterboxd-embed-tc-content">
      <div class="letterboxd-embed-tc-poster">
        <a
          href="https://letterboxd.com/lkw123/film/alien-romulus/"
          target="_blank"
        >
          <img
            src="https://a.ltrbxd.com/resized/film-poster/8/5/0/4/5/9/850459-alien-romulus-0-70-0-105-crop.jpg?v=acabb7fd83"
            alt="Alien: Romulus poster"
          />
        </a>
      </div>

      <div>
        <div class="letterboxd-embed-tc-title">
          Alien: Romulus
          <span class="letterboxd-embed-tc-year"> 2024 </span>
        </div>

        <div class="letterboxd-embed-tc-date">August 21, 2024</div>

        <div class="letterboxd-embed-tc-rating">★★★★</div>
      </div>
    </div>
  </div>

  <div class="letterboxd-embed-tc-divider"></div>

  <div class="letterboxd-embed-tc-diary-entry">
    <div class="letterboxd-embed-tc-content">
      <div class="letterboxd-embed-tc-poster">
        <a
          href="https://letterboxd.com/lkw123/film/despicable-me-4/"
          target="_blank"
        >
          <img
            src="https://a.ltrbxd.com/resized/film-poster/4/4/8/5/0/6/448506-despicable-me-4-0-70-0-105-crop.jpg?v=3391582e43"
            alt="Despicable Me 4 poster"
          />
        </a>
      </div>

      <div>
        <div class="letterboxd-embed-tc-title">
          Despicable Me 4
          <span class="letterboxd-embed-tc-year"> 2024 </span>
        </div>

        <div class="letterboxd-embed-tc-date">August 13, 2024</div>

        <div class="letterboxd-embed-tc-rating">★★</div>
      </div>
    </div>
  </div>

  <div class="letterboxd-embed-tc-divider"></div>

  <div class="letterboxd-embed-tc-more">
    <a href="https://letterboxd.com/lkw123" target="_blank"
      >...more on Letterboxd</a
    >
  </div>
</div>
```

可以通过如下方式将其嵌入到博客中。具体效果详见我的博客的 [Movies 页面](/movies)。

```html showLineNumbers
<div id="letterboxd-embed-wrapper-tc">Loading...</div>

<script>
  fetch('https://letterboxd-embed.lkwplus.com?username=lkw123')
    .then((response) => response.text())
    .then((data) => {
      const element = document.getElementById('letterboxd-embed-wrapper-tc')
      if (element) {
        element.innerHTML = data
      }
    })
</script>
```

#### [PT Gen](https://ptgen.lkwplus.com/)

根据豆瓣、IMDb、Bangumi、Steam 链接自动生成简介，主要用于 PT（自动化）发种，[文档地址](https://github.com/Rhilip/pt-gen-cfworker)。

## Vercel

此前在 Vercel 上部署的项目很多，但自决定全面转向 Cloudflare 的 CDN 和各类服务后，逐步对项目进行迁移。

### [RSSHub](https://rss.lkwplus.com)

[文档地址](https://docs.rsshub.app/deploy)

RSSHub 是一个开源的、用于将各种网站的内容聚合到一个统一的接口中生成 RSS Feed 的项目，主要用于订阅未提供 RSS Feed 的网站或社交媒体。在这个碎片化信息爆炸的时代，做一些试图逃脱信息茧房的挣扎。

根据 GitHub [Issue #14622](https://github.com/DIYgod/RSSHub/issues/14622#issuecomment-1979929778) 的讨论，在今年上半年起 Vercel/Cloudflare Workers 无法部署 RSSHub 的最新代码，测试可用的最新 Commit 截至 [`29276d8`](https://github.com/DIYgod/RSSHub/commit/29276d8399ae626d4220e718b3ec7dbe9d22ef90)。这个问题的修复目前卡在 got 和 NextJS 不兼容，需要等待 got 依赖从 RSSHub 项目移除。

暂时性的解决方案为：首先将 [DIYgod/RSSHub](https://github.com/DIYgod/RSSHub) 完整的 Fork 至自己账号下，可以在 Vercel 的 Create Deployment 处填入相应的 Commit 链接 `https://github.com/{your-username}/RSSHub/commit/29276d8`，或是在 GitHub 将默认分支由 master 切换至 legacy 分支后再部署。

### [Koodo Reader](https://koodo.lkwplus.com/)

跨平台的电子书阅读器，部署教程详见 [README](https://github.com/koodo-reader/koodo-reader/blob/master/README_cn.md)。

### [Umami](https://umami.lkwplus.com/)

Google Analytics 的开源替代，[项目地址](https://github.com/umami-software/umami)。

采用 Vercel 免费提供的 Postgres 作为后端数据库，和项目进行关联后，在部署页面配置数据库连接信息即可。同时，可以修改 `TRACKER_SCRIPT_NAME` 环境变量为不包含 umami、analytics 等关键字的名称，避免目标网站中引入的 js 脚本被 Adblock 等插件拦截。

### [Nobelium](https://notion.lkwplus.com/)

[项目地址](https://github.com/craigary/nobelium)，基于 Notion 的 Next.js 静态博客，类似的开源解决方案如 [NotionNext](https://github.com/tangly1024/NotionNext)，闭源解决方案如 [Super](https://super.so/)，或是直接选择使用官方的 Notion Website 功能即可。

### [Homer](https://myhomer.vercel.app/)

[项目地址](https://github.com/bastienwirtz/homer)，极简风格的静态面板，比较适合用于服务器、Homelab、NAS 等，可以方便的集中整理自己的各类自部署服务或书签。

### [DailyHot](https://hot.lkwplus.com)

项目后端 [imsyy/DailyHotApi-Vercel](https://github.com/imsyy/DailyHotApi-Vercel)，项目前端 [imsyy/DailyHot](https://github.com/imsyy/DailyHot)。后端部署完毕后，更改前端项目的环境变量 `VITE_GLOBAL_API` 即可，如 "https://dailyhot-api.lkwplus.com"。

### [Last.fm Recently Played](https://lastfm.lkwplus.com/)

[项目地址](https://github.com/JeffreyCA/lastfm-recently-played-readme)，用于生成个人的最新 Last.fm 听歌记录，可美观的展示于 GitHub Profile 或其他地方，类似的还可以选择同开发者的 [JeffreyCA/spotify-recently-played-readme](https://github.com/JeffreyCA/spotify-recently-played-readme) 项目。

由于该仓库自身提供服务使用的 `*.vercel.app` 子域名被墙，因此部署后绑定自定义域名以规避这个问题。具体效果详见我的博客的 [Music 页面](/music)。

### [NetEase Music API](https://netease-api.lkwplus.com/)

网易云音乐 Node.js API service，原仓库由于版权问题现已删库，如有需求可以考虑部署 PHP 实现 [kilingzhang/NeteaseCloudMusicApi](https://github.com/kilingzhang/NeteaseCloudMusicApi)。自己此前 fork 的 [仓库](https://github.com/synthpop123/NeteaseCloudMusicApi) 尚且幸存，部署的 API 一直可以能正常使用。此前主要用于配合 [qier222/YesPlayMusic](https://github.com/qier222/YesPlayMusic) 在 Vercel 搭建在线音乐 Web 端，但很少使用。

## fly.io

我的 fly.io 账户幸运的停留在了 Legacy Hobby plan，可以免费部署三个 cpu-1x mem-256M 的实例，相当的大方且慷慨，感激 ：）

### [Reader](https://reader.lkwplus.com)

阅读的服务器端项目，可以方便的在网页端摸鱼看小说。[文档地址](https://github.com/hectorqin/reader/blob/master/doc.md#docker%E7%89%88)，`fly.toml` 文件内容如下：

```toml title="fly.toml" showLineNumbers
app = 'lkw123-reader'
primary_region = 'iad'

[build]
  image = "hectorqin/reader:openj9-latest"

[env]
  SPRING_PROFILES_ACTIVE = "prod"
  READER_APP_USERLIMIT = "1"
  READER_APP_USERBOOKLIMIT = "200"
  READER_APP_CACHECHAPTERCONTENT = "true"
  READER_APP_SECURE = "true"
  READER_APP_SECUREKEY = "{your_secret_key}"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'off'
  auto_start_machines = false
  min_machines_running = 0
  processes = ['app']

[mounts]
  source="reader_data"
  destination="/storage"

[[vm]]
  size = 'shared-cpu-1x'
```

### [FastAPI](https://fastapi.lkwplus.com)

源码存放于我的 GitHub 仓库 [synthpop123/fly-fastapi](https://github.com/synthpop123/fly-fastapi)，`fly.toml` 文件内容如下：

```toml title="fly.toml" showLineNumbers
app = 'lkw123-fastapi'
primary_region = 'iad'

[build]
  builder = 'paketobuildpacks/builder:base'

[env]
  PORT = '8000'

[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = 'off'
  auto_start_machines = false
  min_machines_running = 0
  processes = ['app']

[[vm]]
  size = 'shared-cpu-1x'
```

### [Vaultwarden](https://vault.lkwplus.com/)

使用 Rust 构建的开源密码管理器 Bitwarden 的服务端实现，且和上游的 Bitwarden 客户端兼容，`fly.toml` 文件内容如下：

```toml title="fly.toml" showLineNumbers
app = 'lkw123-vault'
primary_region = 'iad'

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'off'
  auto_start_machines = false
  min_machines_running = 0
  processes = ['app']

[env]
  SIGNUPS_ALLOWED = "false"

[build]
  image = "vaultwarden/server:latest"

[mounts]
  source = "vw_data"
  destination = "/data"

[[services]]
  http_checks = []
  internal_port = 80
  [[services.ports]]
    force_https = true
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [[services.tcp_checks]]
    grace_period = "1s"
    interval = "15s"
    restart_limit = 0
    timeout = "2s"

[[vm]]
  size = 'shared-cpu-1x'
```

### [Memos](https://memos.lkwplus.com/)

参考 [hu3rror/memos-on-fly](https://github.com/hu3rror/memos-on-fly/blob/main/README_zh-CN.md) 的文档进行部署，除了保有项目的原功能外，还支持通过 [Litestream](https://litestream.io/) 自动备份数据库到个人的 [Backblaze B2](https://backblaze.com/cloud-storage)。

为了接入 Telegram Bot，需要采用标签为 `stable-memogram` 的镜像，并需要手动添加 Bot Token 至环境变量：

```shell
flyctl secrets set BOT_TOKEN="{your_bot_token}"
```

`fly.toml` 文件内容如下：

```toml title="fly.toml" showLineNumbers /stable-memogram/
app = 'lkw123-memos'
primary_region = 'iad'

[build]
  image = 'ghcr.io/hu3rror/memos-litestream:stable-memogram'

[env]
  LITESTREAM_REPLICA_BUCKET = '{lkw123-memos}'
  LITESTREAM_REPLICA_ENDPOINT = '{s3.us-west-004.backblazeb2.com}'
  LITESTREAM_REPLICA_PATH = 'memos_prod.db'

[[mounts]]
  source = 'memos_data'
  destination = '/var/opt/memos'

[http_service]
  internal_port = 5230
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = 'shared-cpu-1x'
```

顺手记录一下自己的 Memos 自定义 CSS 样式：

```css title="custom.css" showLineNumbers
/* 设置 Memos 标签样式 */
span.inline-block.w-auto.text-blue-600.dark\:text-blue-400 {
  color: #f3f3f3;
  background-color: #40b76b;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  border-radius: 2px;
  padding: 2px 6px;
  font-size: 15px;
  margin-bottom: 4px;
}
/* 设置同级下不同的标签显示不同的颜色 */
/* 第2个标签 */
span.inline-block.w-auto.text-blue-600.dark\:text-blue-400:nth-child(n + 2) {
  background-color: #157cf5;
}
/* 第3个标签 */
span.inline-block.w-auto.text-blue-600.dark\:text-blue-400:nth-child(n + 4) {
  background-color: #f298a6;
}
/* 第4个标签 */
span.inline-block.w-auto.text-blue-600.dark\:text-blue-400:nth-child(n + 6) {
  background-color: #fdb15d;
}
/* 第5个标签 */
span.inline-block.w-auto.text-blue-600.dark\:text-blue-400:nth-child(n + 8) {
  background-color: #67d6ca;
}
/* 第6个标签 */
span.inline-block.w-auto.text-blue-600.dark\:text-blue-400:nth-child(n + 10) {
  background-color: #7445e0;
}
```

## Zeabur

Zeabur 是一个比较新的云端部署服务，作为国人团队开发的产品，它会有更多的本地化支持和对大陆用户的优化。

在通常情况下，我们使用如 Zeabur 这类 PaaS 服务时，主要是将项目部署至其多区域的共享集群 (Shared Cluster)，利用其 Edge 节点提供的高速网络连接，同时降低运维成本。

Zeabur 最近推出了“独立服务器”的功能，用户可以将自己的服务器注册到 Zeabur 上，从而无需支付硬件资源的使用费用，又能享受到平台为部署流程带来的便利。我用 VKVM 的洛杉矶 9950X 4C8G VPS 测试了下，效果还不错，但是占用系统资源比较多，如果有闲置的大内存机器可以尝试。

### [Blog](https://blog.lkwplus.com)

基于 Astro 构建，修改自 [astro-erudite](https://github.com/jktrn/astro-erudite)，并使用了 [astro-theme-pure](https://github.com/cworld1/astro-theme-pure) 中的部分组件样式。

### [Homepage](https://lkwplus.com)

个人很喜欢博客主题 [astro-erudite](https://github.com/jktrn/astro-erudite) 的样式，就根据博客 clone 了一份，去除无用的依赖，保留 `index.astro` 单页面中的 Card 组建，并稍微调整样式，便成了新的个人主页。

### [Blog Legacy](https://blog-v1.lkwplus.com/)

基于 Astro 构建，修改自 [AstroPaper](https://github.com/satnaing/astro-paper#readme)，部分修改过程记录在了博文 [AstroPaper 博客自定义](http://localhost:1234/posts/astropaper-blog-customization) 中，代码存放于我的 GitHub 仓库 [synthpop123/astro-blog](https://github.com/synthpop123/astro-blog)。自迁移至新的主题后，该旧博客暂时保留。

---

参考：

- [Awesome Selfhosted](https://awesome-selfhosted.net/index.html)
- [Awesome Sysadmin](https://github.com/awesome-foss/awesome-sysadmin)
- [selfh.st](https://selfh.st/apps/)
- [r/selfhosted](https://www.reddit.com/r/selfhosted/)
- [Self Hosting Guide](https://github.com/mikeroyal/Self-Hosting-Guide)
