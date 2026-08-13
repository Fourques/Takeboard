# TakeBoard 竞品与用户验证计划

更新时间：2026-08-13

## 1. 调研结论

TakeBoard 不是没有竞品，但竞品分属不同层：

| 层级 | 代表 | 已证明的能力 | TakeBoard 要验证的剩余空间 |
| --- | --- | --- | --- |
| 闭源画布标杆 | TapNow、LibTV、小云雀 | 内容节点、来源关系、Agent、素材库、长叙事和云模型体验 | 同等清晰的画布能否建立在自带 Workflow/算力之上 |
| 开源同形竞品 | Toonflow | 短剧无限画布、ProductionAgent、可编程供应商 | ComfyUI-native 本地视频、Take/Approval、成本治理是否更有吸引力 |
| 邻近工作站 | Velorn、ComfyDirector、ArcReel | 项目、生成、模板、素材、粗剪或真实时间线 | 用户更需要自由画布还是时间线/阶段式 UI |
| 执行基础设施 | ComfyUI、Fabric | 本地开放模型、API 节点、Workflow 和路由 | 影视项目语义、来源、候选与批准仍需上层产品 |

## 2. 从 TapNow 学什么

TapNow 官方文档体现了五个应进入 TakeBoard 验证的交互：

1. 上传、文字和生成结果都作为独立内容节点留在画布；
2. 新结果出现在来源旁边，来源不被覆盖；
3. 用户显式选择 Agent/生成要读取的节点，并说明每个参考的用途；
4. 高成本生成前确认输入、模型、数量和预计花费；
5. 视频可以捕获帧继续派生，多个批准视频可以组成 Playlist，而原视频不被改写。

M0 只实现前两项和“显式选择输入”；M1 实现花费确认；Playlist/粗剪进入 M2。Agent 不进入前三个里程碑的关键路径。

## 3. 从 Toonflow 学什么，以及不能做什么

Toonflow 当前公开说明包括无限画布、三级 Agent、可编程供应商、事件图谱和完整短剧流程；其前端使用 Vue Flow + Dagre，后端为 TypeScript/Express/SQLite。其演示仍使用 Seedance、GPT Image 和 Claude 等云服务，安装前提也列出视频/图像 API。

许可证风险：仓库虽然写“Apache-2.0”，同时附加了产品分发、标识和商业授权限制。该组合不应按标准 Apache-2.0 代码直接复用。TakeBoard 只研究公开行为和界面概念，使用 MIT/Apache 兼容依赖独立实现；不复制 Toonflow 源码、样式、文案和品牌资产。

## 4. 画布技术调研

| 方案 | 许可/限制 | 适配度 | 决策 |
| --- | --- | --- | --- |
| React Flow | MIT；节点、边、多选、缩放、分组和自定义节点成熟 | 高 | M0 首选 |
| Vue Flow | MIT；Toonflow 已验证可做类似产品 | 高 | 若开发者明显偏好 Vue 可替换 |
| tldraw SDK | 2026 年生产使用需要许可证 Key，SDK 为 source-available | 功能强但许可不匹配 | 不作为核心依赖 |
| 自研 Canvas/WebGL | 完全控制，但选择、命中、缩放、可访问性和编辑细节成本高 | M0 低 | 不做 |

React Flow 官方也提示大图持续力导向布局成本较高；TakeBoard 应按 Scene 分区，自动布局只在用户触发时运行。

## 5. ComfyUI 已确认接口与限制

可用接口：

- `GET /system_stats`：设备和显存；
- `GET /object_info`：节点能力与输入输出；
- `POST /upload/image`：输入素材；
- `POST /prompt`：验证并入队，返回 `prompt_id` 或 node errors；
- `WS /ws`：start、progress、executed、error；
- `GET /history/{prompt_id}`：断线恢复和输出对账；
- `GET /view`：读取输出；
- `/queue`、`/interrupt`：队列管理。

限制：

- API 接受的是 ComfyUI 的 API-format Workflow，不是普通 UI JSON；
- 客户端提交的是整个 Workflow 快照，提交后的 UI 修改不会影响该 Run；
- Custom Node 是任意 Python 代码，环境不能视为不可信沙箱；
- ComfyUI 默认威胁模型假设只有可信用户能访问 URL，裸露远程实例不是安全方案；
- Comfy Cloud API 仍标实验性，不能作为 M0 唯一底层。

## 6. 用户研究样本

先招 8—10 人，分为：

- 4 名本地 ComfyUI 叙事视频创作者；
- 2 名 TapNow/LibTV/小云雀重度画布用户；
- 2 名同时使用本地和付费 API 的混合用户；
- 可选 2 名 2—10 人团队中的制片/剪辑/技术美术。

不要以粉丝量筛选。至少一半参与者必须在过去 30 天做过 10 镜以上项目。

## 7. 问题访谈脚本

访谈 35—45 分钟，要求参与者展示最近一次真实项目，而不是评价概念图。

1. 从剧本到成片用了哪些工具？按实际顺序打开给我看。
2. 一个镜头通常生成几次？失败结果放在哪里？
3. 请找到一个两周前生成的镜头，并告诉我它用了什么参考和参数。
4. 哪一步最容易重复花钱或重复劳动？
5. 什么时候从画布转回文件夹、表格或剪辑软件？为什么？
6. 本地模型和云模型各用于什么镜头？切换依据是什么？
7. 如果项目要交给别人，对方最缺什么信息？
8. 最近一次人物/道具/镜头状态出错造成了多少返工？
9. 你是否批准一个“最终候选”，还是只靠重命名文件？
10. 今天如果只能消除一个麻烦，你选择哪一个？

不要问“你会不会使用 TakeBoard”。记录可观察事实：镜头数、Run 数、工具数、查找时间、费用、目录结构、交接方式。

## 8. M0 可用性任务

给参与者一个 6 镜示例项目和一个已配置 Worker：

1. 导入角色参考图；
2. 创建 Shot；
3. 选中参考和提示词，生成 4 个候选；
4. 淘汰 3 个并批准 1 个；
5. 找到批准候选的实际输入和 Workflow 版本；
6. 关闭并重开项目，确认状态；
7. 修改参考，再生成一组但不覆盖旧组。

记录：

- 任务成功率；
- 第一次生成耗时；
- 找来源耗时；
- 错点/回退次数；
- 是否理解 reference 与 generated_from 的区别；
- 是否主动使用画布，还是只停留在候选列表。

## 9. 竞品基准任务

用同一份素材分别在 TapNow、Toonflow 和 TakeBoard 完成：

```text
角色图 + 场景图 + 镜头描述
→ 生成 4 张关键帧
→ 选择 1 张
→ 生成 2 个视频
→ 找到最终视频的全部来源
```

比较：首次成功时间、点击数、来源清晰度、失败恢复、现金成本、是否可导出项目、是否能使用本地 Workflow。不要比较各平台模型画质；使用的底层模型不同会污染画布体验结论。

## 10. 通过标准

### 问题成立

- 至少 6/10 人真实依赖文件夹/命名管理候选；
- 至少 5/10 人无法在 2 分钟内恢复旧镜头完整来源；
- 至少 4/10 人每个重要镜头会生成 3 个以上候选。

### 方案成立

- 4/5 人无需指导完成 M0 黄金路径；
- 3/5 人愿意导入自己的 Workflow 做第二个任务；
- 3/5 人明确认为画布来源或 Take 批准比原有文件夹更好；
- 至少 2 人愿意持续一周用真实项目，而不是只试 Demo。

### 差异成立

- 3/5 个混合用户愿意先用本地 Draft、再升级少数 Final；
- 他们关心的是可控预算/可迁移性，而不仅是“免费”；
- TakeBoard 与 Toonflow 的差异能在 30 秒内被复述。

## 11. 资料来源

### 产品与竞品

- TapNow 画布：https://docs.tapnow.ai/en/docs/canvas/explore-the-canvas
- TapNow Agent：https://docs.tapnow.ai/en/docs/agent/tapnow-agent
- TapNow 图像生成与费用确认：https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-images
- TapNow 视频节点：https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-video
- TapNow Playlist：https://docs.tapnow.ai/en/docs/canvas/use-playlists
- LibTV：https://www.liblib.tv/wappro?sourceid=040004
- 小云雀：https://xyq.jianying.com/
- Toonflow App：https://github.com/HBAI-Ltd/Toonflow-app
- Toonflow Web：https://github.com/HBAI-Ltd/Toonflow-web
- Velorn：https://velorn.ai/
- ComfyDirector：https://www.comfydirector.com/

### 技术与许可

- ComfyUI routes：https://docs.comfy.org/development/comfyui-server/comms_routes
- ComfyUI messages：https://docs.comfy.org/development/comfyui-server/comms_messages
- ComfyUI security：https://github.com/Comfy-Org/ComfyUI/security
- React Flow：https://reactflow.dev/
- React Flow layout：https://reactflow.dev/learn/layouting/layouting
- tldraw license：https://tldraw.dev/sdk-features/license-key
- Node.js release status：https://nodejs.org/en/about/previous-releases
