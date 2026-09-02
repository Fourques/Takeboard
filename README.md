# TakeBoard

<p align="right"><a href="README.en.md">English</a> · 简体中文</p>

<p align="center">
  <strong>把素材、镜头、工作流与每一次生成，放回同一张导演板。</strong><br />
  面向 ComfyUI 创作者的开源、本地优先 AI 影像工作台。
</p>

<p align="center">
  <a href="https://github.com/Fourques/Takeboard/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Fourques/Takeboard/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-315EFB.svg" /></a>
  <img alt="Node.js 22.12+" src="https://img.shields.io/badge/Node.js-22.12%2B-171717?logo=nodedotjs" />
  <a href="https://github.com/Fourques/Takeboard/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/Fourques/Takeboard?include_prereleases&label=public%20preview&color=D99A46" /></a>
</p>

![TakeBoard 项目主页](docs/assets/takeboard-home.webp)

TakeBoard 不重做 ComfyUI 的节点系统。它在现有 Workflow 和算力之上补充项目层：管理角色、场景、道具、镜头、Run、候选 Take 与最终选片，并保留每个结果的来源关系。

模型、工作流、素材和项目文件始终保存在自己的设备上。没有 ComfyUI 时，也可以完整使用项目管理和画布界面。

> [!IMPORTANT]
> TakeBoard 现在提供服务端账号、设备会话、实例管理员和项目 Owner / Editor / Viewer 权限。服务仍默认只监听 `127.0.0.1`；个人远程可使用 SSH 隧道，也可连接独立自托管的 TakeBoard Portal。团队公网入口必须使用 HTTPS，ComfyUI 端口不要直接开放到公网。

## 能力概览

- 以可旋转的导演板作为项目入口，在同一界面创建、预览、重命名、删除和恢复项目；
- 新项目只需命名即可进入空白工作画板，不预设第一场、首镜意图或项目级画幅；
- 为每个项目维护独立画板、素材库、镜头、Workflow、Run 与 Take；
- 画幅属于具体镜头，可在同一项目中并存横屏、竖屏与宽银幕内容；
- 用首帧、尾帧和参考输入等影视语义连接素材与镜头；
- 检测和导入 ComfyUI Workflow，以显式、带哈希的参数绑定运行可信自定义工作流；
- 执行文生图、图生图、图生视频和首尾帧视频任务；
- 跟踪 ComfyUI 真实节点进度、取消任务、回收结果，并保存可复现的参数快照；
- 管理本机、SSH 隧道和 HTTPS 远程 ComfyUI 执行端，按隐私、速度、成本、质量或预算策略透明调度；
- 通过可选扩展汇总每个 Run 与镜头的精确、估算或未知成本，并按需启用跨镜头批量审片与粗剪预览；
- 通过默认不执行第三方代码的扩展库，安装团队质检规则与外部工具入口；
- 在跨项目任务中心集中查看、停止和恢复生成，并按项目与数据类型检查磁盘占用；
- 生成脱敏运行诊断报告，明确区分正常、警告和阻断项，便于远程排障；
- 从首页流式导出、校验并重新导入完整 `.takeboard.tgz` 项目包；
- 以独立 `.takeboard` 目录保存项目，方便备份、迁移和版本归档。
- 一次性团队邀请、离线恢复码、可验证实例备份与保留旧数据的离线恢复。
- 在账号中心检查本机、SSH 与团队 HTTPS 的真实可用状态，并复制与当前端口一致的安全连接命令；
- 通过一次性代码连接自托管账号门户，由工作站主动建立出站连接；门户撤销与本地项目权限持续生效；
- 支持从浏览器安装为独立 Web App 窗口，便携包继续覆盖六种系统/CPU 组合；
- 可选的跨存储定时实例备份、日/周/月保留策略、损坏检测与隔离恢复演练。
- 分镜墙始终提供真实镜头顺序与覆盖率；按需启用粗剪扩展后，可播放只读节奏预览，未采用镜头仍只显示计划空镜。

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

最省事的方式是在 [Releases](https://github.com/Fourques/Takeboard/releases) 下载与你系统和 CPU
对应的构建：发布页有桌面安装包时优先使用 DMG、MSI/NSIS 或 AppImage/Deb；尚未提供时使用
`takeboard-*.tar.gz` 便携预览包。
两种形式都内置匹配的 Node.js 运行时，不需要安装 pnpm；桌面版会自动启动本机服务并在同一窗口进入
TakeBoard，重复打开只会聚焦已有窗口。

| 系统 | 解压后打开 |
| --- | --- |
| macOS | 右键打开 `START-TAKEBOARD.command` |
| Windows | 双击 `START-TAKEBOARD.cmd` |
| Linux | 运行 `./start-takeboard.sh` |

桌面版使用随机空闲回环端口，便携包会在 `48120–48139` 中避让；两者的项目都默认保存在
`~/TakeBoardData`，可以互相切换而不迁移数据。当前预览构建具有 SHA-256 和 GitHub Actions
构建来源证明，但还没有 Apple notarization / Windows 代码签名；下载页会明确标注这一边界。可以用
GitHub CLI 验证构建来源：

```bash
gh attestation verify takeboard-*.tar.gz --repo Fourques/Takeboard
```

从源码构建桌面预览需要 Rust、Tauri 对应平台依赖和 Node.js 22.12–26.x：

```bash
pnpm install --frozen-lockfile
pnpm desktop:prepare   # 构建并自检内置服务、Web UI、Node sidecar 与原生模块
pnpm desktop:bundle    # 生成当前系统的安装包
```

从源码运行时要求 Node.js `>= 22.12 < 27`，以及可选的 ComfyUI。下载或克隆项目后，也可以继续使用根目录里的启动入口：

| 系统 | 首次与日常打开 |
| --- | --- |
| macOS | 右键打开 `START-TAKEBOARD.command` |
| Windows | 双击 `START-TAKEBOARD.cmd` |
| Linux | 运行 `npm run easy:setup`；之后运行 `npm run easy` |

源码简易启动器会自动安装依赖、检查并重建更新后的代码、避开已占用端口、后台启动服务并打开浏览器。它会预检项目目录是否可写、避免重复启动，并轮换超过 10 MB 的旧日志。项目默认保存在 `~/TakeBoardData`；关闭服务不会删除数据。打不开时运行：

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
账号门户与原生安装器的产品边界、威胁模型和分阶段 Gate 见[账号门户与大众化分发策略](docs/access-and-distribution-strategy.md)。

### 账号门户（可选，自托管预览）

需要从任意电脑登录后找到自己的工作站时，可以单独部署 Portal：

```bash
pnpm portal:build
TAKEBOARD_PORTAL_HOSTNAME=portal.example.com \
TAKEBOARD_PORTAL_ORIGIN=https://portal.example.com \
TAKEBOARD_PORTAL_DATABASE=/var/lib/takeboard-portal/portal.db \
TAKEBOARD_PORTAL_SECURE_COOKIES=1 \
pnpm portal:start
```

Portal 需要主域名、通配符子域名和 HTTPS 反向代理。工作站只建立出站连接，不要求路由器端口转发；项目、素材和 ComfyUI 仍留在工作站，本地账号和项目角色仍是最终权限边界。当前是自托管预览，不是官方运营的多租户云。部署、证书、备份、隐私和已知限制见[账号门户自托管指南](docs/portal-self-hosting.md)。

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

生成提交前还会检查 TakeBoard 项目盘和已配置的 ComfyUI 输出盘。默认分别保留 5 GB 和 8 GB 安全余量，空间不足时不会先上传素材再报错；可通过 `TAKEBOARD_MIN_FREE_DISK_GB` 和 `COMFY_MIN_FREE_OUTPUT_DISK_GB` 调整阈值。

模型与 Custom Node 的可用性取决于自己的 ComfyUI 环境。TakeBoard 不会自动下载来源不明的模型或节点。

自定义 Workflow 导入后会立即进入当前电脑的节点、模型和参数诊断，但默认仍处于“待映射”，不会提前写入镜头，也不会因文件名相似而获得执行权限。在工作流库中检查提示词、尺寸、Seed、时长和素材入口，确认信任并通过当前 ComfyUI 节点预检后，状态才会变成“已验证”。视频工作流可把秒数安全换算为 `num_frames` / `frame_count`；底层 JSON 一旦变化，内容哈希会使旧映射自动失效。详细流程见[创作工作站指南](docs/creator-workstation.md#workflow-与模型)。

### 多执行端与可选制片工具

实例管理员可在首页 ComfyUI 面板添加远程执行端。普通 HTTP 只接受映射到本机回环地址的 SSH 隧道；跨网络直连必须使用 HTTPS，URL 不允许携带用户名、密码或查询凭据。新节点默认不能接收图片、视频和音频，管理员需要再次明确授权。移除节点会停止它参与新调度，但保留在途 Run 对账所需的稳定身份。ComfyUI 标准接口不提供删除已上传输入素材的通用能力；远程节点应使用隔离的输入目录并配置独立的保留与清理策略。

每次生成可选择均衡、仅本机、隐私优先、最快、成本优先、质量优先或单次预算上限。选择结果、候选节点、队列、优先级和排除原因会始终写入 Run，这是生成溯源的一部分，不依赖扩展。

“粗剪预览”“成本洞察”“批量审片”和“成片完整性质检”作为随 TakeBoard 提供的四个可选扩展，默认关闭。只有确实需要整片节奏、费率核算或集中审片的用户才需启用；关闭后分镜墙只保留核心分镜视图，相应成本和批量审批接口也不会开放。启用成本洞察后，自托管节点按管理员设置的每小时费率计算估算值；没有可靠费率时显示“未知”，不会按零成本处理，也不会把不同币种相加。

### 扩展库

项目顶部的“扩展”入口统一管理内置可选能力与团队扩展。当前 `declarative-v1` 只接受经过结构校验、内容指纹确认和管理员信任的 JSON 清单，可贡献受控工作区功能、项目质检规则与 HTTP(S) 外部工具链接；内置和本地扩展均需明确启用，本地清单安装后仍默认停用。它不会运行第三方 JavaScript、Python、Shell 或自动安装 ComfyUI Custom Node。清单格式、安全边界与后续签名运行时设计见[扩展开发与信任模型](docs/extensions.md)。

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
| `apps/portal` | 可选的账号入口、设备目录和无持久媒体的出站连接中继 |
| `packages/contracts` | 前后端共享契约 |
| `packages/domain` | Project、Shot、Run、Take 等领域模型 |
| `packages/executor-comfy` | Workflow 检测、参数注入与 ComfyUI 适配 |
| `packages/identity` / `portal-protocol` | 本地与门户共享的身份原语、受限中继协议 |

更多设计边界见[技术架构](docs/architecture.md)。

## 开发与验证

```bash
pnpm verify       # lint + typecheck + build + unit/integration tests
pnpm test:e2e     # Playwright 浏览器流程
pnpm gate:release # 完整自动发布门槛（含 40 Run 与 500 节点）
pnpm gate:gpu     # 对已启动实例执行一次真实 GPU 端到端门槛
pnpm format       # 格式化代码
```

首次运行浏览器测试前执行 `pnpm exec playwright install chromium`。服务器已有 Chrome 时，也可以通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome` 指定现有浏览器。

发布门槛、阈值和真实 GPU 使用方式见[发布门槛](docs/release-gates.md)。提交 Workflow 兼容性问题时，请附上 ComfyUI 版本、相关 Custom Node、期望输入输出和脱敏后的复现步骤；不要提交 API Key、私有素材或其他凭据。

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
| [成熟度评估](docs/maturity-audit-2026-08-30.md) | 当前上线边界、质量证据、风险和下一阶段 Gate |
| [开发路线图](docs/roadmap.md) | Gate、验收标准与后续方向 |
| [扩展开发与信任模型](docs/extensions.md) | 扩展清单、权限、安装流程与未来代码插件边界 |

## 路线图

- [x] 多项目主页、预览与项目管理
- [x] 内容画布、素材节点与语义连线
- [x] Workflow 检测、导入和常用参数映射
- [x] ComfyUI 任务、取消、结果回收与 Take 管理
- [x] 1–4 个真实候选批次、独立 Run、整批停止与单候选重试
- [x] 带内容哈希、显式信任和执行前校验的 Workflow Binding v1
- [x] 带完整性清单、依赖诊断与目标机重新信任的可移植 Workflow/Binding Recipe 包
- [x] 分镜墙、镜头排序、缩略图和整片覆盖率
- [x] 默认关闭、按需启用的只读粗剪与时间线预览扩展
- [x] 多 Worker、远程算力与可解释的执行策略
- [x] 完整项目包导入导出与升级前自动备份
- [x] 默认关闭的成本洞察与跨镜头审批扩展
- [x] 默认禁用第三方代码的声明式扩展库、内置可选能力与项目质检

## 反馈与贡献

- 遇到运行问题：先打开“任务中心 → 运行诊断”，下载报告后使用 [Bug 报告](https://github.com/Fourques/Takeboard/issues/new/choose)；
- 自定义 Workflow 无法运行：使用专门的兼容性表单，附脱敏后的节点与绑定信息；
- 较大改动：先阅读 [贡献指南](CONTRIBUTING.md) 并在 Issue 中确认产品边界；
- 安全问题：不要公开提交，请按 [安全策略](SECURITY.md) 私下报告。

## License

[Apache License 2.0](LICENSE)
