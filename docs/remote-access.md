# TakeBoard 远程访问

更新时间：2026-08-28

TakeBoard 只监听服务器回环地址。稳定服务默认使用 `127.0.0.1:48120`；简易启动器在冲突时会使用 `48120–48139` 中的空闲端口。远程用户通过标准 SSH 本地端口转发访问，不需要 Tailscale Serve、专用客户端或公开 Web 端口。

登录后打开头像中的“访问与安装”，可以看到当前连接方式、实例标识、账号与监听边界检查，并复制与服务器实际端口一致的 SSH 命令。这里显示的是服务端实时状态，不会把尚未提供的云门户标记为可用。

SSH 服务器可以通过公网域名、局域网 IP、跳板机或 Tailscale 主机名抵达。Tailscale 在这里仅是可选网络通道，隧道机制始终是 OpenSSH `-L`。

## 推荐方式

不熟悉命令行时，在项目根目录双击：

- macOS：`CONNECT-REMOTE.command`；
- Windows：`CONNECT-REMOTE.cmd`。

输入 SSH 主机后，窗口会保持连接并自动打开页面。关闭窗口或按 `Ctrl-C` 会同时关闭 SSH 并释放本地端口。也可以在任意平台运行：

```bash
npm run easy:remote -- your-server
```

这个入口会为远端 `48120–48139` 建立临时探测映射，自动选择真正通过 TakeBoard 健康检查的端口；本地从 `48230` 起选择空闲端口，ComfyUI 则使用 `48188–48208` 中的空闲端口。连接窗口关闭后，这些映射会一起释放。明确设置 `TAKEBOARD_REMOTE_PORT` 时只连接指定端口。

### 管理脚本方式

在 Mac 或 Linux 客户端的项目目录执行：

```bash
./scripts/takeboard-tunnel connect your-server
```

`your-server` 可以是 `user@example.com`、IP 地址或 `~/.ssh/config` 中的别名。脚本会：

1. 检查本机 TakeBoard 端口是否可用；
2. `48230` 被 VS Code 或其他程序占用时，在 `48230–48249` 内自动选择后续空闲端口；
3. 转发远端 TakeBoard `48120` 和 ComfyUI `8188`；
4. 健康检查通过后自动打开浏览器；
5. 保持隧道附着在当前终端；
6. 按 `Ctrl-C`、关闭终端或 SSH 连接失效时，自动释放本地端口。

终端会明确显示实际地址：

```text
TakeBoard tunnel is ready.
URL: http://127.0.0.1:48231
ComfyUI: http://127.0.0.1:48188
Keep this terminal open. Press Ctrl-C to disconnect.
```

`start` 是 `connect` 的兼容别名：

```bash
./scripts/takeboard-tunnel start your-server
```

## 不复制项目脚本

客户端没有仓库时，可以直接使用 OpenSSH：

```bash
ssh -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L 48230:127.0.0.1:48120 \
  -L 48188:127.0.0.1:8188 \
  your-server
```

打开 <http://127.0.0.1:48230>。这条命令保持前台运行；按 `Ctrl-C` 或关闭终端后，SSH 进程结束，两个监听端口随之释放。

## 使用 Tailscale 网络

如果服务器和客户端已经位于同一 tailnet，不需要改变隧道方式，只需把 SSH 目标换成 Tailscale 主机名或 IP：

```bash
./scripts/takeboard-tunnel connect your-server-tail
```

也可以在 SSH 配置里保存：

```sshconfig
Host takeboard-server
  HostName your-server.tailnet.ts.net
  User your-user
```

然后仍然执行：

```bash
./scripts/takeboard-tunnel connect takeboard-server
```

## 状态与手动停止

连接通常随当前终端自动结束。需要从另一个终端检查或提前停止时：

```bash
./scripts/takeboard-tunnel status
./scripts/takeboard-tunnel open
./scripts/takeboard-tunnel stop
```

状态文件位于客户端的 `${XDG_STATE_HOME:-~/.local/state}/takeboard`，只保存 SSH 目标、端口和进程号，不包含密码或私钥。异常断电可能留下状态文件，但不会留下仍在监听的 SSH 进程；下次 `connect` 会自动清理失效状态。

## 端口已监听

“端口正在监听”不一定表示 TakeBoard 隧道可用。VS Code Remote、旧 SSH 或其他应用都可能占用端口。

```bash
lsof -nP -iTCP:48230 -sTCP:LISTEN
```

不要直接结束未知进程。项目脚本会自动换到 `48231`、`48232` 等空闲端口，并输出真正应该打开的 URL。

如果 `status` 显示旧的受管隧道仍在运行：

```bash
./scripts/takeboard-tunnel stop
```

## SSH 配置建议

```sshconfig
Host takeboard-server
  HostName example.com
  User your-user
  IdentityFile ~/.ssh/id_ed25519
  ServerAliveInterval 30
  ServerAliveCountMax 3
```

建议使用 SSH 密钥，并在服务器侧限制允许登录的用户。不要在仓库中提交私钥、密码、真实域名或其他凭据。

## 团队 HTTPS 入口

需要固定域名时，应在经过认证的反向代理或出站隧道前提供 HTTPS，并同时配置：

```dotenv
TAKEBOARD_PUBLIC_URL=https://studio.example.com
TAKEBOARD_ALLOWED_HOSTS=studio.example.com
TAKEBOARD_ALLOWED_ORIGINS=https://studio.example.com
TAKEBOARD_SECURE_COOKIES=1
TAKEBOARD_AUTH_MODE=required
```

`TAKEBOARD_PUBLIC_URL` 只用于声明并检查规范入口，不会自行创建隧道、申请证书或改变监听地址。账号中心会联合检查 HTTPS、安全 Cookie、Host 与 Origin 白名单；任一项缺失都会显示为“需处理”。不要把 ComfyUI 的 `8188` 端口一同发布。

需要登录后从任意电脑找到工作站时，可以部署独立的 TakeBoard Portal。它使用一次性代码把门户账号显式映射到本地管理员，并由工作站主动建立出站连接；不等同于当前实例账号，也不会按邮箱自动合并。部署和隐私边界见[账号门户自托管](portal-self-hosting.md)，架构与后续 Gate 见[账号门户与大众化分发策略](access-and-distribution-strategy.md)。
