# TakeBoard 远程访问

更新时间：2026-08-24

TakeBoard 只监听 `127.0.0.1:48120`。这个默认值可以避免服务被意外暴露到局域网或公网；远程访问由 Tailscale 或 SSH 在身份验证后接入。

## 方式选择

| 场景 | 推荐方式 | 特点 |
| --- | --- | --- |
| 自己的多台设备长期使用 | Tailscale Serve | 稳定 HTTPS 地址，不需要常驻终端 |
| 临时访问或无 Serve 权限 | SSH 隧道脚本 | 只依赖 SSH，自动避开本机端口冲突 |
| 本机开发 | `./scripts/takeboard dev` | 热更新，退出后恢复稳定服务 |
| 服务器日常运行 | `./scripts/takeboard install` | systemd 托管、自动重启、健康检查 |

## Tailscale Serve

服务器和访问设备应登录同一 tailnet。先确认 TakeBoard 正常，再启用私有 HTTPS：

```bash
./scripts/takeboard status
./scripts/takeboard-share enable
```

终端会输出类似下面的地址：

```text
https://your-server.your-tailnet.ts.net
```

`enable` 使用后台 Serve 配置，重启 Tailscale 或服务器后仍会保留。它没有启用 Funnel，因此不会把页面发布到公共互联网；实际访问权限仍由 tailnet 用户和 ACL 决定。

```bash
./scripts/takeboard-share status   # 查看代理目标
./scripts/takeboard-share url      # 只打印访问地址
./scripts/takeboard-share disable  # 移除 TakeBoard 的 HTTPS listener
```

首次启用 HTTPS 时，Tailscale 可能要求 tailnet 管理员批准证书功能。按终端给出的管理链接完成一次授权即可。

> ComfyUI 深度编辑器是独立服务。只使用 TakeBoard 项目界面时不需要额外设置；需要打开 ComfyUI 时，可使用下一节的 SSH 脚本同时转发 `48188`。

## SSH 隧道回退

在 Mac 或 Linux 客户端克隆仓库，或单独复制 `scripts/takeboard-tunnel`，然后运行：

```bash
./scripts/takeboard-tunnel start your-server
```

`your-server` 可以是 `~/.ssh/config` 中的别名、Tailscale 主机名或普通 SSH 地址。脚本会：

1. 先通过 SSH 检查远端 TakeBoard 健康状态；
2. 检查本机 `48220` 是否可用；
3. 端口被 VS Code、旧 SSH 或其他进程占用时，自动尝试后续端口；
4. 后台建立带保活和失败检测的 ControlMaster 隧道；
5. 同时把远端 ComfyUI `8188` 转发到本机 `48188`；
6. 输出本次实际可打开的地址。

之后无需保留终端窗口：

```bash
./scripts/takeboard-tunnel status
./scripts/takeboard-tunnel open
./scripts/takeboard-tunnel stop
```

如需指定 TakeBoard 本机端口：

```bash
./scripts/takeboard-tunnel start your-server 49000
```

隧道状态只保存在客户端的 `${XDG_STATE_HOME:-~/.local/state}/takeboard`，不会写入项目数据。

## 端口已监听但网页打不开

“端口正在监听”不等于隧道可用。VS Code Remote、失效的 SSH ControlMaster 或旧进程都可能占住端口，却无法把请求送到服务器。

先运行：

```bash
./scripts/takeboard-tunnel status
curl --fail --max-time 5 http://127.0.0.1:48220/api/health
```

如果不是由脚本管理的旧隧道，再查看端口所有者：

```bash
lsof -nP -iTCP:48220 -sTCP:LISTEN
```

无需为了释放端口直接结束未知进程。重新执行 `start`，脚本会选择下一个空闲端口并明确显示实际 URL。

## SSH 配置建议

把服务器信息放进 `~/.ssh/config`，日常命令会更短：

```sshconfig
Host takeboard-server
  HostName your-server.tailnet.ts.net
  User your-user
  ServerAliveInterval 30
  ServerAliveCountMax 3
```

之后只需：

```bash
./scripts/takeboard-tunnel start takeboard-server
```

不要在仓库中提交私钥、密码或真实凭据。
