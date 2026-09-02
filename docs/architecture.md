# TakeBoard 技术架构

状态：持续演进的实现边界
更新时间：2026-08-31

## 1. 技术选型结论

| 层 | 选择 | 原因 |
| --- | --- | --- |
| 语言 | TypeScript，Node.js 22+ LTS | 前后端共享契约；项目不执行模型推理，无需为首版引入 Python 服务 |
| Web | React + Vite | 生态成熟，适合复杂交互和后续桌面封装 |
| 画布 | React Flow (`@xyflow/react`) | MIT；内置拖放、缩放、多选、节点/边和分组；适合语义图而非通用手绘白板 |
| 本地 API | Fastify + WebSocket | 轻量、类型友好；REST 处理命令，WS 推送 Run 状态 |
| 校验/契约 | Zod + JSON Schema | 同一份类型用于 API、Recipe、项目快照和运行时校验 |
| 数据库 | SQLite + Drizzle | 单机、可迁移、事务可靠；不在 M0 引入 Redis/Postgres |
| 文件 | 项目目录 + 内容 hash | 媒体不进数据库；去重、代理和完整导出更容易 |
| 测试 | Vitest + Playwright | 单元、契约和黄金路径 E2E |
| 桌面 | Tauri 2 薄壳 + 内置 Node sidecar | 复用 React/Fastify/SQLite 唯一业务实现，提供安装、单实例、进程归属和本机 WebView，不携带第二套 Chromium |

不选 tldraw：截至 2026-08，其 SDK 是 source-available，生产使用需要许可证 Key；这与 TakeBoard 希望核心画布可自由自托管和商业扩展的目标不一致。Vue Flow 也可行，但 React Flow 官方为 MIT 且示例与生态更丰富；除非主开发者已明显更熟悉 Vue，否则不切换。

## 2. 系统边界

```text
Browser UI
├── Canvas projection
├── Candidate compare
├── Run drawer
├── Cross-project operations center
└── Project/scene navigation
        │ REST commands + WebSocket events
        ▼
Local TakeBoard Server (127.0.0.1)
├── Project service
├── Asset service
├── Recipe registry
├── Run orchestrator
├── Approval service
└── SQLite + project files
        │ Executor contract
        ▼
ComfyUI Worker
├── /system_stats, /object_info
├── /upload/image
├── POST /prompt
├── /ws
└── /history/{prompt_id}, /view
```

浏览器不直接持有 ComfyUI、云模型或文件系统凭据。所有生成调用经过本地服务，才能统一记录 Run、预算和输出。

桌面版不复制任何业务规则。Tauri 只选择空闲回环端口、启动便携 launcher sidecar、等待真实健康检查并加载同一套 Web UI；项目仍写入 `~/TakeBoardData`。应用退出只终止自己拥有的 launcher，单实例插件阻止重复服务。浏览器、便携版和桌面版因此共享相同 API、迁移和权限边界。

跨项目任务中心只聚合当前账号可访问的项目。它通过项目级 Run API 获取实时进度和执行停止，因此不会建立一条绕过 Owner / Editor 权限的新控制通道。存储扫描忽略符号链接，普通成员只能看到自己可访问的项目；系统数据占用仅向实例管理员返回。

## 3. 推荐仓库结构

```text
takeboard/
├── apps/
│   ├── web/                    # React 画布与交互
│   └── server/                 # Fastify 本地服务
├── packages/
│   ├── contracts/              # Zod/JSON Schema、ID、事件
│   ├── domain/                 # Project/Shot/Run/Take/Approval 规则
│   ├── executor-comfy/         # ComfyUI Adapter
│   ├── recipe/                 # Manifest、注入、预检
│   └── test-fixtures/          # 假 Worker、样例 Workflow/媒体
├── examples/
│   ├── starter-project/
│   └── recipes/
├── docs/
├── scripts/
├── pnpm-workspace.yaml
└── package.json
```

`apps/web` 不能直接 import 数据库代码；`packages/domain` 不能依赖 React Flow。画布库只能存在于 UI/Projection 层。

## 4. 两套图必须分开

### 4.1 领域图

保存真实影视语义：

```text
Project → Scene → Shot
Entity/Asset → Run → Take → Approval → Shot
Recipe + Worker → Run
```

### 4.2 画布投影

只保存显示信息：

```ts
CanvasItem {
  id
  sceneId
  refType       // text | entity | asset | shot | take_stack
  refId
  x, y, width, height, zIndex
  parentGroupId?
  collapsed
}

CanvasEdge {
  id
  sourceItemId
  targetItemId
  relation       // reference | generated_from | approved_for
  runId?
  immutable
}
```

删除 CanvasItem 只是移出画布；如果 Asset/Take 已被 Run 或 Approval 引用，不得级联物理删除。

### 4.3 画布命令边界

浏览器的结构化画布写操作统一提交到 `POST /api/projects/:key/commands`，不直接拼装项目快照。共享契约定义在 `packages/contracts/src/command.ts`，服务端规则集中在 `apps/server/src/project-command-service.ts`。

```text
UI intent
  → POST /commands/preview       # 纯预览，不写项目
  → 用户确认影响范围
  → POST /commands              # requestId 幂等 + expectedRevision 冲突保护
  → SQLite snapshot + event_log + command_log 同一事务
  → GET /audit                  # 面向用户的操作记录
  → POST /commands/:id/undo     # 校验后应用逆操作
```

当前命令包括创建镜头/笔记、放置/复制/编辑节点、连接/断开输入、移动/移除节点、按连线整理场景、调整镜头播放顺序和删除镜头。镜头排序只重写同一场次内连续的 `order`，不移动画布节点，并保存可冲突检测的顺序逆操作。画布整理只写节点坐标，执行前给出影响预览，并用批量位置逆操作完整撤销。会替换、批量移动或移除内容的命令必须携带由同一项目版本预览得到的确认令牌。撤销不是不加判断地覆盖旧快照：若目标在原操作后已经编辑、连接、移动或被生成任务引用，服务端返回 `409` 并保留现状。

边界约束：

- 项目命令只修改 Project aggregate，不启动、停止或模拟 ComfyUI 任务；
- Run 的提交、进度、取消和输出回收仍由 generation routes / orchestrator 管理；
- React 选择状态、面板开关、缩放与临时表单只存在于 UI，不写入项目快照；
- `requestId` 防止网络重试重复执行，`expectedRevision` 防止基于旧画面覆盖新状态；
- `event_log` 用于领域调试，`command_log` 保存用户可读摘要、影响、逆操作和撤销状态，两者职责不同。

## 5. 最小数据库对象

实施顺序：`TB-004` 先用一个经过完整 Zod 校验的 project aggregate 行、revision 和 event log
跑通事务保存与重开；到 `TB-007`—`TB-010` 出现独立队列写入时，再把 Run/Take 等高频对象迁移为下表的
规范化记录。开放快照契约不随内部拆表改变。

| 表 | 关键字段 |
| --- | --- |
| projects/scenes | ID、标题、规格、schema version |
| text_items/entities/assets/shots | 内容、URI/hash、镜头意图与状态 |
| canvas_items/canvas_edges | 布局与可视关系 |
| recipes/recipe_versions | Manifest、Workflow hash、绑定和依赖 |
| workers | 类型、URL、能力、最后健康状态；不含明文 Secret |
| runs | prompt_id、状态、输入快照、参数、Workflow hash、错误、成本 |
| takes | run_id、asset_id、状态、淘汰原因 |
| approvals | shot_id、take_id、操作者、时间、原因、撤销事件 |
| event_log | 领域事件，用于调试和恢复，不承担通用 event sourcing |
| command_log | 用户修改命令、幂等键、影响预览、逆操作与撤销状态 |

所有 ID 使用 UUIDv7 或等价的可排序随机 ID。用户可读镜号如 `S017` 是 label，不是主键。

## 6. 项目目录与开放快照

```text
my-film.takeboard/
├── takeboard.db                 # 运行中的事务数据库
├── project.takeboard.json       # 去抖写出的开放快照
├── assets/
│   ├── originals/<sha256>.<ext>
│   └── proxies/<sha256>.<ext>
├── renders/<shot_id>/<run_id>/
├── recipes/<recipe_id>/<version>/
└── logs/
```

SQLite 是运行时事务源；每次保存会完整校验 Project Snapshot，并在同一保存边界内更新 SQLite revision、事件/命令日志和可移植的 `project.takeboard.json`。任一数据库写入或快照原子发布失败都会回滚并按 SQLite 当前值协调开放快照。API Key、Cookie、Comfy 账户 Token、远程密码和绝对路径不得进入快照。

## 7. Recipe Contract

Recipe 是 Workflow API JSON 加一个稳定外壳：

```yaml
recipe_version: 0.1
id: wan-i2v
version: 1.0.0
workflow_sha256: "..."
workflow: workflow_api.json

inputs:
  prompt: { node: "6", field: text, type: text, required: true }
  first_frame: { node: "12", field: image, type: image, required: true }
  seed: { node: "21", field: seed, type: integer, strategy: random_each_run }

outputs:
  video: { node: "42", type: video, required: true }

requirements:
  node_classes: [LoadImage, CLIPTextEncode, SaveVideo]
  models: []
```

执行预检：

1. Workflow 是 API Format，或可确定性转换的 UI Workflow；普通节点和多层子图展开为 API Prompt，注释与 Reroute 不进入执行图；
2. node/field 绑定存在；
3. `/object_info` 包含所需 `class_type`；
4. 每个 required input 都能从选中节点或表单解析；
5. 输出节点声明存在；
6. Workflow hash 与 Recipe version 保存到每个 Run。

不要把自动识别结果直接当作执行权限。导入向导只生成候选绑定，最终由用户确认能力、输出类型、每个 node/field 映射以及对第三方节点的信任。绑定记录 Workflow 内容哈希；任何节点图修改都会使旧绑定失效。

普通 JSON 导入成功后不会自动写入镜头。服务端会立即尝试把真实 Workflow 转换为 API Prompt、读取当前 ComfyUI 节点定义并返回候选映射；前端直接进入确认向导。视频长度候选同时识别秒数与帧数输入。帧数只允许使用内置的 `秒 × FPS`、`+1` 或 `-1` 换算，不接受任意表达式，换算规则随 Binding 一起参与哈希绑定与导出。

用户导入的 Workflow 不做不可恢复删除。归档前服务端扫描使用中的项目与回收区项目中的镜头绑定和 Run 参数；存在引用时返回结构化引用列表并阻止移动。无引用且确认令牌仍匹配时，文件移动到 ComfyUI 用户目录的 `TakeBoard/.archive/`，恢复时回到原路径，绑定文件保持不变。

`GET /api/workflows/inspect?path=...` 返回结构化 `WorkflowDiagnostic`，而不是让 UI 解析自然语言。每个检查项包含稳定 `id` / `code`、类别、`pass | warning | blocked | unknown` 状态、关联节点、说明和修复建议。总体结果明确给出：

- Workflow 内容哈希、能力、输出媒体类型和可执行节点数；
- 文档转换、节点类型、必需输入、模型、参数绑定和输出节点六类检查；
- `missingNodeTypes`、`missingModels`、`bindingStatus`、`health` 与 `executable`；
- UI 可展示详细检查，自动化客户端也能依赖稳定 code 做决策，不需要匹配中文提示。

生成分辨率由 `packages/contracts/src/generation.ts` 统一解析。Web 在提交前展示请求尺寸与执行尺寸的差异，原生执行器和服务端记录使用同一策略，避免 UI 预览、Prompt 与 Run 快照产生三套数值。

## 8. ComfyUI 执行状态机

```text
draft
  → validating
  → uploading_inputs
  → queued
  → running
  → collecting_outputs
  → completed

任一步 → failed / cancelled / orphaned
```

执行顺序：

1. `GET /system_stats` 健康与设备信息；
2. `GET /object_info` 缓存能力并预检；
3. `POST /upload/image` 上传必要输入；
4. 深拷贝 Workflow，注入绑定值；
5. 先持久化 Run，再 `POST /prompt`；
6. 保存返回的 `prompt_id`；
7. 订阅 `/ws` 的 start/progress/executed/error；
8. 断线时通过 `/history/{prompt_id}` 对账；
9. 下载/复制输出到 TakeBoard 项目目录并计算 hash；
10. 创建 Asset 和 Take，提交完成事件。

TakeBoard 自己的 `run_id` 与 ComfyUI `prompt_id` 分离。提交失败时仍保留本地 Run 记录和错误。

## 9. 本地队列与并发

- M0 每个 Worker 默认并发 1；
- 一批可选择 1–4 个候选；每个候选都是独立 Run，并记录 `candidateBatchId`、批内序号、总数和独立 Seed，不是一个无法拆分的大 Run；
- 批内提交与状态同步使用失败隔离：部分候选失败不会回滚已排队任务，停止会逐个取消；失败、取消或失联成员可以按原 Run 的输入和参数快照单独重试，并通过 `retryOfRunId` 保留谱系；
- 队列状态落 SQLite，进程重启后把 `queued/running` 标为 `reconciling`；
- 能在 History 找到 prompt_id 则恢复，否则标 `orphaned` 等用户重试；
- 不引入 Redis、Celery、Kafka 或分布式锁。

项目协作使用单调递增的 SQLite revision 做乐观并发控制。浏览器以 ETag 条件请求检查变化；空闲时自动应用，存在未提交编辑草稿时只提示新版本。已知 revision 会随所有项目写请求发送，服务端在项目互斥锁内比较版本并用 `REVISION_CONFLICT` 阻止旧快照覆盖；客户端随后读取最新快照，让用户确认后重做操作。它解决同一可信实例内的多设备并发，不声称提供离线合并或 CRDT。

### 9.1 多 Worker 与可解释调度

Worker 身份由 TakeBoard ID 固定，不用 URL 或显示名称充当主键。全局注册表保存在数据根目录的 `.system/workers.json`，权限为 `0600`，不进入任何项目包。支持三条默认安全路径：

- 本机回环 `loopback`；
- 通过普通 SSH 建立、在 TakeBoard 服务器看来仍是回环地址的 `ssh_tunnel`；
- 由使用者维护证书和访问控制的远程 `https`。

远程明文 HTTP 只为显式开启的旧部署保留，不能接收敏感素材。URL 不接受用户名、密码、query 或 fragment。新增远程节点默认 `allowSensitiveInputs=false`；管理员需要在 UI 中二次确认。移除不是立即遗忘身份，而是把节点退役：它不再出现在执行池或获得新 Run，但在途 Run 仍可用原 ID、端点和 Prompt ID 完成取消、History 对账与结果回收，避免错误回退到另一台机器。ComfyUI 标准接口没有跨实现一致的输入文件删除端点，因此远程 Worker 必须使用隔离输入目录和独立保留策略；TakeBoard 不会把“本地清理成功”误报成“远程素材已删除”。

调度输入包括策略、素材敏感性、单次预算、币种和预计时长。`local_only`、`private` 与 `budget_cap` 是资格过滤，不是排序建议；不满足时任务直接阻断，绝不静默换到远程或超预算节点。`balanced`、`fastest`、`economical`、`best_quality` 再根据队列、延迟、费率、质量档和管理员优先级排序。Run 同时保存所有候选的资格、得分、预计成本和排除理由，因此页面刷新、项目导出和事后审计都能回答“为什么用了这台机器”。

### 9.2 成本与跨镜头批准

每个 Run 有 `estimatedCost` 和 `actualCost` 两个独立记录，并包含金额、币种、精度、来源、计算秒数、小时费率和记录时间：

- `exact`：来自提供商账单或明确人工对账；
- `estimated`：当前主要由 Worker 小时费率 × 实际墙钟时长得出；
- `unknown`：没有可靠价格，不把它伪装成 0。

Run 级成本与执行来源属于不可丢失的核心溯源数据；汇总工作台属于可选的 `production.cost_insights` 扩展。汇总按币种分组。存在未知 Run 时，已知金额只称为下界，成片分钟成本也保持未知；不同币种绝不自动相加。当前自托管 ComfyUI 只产生估算或未知值，未来 BYOK Adapter 才能写入提供商报告的精确账单。扩展关闭时不请求汇总接口，服务端也以 `EXTENSION_DISABLED` 拒绝直接调用，但不会删除已有 Run 数据。

单镜头采用仍是核心能力；跨镜头批准由可选的 `production.batch_approval` 扩展提供，并采用 preview/apply 两阶段。预览检查 Take 是否属于相应 Shot、媒体是否可用、会替换哪个已采用候选，并返回绑定当前 revision 与规范化决策集合的确认令牌。应用时在项目锁内重新校验 revision、令牌和完整批次；全部通过后只进行一次 ProjectStore 事务保存。任何一项失效都会保留原状，不会出现半批批准。

### 9.3 扩展运行时

扩展注册表属于实例级系统状态，不进入项目包。`declarative-v1` 只解释经过 Zod 校验的 JSON 数据，当前贡献点为受控工作区功能、结构化项目质检和 HTTP(S) 外部工具入口。粗剪、成本、批量审片和成片质检作为内置清单随软件分发但默认关闭；启用状态持久化。外部清单必须经过内容哈希预览和管理员确认，安装后同样默认停用。

本版不加载扩展脚本、不动态 import 包、不运行子进程，也不自动安装 ComfyUI Custom Node。未来若增加可执行插件，必须使用单独的版本化协议、签名来源、最小权限、隔离进程、资源限额、可撤销授权与审计日志，不能扩大 `declarative-v1` 的隐含权限。完整设计见[扩展开发与信任模型](extensions.md)。

## 10. 安全基线

- TakeBoard 和本地 ComfyUI 默认只监听 `127.0.0.1`；
- 远程 ComfyUI 不允许把裸露 HTTP URL 作为推荐配置，M1 使用 HTTPS/WSS、SSH tunnel 或有鉴权的反向代理；
- Custom Node 是任意 Python 代码，TakeBoard 不自动安装，只报告缺失项；
- Secret 放操作系统 Keychain；M0 尚未接 Key 时先使用进程环境变量，不写数据库导出；
- 上传文件校验 MIME、扩展名、大小和解码结果；所有路径经项目根目录约束，防止路径穿越；
- SVG 默认不以内联 HTML 方式渲染；
- Recipe 只能修改 Manifest 暴露的 slot，前端不能提交任意 JSON Patch；
- 日志统一脱敏 Authorization、Cookie、API Key 和 URL query secret。

ComfyUI 官方威胁模型默认任何能访问其 URL 的人都是可信用户，远程暴露需要自行加防火墙、反向代理和认证。因此 TakeBoard 不能把一个裸 `--listen` Worker 包装成“安全远程模式”。

## 11. 性能基线

- 画布按 Scene 分区，不在一个 DOM 图中展示整季所有镜头；
- 图片使用代理缩略图，视频只显示 poster，选中后才加载播放器；
- 拖动期间只更新内存，结束后批量保存位置；
- 自动布局由用户触发，不在每次 render 后持续运行；
- 发布门槛使用 500 节点真实 React Flow 画板，要求打开时间低于 8 秒、连续 60 帧采样的 p95 低于 100ms，且画布仍可点击；
- React 节点组件 memo 化，回调稳定，运行进度只更新相关 Take Stack。

## 12. 测试金字塔

### 单元/契约

- Recipe slot 注入不修改原 Workflow；
- 项目快照迁移与 Secret 排除；
- Run 状态机拒绝非法跳转；
- Approval 只能引用同 Shot 可用 Take；
- 路径和 hash 规则。

### Adapter 集成

- Fake Comfy Server 覆盖成功、验证失败、WS 断线、执行失败、输出缺失；
- 固定 ComfyUI 版本的真实 smoke test；
- 40 Run 服务重启恢复测试，要求 40/40 Run 完成且 Take、视频 Asset 与原 Run 正确关联；
- MiniMax H3 真实 GPU Gate 经 TakeBoard API 完成项目、镜头、生成、进度、回收和媒体 Range 读取。

### E2E

Playwright 执行“新建→导入→生成→批准→关闭→重开”。CI 使用 Fake Worker；真实 GPU 测试按发布候选手动执行。

## 13. 技术债务预算

每周最多 20% 时间用于非黄金路径重构。出现以下情况立即暂停新增功能：

- 同一字段在前端、API、数据库出现三套不一致类型；
- Run 状态无法由日志和数据库解释；
- 画布删除会破坏历史来源；
- 需要针对每个 Workflow 写专用 UI；
- 为打包桌面端占用两天以上。
