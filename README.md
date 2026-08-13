# TakeBoard

> 暂定名：正式公开前还需要做商标、域名和同名项目检索。

状态：M0 可用纵向切片；已部署至 RTX 4090，进入真实项目试用阶段。

> 准备开工请从 [START-HERE](START-HERE.md) 开始；具体范围、架构和任务以执行文档为准。本 README 保留完整立项论证。

> 真实工作站版本已完成首条纵向链路：新建/打开项目、角色与场景资产入库、ComfyUI Workflow 自动检测/导入、Wan 2.2 I2V 与首尾帧提交、运行轮询、视频回收和 Take 入库。部署方式见 [4090 部署与使用](docs/4090-deployment.md)，创作界面见 [创作工作站指南](docs/creator-workstation.md)；Fake Demo 仍保留为无 GPU 功能示例。

## 一句话定义

开源、自托管的 AI 影视创作画布：提供接近 TapNow、LibTV 的内容节点与来源连线体验，底层以 ComfyUI Workflow 为 Recipe，同时管理整部作品的资产、镜头、批量候选、批准版本、混合算力、真实成本和粗剪。

## 核心判断

ComfyUI 已经很好地解决“一个素材怎样生成”，TapNow、LibTV 等闭源平台则证明了“内容放在画布上、通过连接追溯来源”的交互价值。TakeBoard 要补的是二者之间的空位：用接近闭源平台的创作画布管理一部包含几十到几百镜的作品，但把模型、Workflow、算力、API Key 和项目数据交还给用户。

TakeBoard 不重新实现模型推理，也不把数千个底层节点铺到一张巨型画布，而是在 ComfyUI 上方增加语义化的项目图：

```text
作品 → 剧集 → 场景 → 镜头 → Run → Take → Approved Take → 粗剪
                  ↑          ↑
              角色/场景   Comfy Recipe
```

用户继续在 ComfyUI 中制作和调试底层 Workflow；TakeBoard 负责重复执行、批量抽取候选、选片、状态管理和整片视图。

## 第一用户

- 已经会使用 ComfyUI、手里有多个 Workflow JSON 的 AI 影视创作者；
- 同时使用本地 ComfyUI、远程 GPU 和若干云 API 的独立创作者；
- 2—10 人的小型 AI 短片、漫剧和广告团队；
- 愿意自托管、重视项目数据和工作流所有权的技术型创作者。

第一阶段不服务只想输入一句话直接成片的新手。该人群会被小云雀、LibTV 和 TapNow 更好地满足。

## 产品坐标与竞品层级

| 层级 | 产品 | 与 TakeBoard 的关系 |
| --- | --- | --- |
| 产品形态标杆/用户替代 | TapNow、LibTV、小云雀 | 重点学习画布、素材节点、来源连线、Agent 和长叙事体验；TakeBoard 用开放、自托管和混合执行形成替代 |
| 最直接开源竞品 | Toonflow | 同样是短剧无限画布和可编程供应商；目前视频路径仍明显依赖云 API，TakeBoard 应以 ComfyUI-native、本地视频与 Take/成本治理区分 |
| 邻近工作站 | Velorn、ComfyDirector、ArcReel | 覆盖项目、生成、素材或时间线，会争夺相同用户，但不等同于 TapNow 式自由创作画布 |
| 执行基础设施 | ComfyUI、Fabric | 提供 Workflow、模型和路由能力，是可复用底层，不是要复制的画布产品 |

因此需要分清两种“竞品”：TapNow/LibTV 决定 TakeBoard 应该长什么样、是否好用；Velorn/Fabric 决定哪些底层能力已经存在、不值得重复开发。

## 与现有项目的差异

### 相对 ComfyUI

- ComfyUI 图描述单次媒体生成；TakeBoard 图描述整部作品的生产状态；
- ComfyUI 保存 Workflow；TakeBoard 保存 Workflow 被谁、在哪一镜、用什么输入、运行多少次和选中哪条；
- ComfyUI History 是执行历史；TakeBoard Take 是有淘汰原因、评论和批准状态的生产候选。

### 相对 Toonflow

Toonflow 已有无限画布、ProductionAgent、项目管理和可编程供应商，因此“开源无限画布”不是差异。TakeBoard 必须坚持：

- ComfyUI Workflow 是一等公民，不重新包装所有模型参数；
- 有公开、稳定、可版本化的 Recipe Contract；
- 支持多个本地/远程 ComfyUI Worker；
- 围绕 Run、Take、Approved Take 和整片覆盖率设计；
- 项目包可完整导出，核心格式使用 ShotSpec；
- 不把 Agent 作为首版前提。

### 相对 ArcReel、LumenX、Jellyfish

这些项目提供阶段式的一站式生产工作台。TakeBoard 不追求内置最完整的剧本生成和模型供应商，而是成为已有 ComfyUI 生态的项目层：用户可以继续自由更换工作流、Custom Node、模型和算力。

### 相对 TapNow、LibTV、小云雀

- 保留它们最有价值的画布体验：素材、文字、角色、镜头、图片、视频都成为可移动内容节点，连线表达引用和生成来源；
- 本地优先、自托管、BYO Workflow 和 BYO Compute；
- 同一镜头可以在本地开源、远程自托管和 BYOK 闭源模型间有意识地升级，而不是被单一积分体系锁定；
- 项目数据、Recipe 和运行谱系不锁在平台内；
- 不从模型调用差价获利；
- 开放插件和项目交换格式。

TakeBoard 的画布不是 ComfyUI 节点图换皮。用户看到的是“剧本/角色/场景/镜头/候选/成片”，而不是 Checkpoint、Sampler、VAE 和 ControlNet。

### 相对 Velorn、ComfyDirector

Velorn 的交互中心是多轨时间线和视频工作站，ComfyDirector 更像模板化影视实验台；它们与 TakeBoard 共享 ComfyUI、项目素材和混合执行能力，但不是完全相同的产品形态。TakeBoard 首版应优先做好画布上的探索、分支、来源关系和多候选选择，不与 Velorn 竞争专业剪辑，也不与 ComfyDirector 竞争最多内置模板。

### 相对 Fabric

Fabric 是通用本地模型和路由基础设施，不是影视内容画布。TakeBoard 可以借鉴或集成其路由思想，但差异落在 Scene/Shot/Take/Approval 和用户可见的画布决策上。

## “开源模型 + 闭源模型”是不是差异

结论：**对积分制闭源平台是有价值的切口，但对整个市场不是独占差异。**

ComfyUI 本身已经能同时运行本地开放模型和付费 API 节点；Velorn 已公开主打把本地、云端和混合 ComfyUI Workflow 放进同一个项目；Fabric 已提供 `local-first`、`cheapest_qualified`、`fastest`、`best_quality` 等路由。因此，如果 TakeBoard 只增加一组模型连接器，很容易退化成另一个聚合器。它们说明执行能力不新，不代表“开放的 TapNow 式影视画布”已经被完整解决。

真正值得做的差异不是“支持两类模型”，而是把 **混合执行的生产经济学** 做成影视创作者看得懂、能控制的产品：

1. **用户自带一切**：BYO GPU、BYO Remote Worker、BYOK，平台不强制充值、不加价转售推理；
2. **按镜头而不是按模型决策**：每个 Shot 可以选择本地草稿、低价云端、最佳质量或隐私优先；
3. **显式升级路径**：先用开源模型批量试构图和运动，只把批准候选或困难镜头升级到付费模型；
4. **生成前预算控制**：显示本轮预计现金支出、预计 GPU 时间、并发和预算上限，超限必须再次确认；
5. **计算真实成本**：不只记录单次调用价格，还记录一个 Approved Take 经历的失败 Run、人工挑选和修补；
6. **保留可迁移性**：更换模型、供应商或 Worker 不改变 Shot/Take/Approval，项目不会因某个平台涨价或下线而失效。

推荐对外定位：

> 用你自己的模型、算力和 API Key 完成长片项目；本地先抽、好镜再升级；每一分钱和每一个被淘汰的 Take 都可追溯。

不要宣传“免费生成”。开放权重仍需要显存、硬件、电费、等待时间和运维；没有合适 GPU 的用户仍会支付云算力或 API 费用。更准确的承诺是：**没有强制平台积分和推理加价，用户可选择现金成本、时间成本、质量与隐私之间的交换。**

### 四种执行目标

| 模式 | 典型用户 | 现金成本 | TakeBoard 的作用 |
| --- | --- | --- | --- |
| Local Open | 自有合适 GPU 的个人/团队 | 边际现金低，但有硬件、电力和时间成本 | 能力检测、队列、GPU 时间和失败记录 |
| Remote Self-hosted | 有工作站、服务器或租用 GPU | 按机器时长付费 | Worker 调度、断点恢复、利用率和项目归档 |
| BYOK Closed API | 低显存用户或关键镜头 | 按模型调用付费 | 直连用户账户、预算上限、价格快照和结果回收 |
| Optional Managed | 不愿维护环境的团队 | 服务费 + 推理费 | 后期商业能力，不进入开源 v0.1 核心 |

### 用户可见的路由预设

- **Local Only**：禁止产生外部模型费用；能力不足时停止，不静默转云端；
- **Cheap Draft**：优先开放小模型或低价 Worker，适合分镜和运动试验；
- **Balanced**：本地批量生成，达到人工筛选节点后才允许调用付费模型；
- **Best Final**：只对选中的镜头使用高质量 Recipe；
- **Private**：输入资产和生成结果不得离开指定 Worker；
- **Budget Cap**：项目、场景、镜头和单批 Run 均可设现金上限。

首版路由必须是可解释的规则和用户确认，不做黑盒“AI 自动选模型”。

## 产品的两层图

### 创作画布层：TakeBoard

只显示影视语义和内容节点：剧本段落、文字说明、角色、场景、道具、参考素材、镜头、候选组、批准镜头、音频和粗剪。连线表示“引用了谁、由谁生成、被哪个镜头采用”，允许在画布上保留探索分支和废弃分支。

### 执行层：ComfyUI

保留采样器、LoRA、ControlNet、模型加载和处理节点。用户点击 Recipe 可以在 ComfyUI 中打开和修改原始 Workflow。

绝不在项目画布中展开每个 ComfyUI 底层节点。100 镜 × 50 节点会形成不可用的 5,000 节点画布。

## 三个同步视图

1. **创作画布**：像 TapNow 一样放置、组合和派生内容节点，查看角色/场景/镜头/候选之间的来源和依赖；
2. **分镜墙**：按故事顺序查看所有镜头的缩略图、状态、错误和覆盖率；
3. **粗剪视图**：只播放 Approved Take，检查节奏并替换镜头。

第一版以创作画布和候选选择器为核心，分镜墙承担整片秩序检查，粗剪只做预览。画布首版支持拖放、缩放、多选、节点派生、来源连线、分组和自动整理，但不先做通用白板协作工具。

## 核心数据模型

| 对象 | 作用 |
| --- | --- |
| Project / Episode / Scene | 组织作品层级和交付规格 |
| Entity / Asset | 角色、服装、场景、道具、音频和参考素材 |
| Shot | 镜头意图、时长、状态与依赖 |
| Recipe | 一个带明确输入输出契约的 ComfyUI Workflow |
| Worker | 本地、远程或云端 ComfyUI 执行端 |
| Execution Policy | Local Only、Cheap Draft、Best Final、Private 等显式执行约束 |
| Run | Recipe 的一次实际执行及完整参数、价格快照、估算置信度、成本和日志 |
| Take | Run 产生的候选媒体和人工评价 |
| Approval | 被选中的 Take、批准人、时间和原因 |
| Cut | 由 Approved Take 组成的预览时间线 |

ShotSpec 作为项目持久化和交换语义；数据库可以用于索引和 UI 性能，但不能成为唯一真相源。

## Recipe Contract

ComfyUI Workflow JSON 不能直接成为稳定 API，因为节点编号、Custom Node、模型和 Python 依赖会变化。每个 Recipe 应包含：

```yaml
recipe_version: 0.1
id: wan-i2v-v5
name: Wan Image to Video
workflow: workflow_api.json

inputs:
  prompt:
    node: "6"
    field: text
    type: string
  first_frame:
    node: "12"
    field: image
    type: image
  duration:
    node: "27"
    field: duration
    type: number

outputs:
  video:
    node: "42"
    type: video

requirements:
  comfyui: "pinned-version"
  custom_nodes: []
  models: []
  environment_snapshot: comfy-snapshot.json
```

第一版允许绑定 node ID；后续再探索命名节点、Subgraph 接口或稳定 slot ID。导入时必须进行能力和依赖预检。

## “抽卡”不是随机图库，而是 Take Management

每个镜头可以按预算生成 N 个候选：

```text
S017
├── Take A  rejected: face_drift
├── Take B  rejected: wrong_prop
├── Take C  approved
└── Take D  rejected: motion_direction
```

必须记录：Recipe 版本、输入资产、seed/参数、Worker、耗时、现金成本、GPU 时间、成本来源/置信度、淘汰原因和批准状态。下游节点默认只引用 Approved Take；重新抽卡不覆盖历史版本。

最关键的指标不是“单次生成多少钱”，而是：

```text
accepted_take_cost = 该镜头所有 Run 的现金成本 + 可选的本地算力估算
acceptance_rate    = Approved Take 数 / 生成 Take 数
finished_minute_cost = 已批准镜头总成本 / 已批准成片分钟
```

成本分为 `exact`、`estimated`、`unknown` 三档，不能用不可靠的估算伪装成精确账单。本地执行至少记录 GPU 型号、运行时长和峰值显存；电费和硬件折旧先作为用户可配置估算，不强行给出统一数字。

## 2 周技术验证

目标不是做完整画布产品，而是同时验证两件事：最小内容画布是否成立，ComfyUI 是否能稳定成为可插拔执行内核。

- 创建文字、角色、参考图、镜头和生成结果五类节点，支持拖放、分组、派生与来源连线；
- 从画布选择一个或多个来源节点生成新节点，并能沿连线回溯实际输入；
- 连接一个本地 ComfyUI；
- 导入 1 个已验证的图片或视频 Workflow，并编写 Recipe Manifest；
- 创建 1 个场景、10 个镜头；
- 每镜批量提交 4 个候选并显示实时状态；
- 对比候选、记录淘汰原因、批准一个 Take；
- 在 Shot 卡上显示 Approved Take；
- 保存并重新打开项目，完整恢复运行和选择历史。

远程 Worker、BYOK、预算和“Local Draft → Paid Final”放到紧随其后的两周 M1 差异化 Gate，避免首轮同时验证三种执行环境。

### 技术验证通过门槛

- 用户能只看画布理解“哪些素材生成了哪个候选、哪个候选进入哪个镜头”，不需要阅读 ComfyUI 图；
- 关闭重开后节点位置、分组、来源连线和废弃分支完整保留；
- 不进入 ComfyUI UI，也能对 1 个 Recipe 可靠注入输入并获取输出；
- 40 次任务中成功关联 Run/Take/输出的比例不低于 95%；
- Recipe 依赖缺失能在运行前提示，而不是任务结束后才失败；
- 更换 Workflow 版本不会破坏旧 Run 的可追溯性；
- 10 镜项目关闭重开后画布来源、Run/Take 和 Approved Take 不丢失；
- 5 名目标测试者中至少 4 名无需指导完成“选择来源→生成→批准”，至少 3 名愿意带自己的 Workflow 或镜头回来。

## v0.1 范围（技术验证通过后 6—8 周）

### 必须有

- Project/Scene/Shot/Asset；
- 内容画布：文本/素材/镜头/候选节点、来源连线、多选、拖放、分组、缩放和自动整理；
- ComfyUI Worker 连接与健康检查；
- Recipe 导入、输入绑定、版本和依赖预检；
- 批量 Run、队列、进度、重试和取消；
- Candidate Grid、淘汰标签和 Approved Take；
- 分镜墙、整片覆盖率和只读粗剪；
- 本地媒体存储与完整项目导入导出；
- ShotSpec sidecar 和基础成本记录；
- Local Only、Cheap Draft、Best Final、Private、Budget Cap 五个显式执行策略；
- 至少一个本地开放模型路径、一个远程 ComfyUI 路径和一个 BYOK 付费路径；
- Run 预估、价格快照与 approved-take cost 汇总。

### 明确不做

- 通用剧本 Agent；
- 模型商城和平台代理收费；
- 完整专业时间线编辑器；
- 任意多人实时协作；
- 完全自由的无限白板；
- 自动安装所有来源不明的 Custom Node；
- 原生支持所有云模型 API，v0.1 只做一个用于验证抽象的 BYOK Adapter；
- 移动端。

## 推荐架构

```text
Web UI
├── Storyboard Wall
├── Candidate Picker
├── Creative Canvas
└── Rough-cut Viewer
        ↓
Project Service
├── ShotSpec / SQLite
├── Asset Store
├── Recipe Registry
├── Run / Take / Approval
└── Queue / Events
        ↓
Executor Interface
├── Local ComfyUI
├── Remote ComfyUI
├── BYOK Provider Adapter
└── Future: Comfy Cloud / Managed Worker
```

建议使用 Web UI + 本地服务起步，后续再封装桌面端。前端画布可使用成熟图编辑库，但项目图数据必须独立于 UI 库。

M0 具体建议采用 TypeScript monorepo、React/Vite、React Flow、Fastify、SQLite/Drizzle、Zod 和 Playwright；理由、数据边界与安全约束见 [技术架构](docs/architecture.md)。

## 主要风险

| 风险 | 应对 |
| --- | --- |
| 与 Toonflow 产品重叠 | 不卖“无限画布”，只做 Comfy Recipe + Take/Approval + 整片项目图 |
| 与 Velorn 用户和技术栈重叠 | 将其视为邻近工作站而非同形产品；不与其比完整时间线，聚焦 TapNow 式创作画布、镜头分支、候选批准和预算治理 |
| Fabric 已有本地优先路由 | 不把通用模型路由当壁垒；将路由约束放到 Scene/Shot/Take 生产语义和人工审批中 |
| “免费”叙事误导用户 | 明确区分模型许可、软件价格、推理现金成本和自有算力成本 |
| 闭源 API 价格经常变化 | 保存价格来源和时间戳，运行前估算、运行后对账，无法确认时标为 unknown |
| Workflow/Custom Node 依赖地狱 | Recipe 锁版本、模型 hash、环境快照、运行前预检、Worker capability |
| 画布在 100 镜后不可用 | 场景分组、折叠、自动布局、过滤；以分镜墙为主要操作界面 |
| 媒体文件过大 | 内容寻址、代理文件、缩略图、外部存储目录；数据库不存二进制 |
| 为不同模型维护参数 | 首版只认 Recipe input/output contract，不理解模型私有参数 |
| 用户不愿维护 Recipe | 提供 3—5 个高质量官方示例和从 Workflow 自动生成绑定草案 |
| ComfyUI API/格式变化 | Executor 与项目模型解耦；契约版本化；集成测试固定 ComfyUI 版本 |
| 范围扩张为完整 TapNow | 用 v0.1 非目标和功能预算严格限制 |

## 成功指标

- 新用户在 15 分钟内连接已有 ComfyUI 并跑出第一个候选；
- 50% 以上测试用户导入自己的 Workflow，而不只是运行示例；
- 一个 30 镜项目至少完成 3 次跨日恢复；
- 用户对 60% 以上镜头使用多候选与 Approved Take；
- 至少 3 名用户将第二个项目带回；
- 社区贡献至少 5 个可复现 Recipe；
- 用户能量化减少的文件查找、重复生成或错误选片时间；
- 测试项目至少 30% 的付费 Final Run 来自本地 Draft 后的人工升级，而不是无差别调用付费模型；
- 与原有纯积分平台流程相比，用户能说明节省了多少现金，且质量没有因强制本地化明显下降。

## 停止或收缩条件

- 10 名 ComfyUI 影视用户中少于 3 人愿意用项目层管理真实作品；
- 大多数用户只想要 Workflow 启动器，不需要镜头和候选管理；
- 依赖预检无法把首轮任务成功率稳定提高到 90% 以上；
- 画布演示获得关注，但真实项目持续回到文件夹和表格；
- 维护 Custom Node 兼容占用超过一半开发时间；
- 与 Toonflow 的差异无法在 30 秒演示内让用户理解；
- 用户只在意“免费”，但既没有可用 GPU，也不愿承担云算力/API 成本；
- 10 名目标用户中少于 3 人会为镜头设置预算或查看 accepted-take cost；
- Toonflow 或其他开源项目已完整覆盖“自由画布 + ComfyUI 本地视频 + Take/成本治理”，而 TakeBoard 无法形成更清晰体验。

若发生这些情况，收缩为“ComfyUI Recipe Runner + Candidate Manager”，不继续开发大画布。

## 开源与商业化

建议开放项目格式、Recipe Contract、单机项目管理、基础 UI、ComfyUI Executor 和导入导出。潜在收费点：

- 托管控制台和项目备份；
- 多 Worker 调度、云 GPU 和队列；
- 团队权限、评论、审批和审计；
- 私有 Recipe Registry；
- 企业部署、支持和定制 Adapter；
- 高级 DramaGuard 质检。

不依赖模型调用差价作为主要商业模式，避免与模型聚合平台正面竞争。

## 与 ShotLab 其他立项的关系

- **ShotSpec**：TakeBoard 的开放项目模型和导出格式；
- **DramaGuard**：画布内的 preflight/QC 插件；
- **ShotArena**：评测 Recipe、Workflow、Worker 和 accepted-take 成本；
- **AnimaticForge**：合并为 TakeBoard 的粗剪视图，不再独立；
- **BlockBoard**：未来作为空间连续性节点或 Rule Pack 接入。

## 执行文档

- [开工入口与 Gate](START-HERE.md)
- [MVP 产品需求](docs/mvp-prd.md)
- [技术架构与数据边界](docs/architecture.md)
- [架构与产品决策记录](docs/decisions.md)
- [8 周路线与 Issue-ready Backlog](docs/roadmap.md)
- [竞品、访谈和可用性验证](docs/research-plan.md)
