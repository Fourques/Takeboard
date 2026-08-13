# TakeBoard 技术架构

状态：M0 建议方案，Gate 后再冻结长期架构
更新时间：2026-08-13

## 1. 技术选型结论

| 层 | 选择 | 原因 |
| --- | --- | --- |
| 语言 | TypeScript，Node.js 24 LTS | 前后端共享契约；项目不执行模型推理，无需为首版引入 Python 服务 |
| Web | React + Vite | 生态成熟，适合复杂交互和后续桌面封装 |
| 画布 | React Flow (`@xyflow/react`) | MIT；内置拖放、缩放、多选、节点/边和分组；适合语义图而非通用手绘白板 |
| 本地 API | Fastify + WebSocket | 轻量、类型友好；REST 处理命令，WS 推送 Run 状态 |
| 校验/契约 | Zod + JSON Schema | 同一份类型用于 API、Recipe、项目快照和运行时校验 |
| 数据库 | SQLite + Drizzle | 单机、可迁移、事务可靠；不在 M0 引入 Redis/Postgres |
| 文件 | 项目目录 + 内容 hash | 媒体不进数据库；去重、代理和完整导出更容易 |
| 测试 | Vitest + Playwright | 单元、契约和黄金路径 E2E |
| 桌面 | M0/M1 不做；M2 后再评估 Electron | 先把浏览器 + localhost 服务跑通，避免打包问题掩盖产品问题 |

不选 tldraw：截至 2026-08，其 SDK 是 source-available，生产使用需要许可证 Key；这与 TakeBoard 希望核心画布可自由自托管和商业扩展的目标不一致。Vue Flow 也可行，但 React Flow 官方为 MIT 且示例与生态更丰富；除非主开发者已明显更熟悉 Vue，否则不切换。

## 2. 系统边界

```text
Browser UI
├── Canvas projection
├── Candidate compare
├── Run drawer
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

SQLite 是运行时事务源；`project.takeboard.json` 在领域事务成功后异步原子更新，并可从菜单强制刷新。M0 必须测试数据库与快照的 schema version。API Key、Cookie、Comfy 账户 Token、远程密码和绝对路径不得进入快照。

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

M0 预检：

1. Workflow 是 API format；
2. node/field 绑定存在；
3. `/object_info` 包含所需 `class_type`；
4. 每个 required input 都能从选中节点或表单解析；
5. 输出节点声明存在；
6. Workflow hash 与 Recipe version 保存到每个 Run。

不要在 M0 自动分析任意 Workflow 并猜全部业务输入。导入向导只生成建议，最终由用户确认绑定。

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
- 批量 4 候选是 4 个独立 Run，不是一个无法拆分的大 Run；
- 队列状态落 SQLite，进程重启后把 `queued/running` 标为 `reconciling`；
- 能在 History 找到 prompt_id 则恢复，否则标 `orphaned` 等用户重试；
- 不引入 Redis、Celery、Kafka 或分布式锁。

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
- M0 压测 300 节点/500 边，目标是常规操作无明显卡顿；
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
- 40 Run 恢复测试。

### E2E

Playwright 执行“新建→导入→生成→批准→关闭→重开”。CI 使用 Fake Worker；真实 GPU 测试按发布候选手动执行。

## 13. 技术债务预算

每周最多 20% 时间用于非黄金路径重构。出现以下情况立即暂停新增功能：

- 同一字段在前端、API、数据库出现三套不一致类型；
- Run 状态无法由日志和数据库解释；
- 画布删除会破坏历史来源；
- 需要针对每个 Workflow 写专用 UI；
- 为打包桌面端占用两天以上。
