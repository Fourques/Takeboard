# TakeBoard 自托管部署

更新时间：2026-08-28

TakeBoard 默认只监听服务器回环地址。推荐使用用户级 systemd 保持服务稳定运行，再通过标准 SSH 隧道访问；当前版本没有账号系统，不应直接暴露到公网。

## 不需要维护服务的简易方式

个人电脑或临时服务器可以先用跨平台简易启动器：

```bash
npm run easy:setup   # 首次：安装、验证、构建并启动
npm run easy         # 以后：后台启动并打开浏览器
npm run easy:stop    # 停止服务，不删除数据
npm run easy:doctor  # 中文诊断与下一步建议
```

启动器读取已有的 `~/.config/takeboard/env` 配置，自动避开 `48120–48139` 的端口冲突，并把日志写入用户状态目录。源码或依赖更新后会自动安装/重建；项目目录不可写时会在启动前阻止运行；日志超过 10 MB 后保留一份轮换副本。需要长期运行、开机恢复和集中运维时，再使用下面的 systemd 方案。

## 安装稳定服务

支持 systemd user service 的 Linux 主机可直接执行：

```bash
corepack enable
pnpm install --frozen-lockfile
./scripts/takeboard install
```

安装脚本会完成完整验证、生产构建、用户服务模板渲染、开机启用和健康检查。生成的文件包括：

- `~/.config/systemd/user/takeboard.service`：当前仓库路径对应的服务单元；
- `~/.config/takeboard/env`：权限为 `0600` 的运行配置；
- `~/TakeBoardData`：默认项目数据目录。

服务固定监听 `127.0.0.1:48120`。安装不会把仓库路径写死在版本库中，因此其他用户和不同安装位置可以复用同一套流程。

## 配置

编辑 `~/.config/takeboard/env`：

```dotenv
COMFY_URL=http://127.0.0.1:8188
COMFY_EDITOR_URL=http://127.0.0.1:48188
COMFY_INPUT_ROOT=/opt/comfyui/input
COMFY_OUTPUT_ROOT=/opt/comfyui/output
```

也可以在首次安装前设置：

```bash
TAKEBOARD_DATA_ROOT=/srv/takeboard-data ./scripts/takeboard install
```

变量说明：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `TAKEBOARD_DATA_ROOT` | `~/TakeBoardData` | 所有 `.takeboard` 项目的父目录 |
| `COMFY_URL` | `http://127.0.0.1:8188` | TakeBoard 服务端调用的 ComfyUI API |
| `COMFY_EDITOR_URL` | `http://127.0.0.1:48188` | 浏览器打开 ComfyUI 编辑器的地址 |
| `COMFY_INPUT_ROOT` | 空 | 允许清理本次 Run 创建的输入临时文件 |
| `COMFY_OUTPUT_ROOT` | 空 | 允许清理本次 Run 创建的输出临时文件 |

修改配置后执行 `./scripts/takeboard restart`。

安全启动 ComfyUI 所需的 provider、进程参数和资源阈值见
[`deploy/takeboard.env.example`](../deploy/takeboard.env.example)。未明确配置可验证的启动方式时，
TakeBoard 只检测连接，不会尝试启动未知进程。

## 日常维护

```bash
./scripts/takeboard status
./scripts/takeboard logs
./scripts/takeboard restart
./scripts/takeboard doctor
```

更新代码时建议先确认没有正在生成的任务：

```bash
git pull --ff-only
pnpm install --frozen-lockfile
pnpm verify
./scripts/takeboard restart
```

`doctor` 会检查 Node.js、pnpm、服务状态、API、ComfyUI 和 SSH 客户端，适合作为故障排查入口。

## 开发与稳定服务切换

```bash
./scripts/takeboard dev
```

如果稳定服务正在运行，脚本会先停止它，释放 API 端口；退出开发模式时会自动恢复。开发 UI 位于 <http://127.0.0.1:48110>，稳定 UI 位于 <http://127.0.0.1:48120>。

## 远程访问

在 Mac 或 Linux 客户端执行：

```bash
./scripts/takeboard-tunnel connect your-server
```

终端退出时隧道和本地端口会一同释放。服务器可以通过普通公网 SSH、局域网或 Tailscale 网络抵达，隧道方式保持一致。详细说明和端口冲突处理见[远程访问指南](./remote-access.md)。

## 备份

单项目迁移可以直接在首页项目卡下载带完整性清单的 `.takeboard.tgz`，再通过首页“导入”恢复。整机备份则复制完整的 `TAKEBOARD_DATA_ROOT`。如果要求严格一致，应先避免新的写入或短暂停止服务：

```bash
./scripts/takeboard stop
rsync -a ~/TakeBoardData/ /path/to/backup/TakeBoardData/
./scripts/takeboard start
```

项目内部结构与迁移要求见[数据目录规范](./data-layout.md)。

## 安全边界

- 不要把 `48120` 或 `8188` 直接映射到公网；
- 只给可信 tailnet 成员或 SSH 用户访问权限；
- `~/.config/takeboard/env` 可能包含私有路径或令牌，应保持 `0600`；
- `COMFY_INPUT_ROOT` 与 `COMFY_OUTPUT_ROOT` 必须精确指向对应目录，避免扩大清理范围；
- 上线更新前先检查推理队列，避免中断正在运行的生成任务。

服务会拒绝非回环监听。只有在已配置身份认证的反向代理后，才可显式设置 `TAKEBOARD_ALLOW_NON_LOOPBACK=1`，并用 `TAKEBOARD_ALLOWED_HOSTS`、`TAKEBOARD_ALLOWED_ORIGINS` 限定入口。这个开关本身不提供账号、会话或权限控制；个人远程使用仍推荐 SSH 隧道。
