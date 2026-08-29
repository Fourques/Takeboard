# TakeBoard

<p align="center">
  <strong>把素材、镜头、工作流与每一次生成，放回同一张导演板。</strong><br />
  面向 ComfyUI 创作者的开源、本地优先 AI 影像工作台。
</p>

<p align="center">
  <a href="https://github.com/Fourques/Takeboard/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Fourques/Takeboard/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-315EFB.svg" /></a>
  <img alt="Node.js 22.12+" src="https://img.shields.io/badge/Node.js-22.12%2B-171717?logo=nodedotjs" />
  <img alt="Public preview 0.1.0" src="https://img.shields.io/badge/status-public_preview_0.1.0-D99A46" />
</p>

![TakeBoard 项目主页](docs/assets/takeboard-home.webp)

TakeBoard 不重做 ComfyUI 的节点系统。它在现有 Workflow 和算力之上补充项目层：管理角色、场景、道具、镜头、Run、候选 Take 与最终选片，并保留每个结果的来源关系。

模型、工作流、素材和项目文件始终保存在自己的设备上。没有 ComfyUI 时，也可以完整使用项目管理和画布界面。

> [!IMPORTANT]
> 当前版本适合个人创作和可信团队试用，尚未提供账号与权限系统。服务默认只监听 `127.0.0.1`；请使用 SSH 隧道或带身份认证的反向代理远程访问，不要直接开放到公网。

## 能力概览

- 以可旋转的导演板作为项目入口，在同一界面创建、预览、重命名、删除和恢复项目；
- 新项目只需命名即可进入空白工作画板，不预设第一场、首镜意图或项目级画幅；
- 为每个项目维护独立画板、素材库、镜头、Workflow、Run 与 Take；
- 画幅属于具体镜头，可在同一项目中并存横屏、竖屏与宽银幕内容；
- 用首帧、尾帧和参考输入等影视语义连接素材与镜头；
- 检测和导入 ComfyUI Workflow，以显式、带哈希的参数绑定运行可信自定义工作流；
- 执行文生图、图生图、图生视频和首尾帧视频任务；
- 跟踪 ComfyUI 真实节点进度、取消任务、回收结果，并保存可复现的参数快照；
- 从首页流式导出、校验并重新导入完整 `.takeboard.tgz` 项目包；
- 以独立 `.takeboard` 目录保存项目，方便备份、迁移和版本归档。

```text
角色 / 场景 / 道具 / 参考图
              │
              ├── 首帧 / 尾帧 / 参考输入
              ▼
Project → Scene → Shot → Run → Take → Approved Take
                         │
                         └── ComfyUI Recipe / Workflow
```

## 快速开始

环境要求：Node.js `>= 22.12 < 27`，以及可选的 ComfyUI。普通使用不需要先理解 pnpm、端口或环境变量。

下载项目后，可以直接使用根目录里的启动入口：

| 系统 | 首次与日常打开 |
| --- | --- |
| macOS | 右键打开 `START-TAKEBOARD.command` |
| Windows | 双击 `START-TAKEBOARD.cmd` |
| Linux | 运行 `npm run easy:setup`；之后运行 `npm run easy` |

简易启动器会自动安装依赖、检查并重建更新后的代码、避开已占用端口、后台启动服务并打开浏览器。它会预检项目目录是否可写、避免重复启动，并轮换超过 10 MB 的旧日志。项目默认保存在 `~/TakeBoardData`；关闭服务不会删除数据。打不开时运行：

```bash
npm run easy:doctor
```

开发者仍可以使用完整开发模式：

```bash
git clone https://github.com/Fourques/Takeboard.git
cd Takeboard
corepack enable
pnpm install --frozen-lockfile
./scripts/takeboard dev
```

打开 <http://127.0.0.1:48110>。结束开发进程后，脚本会自动恢复先前运行的稳定服务，避免开发端口与日常使用互相冲突。

## 日常运行

### 本机稳定使用

Linux 主机推荐安装用户级 systemd 服务：

```bash
./scripts/takeboard install
./scripts/takeboard open
```

服务会随用户会话启动、异常后自动恢复，并固定监听 <http://127.0.0.1:48120>。常用操作统一由一个入口完成：

```bash
./scripts/takeboard status
./scripts/takeboard restart
./scripts/takeboard logs
./scripts/takeboard doctor
```

配置文件位于 `~/.config/takeboard/env`，修改后运行 `./scripts/takeboard restart` 生效。

### SSH 远程访问

Mac 和 Windows 用户可以分别双击 `CONNECT-REMOTE.command` 或 `CONNECT-REMOTE.cmd`，然后输入普通 SSH 地址、IP 或 `~/.ssh/config` 别名。启动器会寻找空闲本地端口，并自动探测远端 `48120–48139` 中实际运行 TakeBoard 的端口；健康检查通过后打开正确页面，关闭窗口就会释放全部隧道。

所有平台也可以执行：

```bash
npm run easy:remote -- your-server
```

原有 Mac / Linux 管理脚本仍然可用：

```bash
./scripts/takeboard-tunnel connect your-server
```

脚本会自动打开浏览器，并同时转发 ComfyUI 到 `48188`。默认使用 `48230`；如果端口已被 VS Code 等程序占用，会在 `48230–48249` 内自动选择下一个可用端口。隧道保持在前台，按 `Ctrl-C` 或关闭终端后会自动释放端口，不会留下长期占用。

`your-server` 可以是普通 SSH 地址、`~/.ssh/config` 别名、局域网地址，也可以是 Tailscale 主机名；无论网络如何连通，使用的都是标准 SSH 隧道。

```bash
./scripts/takeboard-tunnel status
./scripts/takeboard-tunnel stop
```

完整场景、故障诊断与安全边界见[远程访问指南](docs/remote-access.md)。

## 连接 ComfyUI

开发模式可以直接设置环境变量：

```bash
export COMFY_URL=http://127.0.0.1:8188
export COMFY_EDITOR_URL=http://127.0.0.1:48188
export COMFY_INPUT_ROOT=/path/to/ComfyUI/input
export COMFY_OUTPUT_ROOT=/path/to/ComfyUI/output
./scripts/takeboard dev
```

稳定服务则编辑 `~/.config/takeboard/env`。其中 `COMFY_URL` 是服务端访问的 API 地址，`COMFY_EDITOR_URL` 是用户浏览器打开编辑器时使用的地址；远程部署时两者通常不同。配置输入和输出根目录后，TakeBoard 才会清理由本次 Run 创建的临时文件。

首页右上角的 ComfyUI 状态面板可以重新检测连接，并在安全预检通过后启动本机执行端。启动方式按平台配置：

| 平台 / 安装方式 | `COMFY_LAUNCH_PROVIDER` | 需要配置 |
| --- | --- | --- |
| Linux user systemd | `systemd` | `COMFY_START_SERVICE=takeboard-comfy.service` |
| macOS LaunchAgent | `launchd` | `COMFY_LAUNCHD_LABEL=your.comfyui.label` |
| Windows Service | `windows-service` | `COMFY_WINDOWS_SERVICE=ComfyUI` |
| 任意平台独立进程 | `process` | `COMFY_START_EXECUTABLE`、`COMFY_START_ARGS_JSON`、`COMFY_START_CWD` |

独立进程模式直接调用明确的可执行文件和参数数组，不使用 shell，也不会执行网页传入的命令。`COMFY_ACCELERATOR` 可设为 `auto`、`nvidia`、`apple` 或 `cpu`；默认至少需要 6 GB 可用内存，NVIDIA 模式还需要 4 GB 空闲显存且 GPU 负载不高于 85%。阈值可用 `COMFY_MIN_FREE_RAM_GB`、`COMFY_MIN_FREE_VRAM_GB` 和 `COMFY_MAX_GPU_UTILIZATION` 调整。

TakeBoard 只启动指向 `127.0.0.1`、`localhost` 或 `::1` 的 ComfyUI。启动目标无法验证、资源不足、已有异常进程或启动超时时都会中止；超时后会停止本次启动的服务。

模型与 Custom Node 的可用性取决于自己的 ComfyUI 环境。TakeBoard 不会自动下载来源不明的模型或节点。

自定义 Workflow 导入后默认处于“待映射”，不会因文件名相似而获得执行权限。在工作流库中检查提示词、尺寸、Seed、时长和素材入口，确认信任并通过当前 ComfyUI 节点预检后，状态才会变成“已验证”。底层 JSON 一旦变化，内容哈希会使旧映射自动失效。详细流程见[创作工作站指南](docs/creator-workstation.md#workflow-与模型)。

## 项目数据

```text
TAKEBOARD_DATA_ROOT/
└── my-film.takeboard/
    ├── project.takeboard.json
    ├── takeboard.db
    ├── assets/
    ├── renders/
    ├── runs/
    ├── recipes/
    ├── logs/
    ├── exports/
    └── backups/migrations/  # 升级数据库前自动创建的一致性备份
```

每个项目都是完整、可独立备份的目录。首页项目卡的下载操作会生成带版本清单、文件大小与 SHA-256 校验的流式项目包；首页“导入”会先在隔离目录验签并打开数据库，成功后才进入项目库。生成任务运行中不会导出不一致快照。迁移时也可以复制整个 `.takeboard` 目录，但不要只复制数据库。详见[数据目录规范](docs/data-layout.md)。

## 架构

```text
React 19 · Vite · React Flow · Three.js
                    │
                    ▼
             Fastify Local API
        ┌───────────┼───────────┐
        ▼           ▼           ▼
  SQLite/Drizzle  Asset Store  Recipe Registry
                                  │
                                  ▼
                         ComfyUI Executor
```

| 目录 | 职责 |
| --- | --- |
| `apps/web` | 项目主页、内容画布、资产库与运行交互 |
| `apps/server` | 本地 API、项目持久化、媒体管理与任务编排 |
| `packages/contracts` | 前后端共享契约 |
| `packages/domain` | Project、Shot、Run、Take 等领域模型 |
| `packages/executor-comfy` | Workflow 检测、参数注入与 ComfyUI 适配 |

更多设计边界见[技术架构](docs/architecture.md)。

## 开发与验证

```bash
pnpm verify       # lint + typecheck + build + unit/integration tests
pnpm test:e2e     # Playwright 浏览器流程
pnpm format       # 格式化代码
```

首次运行浏览器测试前执行 `pnpm exec playwright install chromium`。服务器已有 Chrome 时，也可以通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome` 指定现有浏览器。

提交 Workflow 兼容性问题时，请附上 ComfyUI 版本、相关 Custom Node、期望输入输出和脱敏后的复现步骤；不要提交 API Key、私有素材或其他凭据。

## 文档

| 文档 | 内容 |
| --- | --- |
| [创作工作站](docs/creator-workstation.md) | 画布、素材、Workflow 与生成流程 |
| [视频质量工作流](docs/video-quality-workflows.md) | Wan 质量/预演分层、MiniMax H3 原生音画与提示词结构 |
| [远程访问](docs/remote-access.md) | 标准 SSH 隧道、自动清理与端口诊断 |
| [自托管部署](docs/self-hosting.md) | systemd、配置、升级与运行维护 |
| [数据目录](docs/data-layout.md) | 项目隔离、备份与迁移 |
| [技术架构](docs/architecture.md) | 模块边界、数据流与安全约束 |
| [易用性与可靠性审计](docs/usability-audit.md) | 完整用户旅程、已修断点与后续里程碑 |
| [开发路线图](docs/roadmap.md) | Gate、验收标准与后续方向 |

## 路线图

- [x] 多项目主页、预览与项目管理
- [x] 内容画布、素材节点与语义连线
- [x] Workflow 检测、导入和常用参数映射
- [x] ComfyUI 任务、取消、结果回收与 Take 管理
- [x] 带内容哈希、显式信任和执行前校验的 Workflow Binding v1
- [ ] 社区 Recipe 示例与可移植 Binding 包
- [ ] 分镜墙、整片覆盖率和只读粗剪
- [ ] 多 Worker、远程算力与可解释的执行策略
- [x] 完整项目包导入导出与升级前自动备份
- [ ] 成本统计与跨镜头审批

## License

[Apache License 2.0](LICENSE)
