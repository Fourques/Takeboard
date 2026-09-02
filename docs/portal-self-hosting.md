# TakeBoard 账号门户自托管

更新时间：2026-09-02

账号门户让工作站主动建立出站连接。浏览器只访问门户域名，不需要开放家庭路由器端口，也不会把 ComfyUI 的 `8188` 暴露到公网。门户是独立服务；每台工作站仍运行完整 TakeBoard，并继续执行本地账号与项目角色校验。

> [!IMPORTANT]
> 当前版本是可审计的自托管预览，不是 TakeBoard 官方运营的公共云。它适合个人和可信团队自行部署；正式公共服务仍需要 MFA / Passkey、邮件恢复、滥用治理、容量隔离和专业安全运营。

## 运行边界

门户保存：

- 门户账号的邮箱、显示名、密码哈希与会话摘要；
- 工作站名称、版本、在线时间、撤销状态和设备令牌摘要；
- 配对、登录、远程打开和撤销审计；
- 配对有效期内临时加密保存的设备令牌。

门户不保存项目数据库、素材、提示词、Workflow 或生成结果。远程请求会经过门户内存中继；由于 TLS 在门户终止，门户运营者在技术上能够读取传输内容，因此这不是端到端加密。保密制作请继续使用 SSH 或自己控制的 HTTPS 私网入口。

## 域名与 HTTPS

准备一个主域名和通配符记录，两者都指向门户：

```text
portal.example.com
*.portal.example.com
```

证书也必须同时覆盖主域名和通配符域名。门户拒绝不匹配的 Host；非回环部署拒绝 HTTP。反向代理必须保留原始 Host，并支持 WebSocket Upgrade。下面是 Nginx 的最小示例：

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  '' close;
}

server {
  listen 443 ssl http2;
  server_name portal.example.com *.portal.example.com;

  ssl_certificate /etc/letsencrypt/live/portal.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/portal.example.com/privkey.pem;
  client_max_body_size 110m;

  location / {
    proxy_pass http://127.0.0.1:49200;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 620s;
    proxy_buffering off;
  }
}
```

通配符证书通常需要 DNS-01 验证。不要为了省略证书配置而把 Portal、TakeBoard 或 ComfyUI 的明文端口直接开放到互联网。

## 安装与启动

需要 Node.js `>=22.12 <27`、pnpm 10 和持久化数据目录：

```bash
git clone https://github.com/Fourques/Takeboard.git
cd Takeboard
corepack enable
pnpm install --frozen-lockfile
pnpm portal:build
```

先生成一次性的首次设置密钥，再创建仅服务账号可读的环境文件，例如 `/etc/takeboard-portal.env`：

```bash
openssl rand -base64 36
```

```dotenv
TAKEBOARD_PORTAL_BIND_HOST=127.0.0.1
TAKEBOARD_PORTAL_PORT=49200
TAKEBOARD_PORTAL_HOSTNAME=portal.example.com
TAKEBOARD_PORTAL_ORIGIN=https://portal.example.com
TAKEBOARD_PORTAL_DATABASE=/var/lib/takeboard-portal/portal.db
TAKEBOARD_PORTAL_SECURE_COOKIES=1
TAKEBOARD_PORTAL_ALLOW_REGISTRATION=0
TAKEBOARD_PORTAL_BOOTSTRAP_TOKEN=replace-with-a-random-secret-of-at-least-24-characters
TAKEBOARD_PORTAL_AUDIT_RETENTION_DAYS=180
```

首次启动时，门户会在数据库旁生成权限为 `0600` 的主密钥文件。也可以通过 `TAKEBOARD_PORTAL_MASTER_KEY` 注入 32 字节 base64url 密钥；此时应从机密管理器提供，不要写入仓库或镜像。

```bash
set -a
. /etc/takeboard-portal.env
set +a
pnpm portal:start
```

公网门户首次启动强制要求至少 24 字符的 `TAKEBOARD_PORTAL_BOOTSTRAP_TOKEN`；部署者需要在首次设置页面同时输入这项密钥，避免空数据库刚上线时被他人抢注。创建首个管理员后应从环境文件删除该密钥并重启。只有回环地址上的开发门户允许免密初始化。

完成首个账号后，即使 `TAKEBOARD_PORTAL_ALLOW_REGISTRATION=0` 也不会再允许匿名注册。需要开放额外账号时可以短暂设为 `1`，创建后立即关闭；当前版本尚未提供组织邀请与域名准入。

过期会话会在访问时和服务启动时清理；登录失败与过期配对临时数据在启动时清理。安全活动默认保留 180 天，可在 7–3650 天之间调整。项目与媒体载荷从不写入 Portal 数据库或审计日志。

长期运行可以使用 systemd，并让服务直接读取受保护的环境文件：

```ini
[Unit]
Description=TakeBoard account portal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=takeboard-portal
Group=takeboard-portal
WorkingDirectory=/opt/takeboard
EnvironmentFile=/etc/takeboard-portal.env
ExecStart=/usr/bin/node /opt/takeboard/apps/portal/dist/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/takeboard-portal

[Install]
WantedBy=multi-user.target
```

## 配对工作站

1. 在本地 TakeBoard 创建或登录实例管理员账号；
2. 打开头像菜单中的“访问与安装”；
3. 在“TakeBoard 账号门户”输入 `https://portal.example.com` 并生成一次性代码；
4. 在门户登录，输入代码并确认工作站名称；
5. 等待状态变为“在线”，再从设备卡片打开工作站。

代码短时有效且只能认领一次。工作站把门户账号显式绑定到发起配对的本地管理员，不会按邮箱自动合并身份。门户转发请求时会建立独立的短期本地会话，因此本机账号停用、项目角色变化和服务端校验仍然生效。

撤销既可以从门户设备卡片发起，也可以在工作站“访问与安装”中解除。门户撤销会立即关闭在线 Connector；浏览器现有请求会失败，但已经提交到本地队列的生成任务不会因网页断开而丢失，可在重新授权后继续查看。

## 备份、升级与恢复

数据库与主密钥必须作为一组备份：

```text
/var/lib/takeboard-portal/portal.db
/var/lib/takeboard-portal/portal.db-wal
/var/lib/takeboard-portal/portal.db-shm
/var/lib/takeboard-portal/portal.db.key
```

使用 SQLite 在线备份或停服后一致性复制，不要只复制主数据库而遗漏 WAL。丢失主密钥会使仍在有效期内的配对凭据不可恢复；泄露数据库和主密钥则需要立即撤销全部设备与会话。升级前先备份，执行 `pnpm install --frozen-lockfile && pnpm portal:build`，再重启服务并检查：

```bash
curl -fsS https://portal.example.com/__portal/api/health
```

## 当前限制

- 单次远程请求上限为 110 MB；请求体当前以有界内存缓冲后发送，视频响应按分片流式返回并支持 HTTP Range；
- 不代理浏览器到本机服务的任意 WebSocket，TakeBoard 当前核心页面不依赖此能力；
- 没有云端项目索引、素材同步、云端生成或 ComfyUI 直连；
- 没有 MFA / Passkey、邮件找回、组织共享、配额与滥用治理；
- 桌面安装器仍未取得 Apple notarization 与 Windows 商业签名。

这些限制会在界面和发布说明中保持明确，不能把自托管预览宣传为已经运营的多租户 SaaS。
