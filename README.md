# TakeBoard

<p align="center">
  <strong>开源、自托管、ComfyUI-native 的 AI 影视创作画布</strong><br />
  在一个项目里管理素材、镜头、Workflow、生成候选与最终选片。
</p>

<p align="center">
  <a href="https://github.com/Fourques/Takeboard/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Fourques/Takeboard/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache--2.0-blue.svg" /></a>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22.12%2B-339933?logo=nodedotjs&logoColor=white" />
  <img alt="Status" src="https://img.shields.io/badge/status-early%20preview-F59E0B" />
</p>

TakeBoard 面向已经使用 ComfyUI 的 AI 短片、短剧、漫剧和广告创作者。它不会替代 ComfyUI，也不会把底层采样器、模型加载器和 ControlNet 节点重新做一遍；它在这些 Workflow 之上增加一个面向整部作品的项目层。

你可以把角色、场景、道具和参考图放进画布，通过语义连线指定首帧、尾帧或参考输入，调用自己的 ComfyUI Workflow 批量生成，再把每次结果保存为可追溯的 Take。模型、算力、工作流和项目文件都由用户掌控。

> [!IMPORTANT]
> TakeBoard 目前处于早期预览阶段，适合本地实验和可信团队试用。当前版本没有账号与权限系统，请勿将服务未经鉴权直接暴露到公网。

## 为什么是 TakeBoard

| 已有工具擅长什么 | TakeBoard 补充什么 |
| --- | --- |
| ComfyUI：设计和执行单次生成 Workflow | 组织整部作品的 Project / Scene / Shot / Run / Take |
| 闭源创作平台：统一画布和开箱即用的模型调用 | 自托管、BYO Workflow、BYO Compute，项目数据可迁移 |
| 文件夹与表格：保存大量素材和镜头状态 | 可视化来源连线、候选历史、选片状态和运行参数 |

TakeBoard 的画布表达影视语义，而不是底层推理节点：

```text
角色 / 场景 / 道具 / 参考图
              │
              ├── 首帧 / 尾帧 / 参考输入
              ▼
Project → Scene → Shot → Run → Take → Approved Take
                         │
                         └── ComfyUI Recipe / Workflow
```

## 当前可以做什么

- 在高级项目主页创建、打开、切换和重命名项目；
- 在项目资产库保存人物、场景、道具与图片素材；
- 在内容画布创建镜头和素材节点，拖拽连线作为首帧、尾帧或参考输入；
- 导入并检测 ComfyUI Workflow JSON，保留跳转到 ComfyUI 深度编辑的入口；
- 使用文生图、图生图、图生视频、首尾帧视频等 Recipe；
- 调整提示词、尺寸、帧率、时长、seed 等常用参数；
- 查看生成阶段与进度，取消任务并清理由本次运行创建的临时文件；
- 保存 Run、生成结果和候选 Take，批准或淘汰候选；
- 使用亮色、彩色和暗色主题；
- 将每个项目保存为独立的 `.takeboard` 目录，便于备份和迁移。

模型和 Custom Node 的可用性取决于连接的 ComfyUI 环境。TakeBoard 负责项目、参数映射、运行追踪与结果回收，不自动安装来源不明的模型或节点。

## 快速开始

### 环境要求

- Node.js `>= 22.12 < 27`
- pnpm `10.15.1`（可由 Corepack 管理）
- 可选：已能独立运行的 ComfyUI；不连接推理服务也可以浏览和测试项目管理界面

### 开发模式

```bash
git clone https://github.com/Fourques/Takeboard.git
cd Takeboard
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

打开 <http://127.0.0.1:48110>。开发模式下 Vite 会把 `/api` 请求代理到本地 `48120` 端口。

建议首次修改代码前运行完整检查：

```bash
pnpm verify
```

### 连接 ComfyUI

默认情况下，服务会连接 `http://127.0.0.1:8188`。需要覆盖地址或启用安全的运行临时文件清理时，可在启动 TakeBoard 前设置：

```bash
export COMFY_URL=http://127.0.0.1:8188
export COMFY_EDITOR_URL=http://127.0.0.1:48188
export COMFY_INPUT_ROOT=/path/to/ComfyUI/input
export COMFY_OUTPUT_ROOT=/path/to/ComfyUI/output
pnpm dev
```

`COMFY_URL` 是 TakeBoard 服务端访问的 API 地址；`COMFY_EDITOR_URL` 是浏览器打开 ComfyUI 编辑器时使用的地址。两者在远程部署时通常不同。完整配置和 SSH 隧道示例见[自托管指南](docs/self-hosting.md)。

## 构建与自托管

```bash
pnpm install --frozen-lockfile
pnpm verify
TAKEBOARD_WEB_ROOT="$PWD/apps/web/dist" node apps/server/dist/index.js
```

生产构建由 `pnpm verify` 中的 build 步骤生成，随后打开 <http://127.0.0.1:48120>。服务默认只监听回环地址；远程使用时推荐通过 SSH 隧道、可信内网或带身份认证的反向代理访问。

只构建而不运行全部检查时，可以使用：

```bash
pnpm build
```

## 项目数据

TakeBoard 当前采用单工作区、项目隔离的本地优先模式。每个项目都是可独立备份的目录：

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
    └── exports/
```

上传的原始素材、已登记的生成结果和数据库不会混入其他项目。迁移项目时应复制完整 `.takeboard` 目录，而不是只复制数据库。详见[数据与项目目录规范](docs/data-layout.md)。

## 技术架构

```text
React 19 + Vite + React Flow + Three.js
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

仓库使用 TypeScript monorepo：

- `apps/web`：项目主页、创作画布、资产库和运行交互；
- `apps/server`：本地 API、项目持久化、媒体管理和任务编排；
- `packages/contracts`：前后端共享契约；
- `packages/domain`：Project、Shot、Run、Take 等领域模型；
- `packages/executor-comfy`：Workflow 检测、参数注入和 ComfyUI 执行适配。

更完整的边界和设计理由见[技术架构](docs/architecture.md)。

## 路线图

- [x] 项目主页、主题系统与多项目管理
- [x] 内容画布、素材节点与语义连线
- [x] Workflow 检测、导入和常用参数映射
- [x] 真实 ComfyUI 任务、取消、结果回收与 Take 管理
- [ ] 稳定的 Recipe Contract 与社区 Recipe 示例
- [ ] 分镜墙、整片覆盖率和只读粗剪
- [ ] 多 Worker、远程算力与可解释的执行策略
- [ ] 完整项目导入导出、成本统计与跨镜头审批视图

任务拆分与验收标准见[开发路线图](docs/roadmap.md)。路线图表示方向，不构成版本交付承诺。

## 文档

| 文档 | 内容 |
| --- | --- |
| [开始开发](START-HERE.md) | 当前 Gate、推荐阅读顺序与下一步任务 |
| [创作工作站指南](docs/creator-workstation.md) | 画布、资产、Workflow 和生成操作 |
| [自托管指南](docs/self-hosting.md) | 环境变量、远程访问与生产启动 |
| [数据目录规范](docs/data-layout.md) | 项目隔离、备份和迁移 |
| [技术架构](docs/architecture.md) | 模块、数据边界和安全约束 |
| [MVP 产品需求](docs/mvp-prd.md) | 范围、用户流程与验收标准 |
| [开发路线图](docs/roadmap.md) | Gate 和 Issue-ready Backlog |
| [产品策略与立项论证](docs/product-strategy.md) | 市场判断、竞品差异、风险与商业化思路 |
| [决策记录](docs/decisions.md) | 已确认的产品和架构决策 |

## 参与项目

TakeBoard 仍处于快速迭代期。欢迎通过 Issue 提交真实制作流程、可复现问题、Workflow 兼容性反馈和 Recipe 建议。涉及模型或 Workflow 时，请同时说明 ComfyUI 版本、Custom Node 依赖和期望的输入输出；不要提交 API Key、私有素材或其他凭据。

## License

[Apache License 2.0](LICENSE)
