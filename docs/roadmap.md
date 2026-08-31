# TakeBoard 实施路线与任务清单

更新时间：2026-08-30
计划：M0 已完成，当前进入 Public Preview 真实用户 Gate
估算单位：理想开发日，不包含等待外部测试者的日历时间。

> 本文前半保留最初 M0–M2 计划，便于审计项目是否按 Gate 推进。当前实现状态和正式版缺口以[成熟度评估](maturity-audit-2026-08-30.md)为准；未完成项不会因进入公开预览而自动视为完成。

## 1. 里程碑

| 里程碑 | 时间 | 唯一问题 | 可交付物 |
| --- | --- | --- | --- |
| M0 黄金路径 Gate | 第 1—2 周 | 画布 + 本地 ComfyUI 是否比文件夹清楚且可靠 | 10 镜/40 Run 可恢复 Demo |
| M1 差异化 Gate | 第 3—4 周 | 本地草稿、付费升级和预算治理是否真的有价值 | Local Draft → Paid Final Demo |
| M2 私测 Alpha | 第 5—8 周 | 陌生用户能否安装、带自己的 Workflow 完成项目 | v0.1.0-alpha + 5 名测试者 |

M0 未通过时不进入 M1；M1 未证明成本/混合执行价值时，仍可作为纯本地画布继续验证，但不宣传“智能路由”。

## 2. 开工前十天

### Day 1：范围与仓库

- 完成 `TB-001`、`TB-002`；
- 建 pnpm monorepo、Node LTS pin、lint/typecheck/test；
- 写一条黄金路径 Playwright 骨架，先标为 skipped；
- 产物：空应用、健康接口、CI 绿灯。

### Day 2：领域契约与项目存储

- 完成 `TB-003`、`TB-004`；
- Project/Scene/Asset/Shot/CanvasItem/CanvasEdge schema；
- SQLite migration 和开放 JSON 快照；
- 产物：创建、关闭、重开项目的自动测试。

### Day 3：最小画布

- 完成 `TB-005` 第一部分；
- Text/Media/Shot 三类节点，平移、缩放、多选、拖动；
- 位置在 drag stop 保存；
- 产物：50 个 fixture 节点可交互。

### Day 4：素材与来源

- 完成 `TB-005` 第二部分、`TB-006`；
- 文件拖入、hash、缩略图；reference 和 generated_from 边；
- 产物：导入图片并建立来源关系。

### Day 5：假生成闭环

- 完成 `TB-007`；
- Fake Executor 返回 4 个候选；Take Stack、对比、淘汰、批准；
- 运行第一条完整 E2E；
- 检查点：没有真实 GPU，也能演示产品逻辑。

### Day 6：Comfy Worker 与 Recipe

- 完成 `TB-008`、`TB-009`；
- 健康检查、`object_info`、API Workflow 导入和 slot 绑定；
- 产物：缺节点/缺输入时在入队前报错。

### Day 7：真实提交

- 完成 `TB-010` 前半；
- 上传输入、注入 Workflow、`POST /prompt`、保存 prompt_id；
- 产物：从 TakeBoard 触发一次真实生成。

### Day 8：进度、输出与断线

- 完成 `TB-010` 后半；
- WS 进度、History 对账、输出回收、hash；
- 产物：成功、失败、断线三种状态可重现。

### Day 9：真实候选与批准

- 完成 `TB-011`；
- 4 个真实 Run、候选对比、批准、来源回溯；
- 产物：完整黄金路径录屏候选。

### Day 10：可靠性与 Gate

- 完成 `TB-012`；
- 跑 40 Run、10 次恢复、300 节点画布；
- 邀请 2 名内部/熟悉用户先测；
- 写 Gate 报告：通过、收缩或停止。

如果某天任务延期，不通过删测试追进度。优先删除 Entity 美化、自动布局、视频内嵌播放等非闭环能力。

## 3. M0 Issue-ready Backlog

| ID | 任务 | 估算 | 依赖 | 验收 |
| --- | --- | ---: | --- | --- |
| TB-001 | 冻结 M0 范围和 ADR | 0.25d | 无 | README/PRD/Won't 清单一致，新增功能必须替换而非叠加 |
| TB-002 | pnpm monorepo、质量脚本和 CI | 0.5d | TB-001 | install、lint、typecheck、unit、build 一键通过 |
| TB-003 | 领域契约和 ID/时间规范 | 0.75d | TB-002 | Zod schema 覆盖 M0 对象并可生成 JSON Schema |
| TB-004 | SQLite migration、Project service、JSON 快照 | 0.75d | TB-003 | 创建/修改/重开不丢失；快照不含 Secret/绝对路径 |
| TB-005 | React Flow 画布和布局持久化 | 1d | TB-003/004 | 多选、拖放、缩放、删除投影、重开恢复 |
| TB-006 | M0 Asset ingest、hash、图片缩略图 | 0.5d | TB-004 | 重复文件去重；坏文件拒绝；原件不被 UI 修改 |
| TB-007 | Fake Executor、Take Stack、Approval | 0.75d | TB-003/005 | 4 候选独立状态；批准/撤销不覆盖历史 |
| TB-008 | Comfy Worker 健康与能力缓存 | 0.25d | TB-002 | 展示设备/版本；离线状态明确；只连 localhost |
| TB-009 | Recipe import、slot 绑定和预检 | 0.75d | TB-003/008 | 缺 node/field/class_type/required input 均被阻止 |
| TB-010 | Comfy Executor、WS、History、输出回收 | 1.25d | TB-008/009 | 成功/失败/断线可恢复；prompt_id 与 run_id 可对账 |
| TB-011 | 真实四候选黄金路径 | 0.75d | TB-005/007/010 | 来源→4 Run→Take Stack→Approval→Shot 全链路可见 |
| TB-012 | 可靠性、恢复、性能与 Gate 报告 | 0.75d | 全部 | 40 Run ≥95%；10/10 恢复；形成有证据的决策 |

总估算约 8 理想日，预留 2 日处理真实 Workflow、跨进程恢复和环境差异。视频代理、Entity 美化、自动布局和画布分组不属于 M0 完成条件；TB-010/011/012 不能用缓冲时间换掉。

## 4. M1：差异化 Gate

| ID | 任务 | 估算 | 验收 |
| --- | --- | ---: | --- |
| TB-101 | Executor 接口稳定化 | 1d | Local/Remote/BYOK 共享 submit/cancel/reconcile/capabilities |
| TB-102 | 一个远程 Comfy Worker | 1d | HTTPS/WSS 或 SSH tunnel，凭据不进项目包 |
| TB-103 | 一个 BYOK Adapter 或可计费 Fake Adapter | 2d | 价格估算、实际账单和错误可记录；不追求多供应商 |
| TB-104 | Execution Policy | 1d | Local Only 不静默转付费；Budget Cap 入队前阻止超额 |
| TB-105 | Draft → Final 升级交互 | 1d | 从一个本地 Take 发起付费 Final，来源链完整 |
| TB-106 | Cost ledger | 1d | exact/estimated/unknown；accepted-take cost 可解释 |
| TB-107 | 5 人任务测试 | 1d + 招募 | 至少 3 人认为成本/升级路径优于现有操作 |
| TB-108 | M1 Gate 报告 | 0.5d | 决定继续混合路线、只做本地画布或收缩 |

优先选择用户实际在用、文档和价格接口清楚的一家 BYOK 服务。不要为了“模型多”在 M1 同时做五个 Adapter。

截至 2026-08-31，TB-102、TB-104 与 TB-106 已完成产品闭环：远程 ComfyUI 支持 HTTPS / SSH tunnel，七种策略会保存候选与理由，Run 成本明确区分 exact / estimated / unknown；汇总台账和跨镜头原子审批作为默认关闭的扩展按需启用。TB-103 的真实 BYOK 账单 Adapter 和 TB-105 的 Draft → Final 专用升级动作仍未完成；因此当前 ComfyUI 成本主要是按 Worker 费率估算，不能宣传成云提供商账单。

扩展能力新增为 M1.5：声明式扩展库、权限预览、内容指纹、默认停用和项目质检已经完成。签名市场、沙箱代码插件、自动更新与撤销列表需要独立安全 Gate，不与 JSON 清单混为同一能力。

## 5. M2：私测 Alpha

### Week 5：多场景与整片视图

- Scene 分区和导航；
- Shot 状态/覆盖率；
- 分镜墙；
- 300 节点性能优化。

### Week 6：项目可移植性

- [x] 带完整性清单的完整项目导入/导出；
- 相对路径、媒体缺失修复；
- Recipe 打包和依赖报告；
- [x] schema migration 前备份和失败恢复。

### Week 7：粗剪与上手

- [x] 默认关闭、按需启用的 Approved Take 只读粗剪扩展；
- MP4 preview 或 OTIO 导出二选一，优先实现更简单且测试者需要的一个；
- 示例项目和 3 个示例 Recipe；
- [x] 错误说明和脱敏诊断包；
- [ ] 经过陌生用户验证、可跳过的任务式 onboarding。

### Week 8：私测与开源发布

- [ ] 5 名陌生创作者独立完成任务测试；
- 修复 P0/P1 问题；
- [x] 中英文 README 与架构说明；
- [ ] 60—90 秒真实流程演示；
- [x] 15 秒可复现产品交互演示及构建来源证明；
- [x] Apache-2.0、贡献指南、安全说明、路线图；
- [x] 发布 `v0.1.0` Public Preview，不承诺生产稳定。

## 6. 每周节奏

- 周一：锁定本周一个可演示结果；
- 周二—周四：纵向实现，功能、测试、文档一起进；
- 周五上午：真实 Workflow 回归；
- 周五下午：录 2 分钟内部演示、清理 Backlog、写决策记录。

任何一周最多一个主要新概念。不得同一周新增画布节点体系、Provider 抽象和 Agent。

## 7. Definition of Done

一个任务只有同时满足以下条件才完成：

- 有可操作的用户结果，不只是接口或组件；
- 类型、迁移和错误路径已定义；
- 至少有单元/集成/E2E 中一种自动测试；
- 不把 Secret 和绝对路径写入导出；
- 重启后状态正确；
- 文档或 ADR 已同步；
- 可在示例项目中演示。

## 8. 风险触发器

| 触发器 | 立即动作 |
| --- | --- |
| Recipe 导入平均需要手改代码 | 停止加新 Workflow，先做绑定向导或收缩官方 Recipe |
| Comfy 版本/Custom Node 兼容占用 >50% 时间 | 固定支持矩阵，不承担环境安装器 |
| 100 节点已明显卡顿 | 先做 Scene 分区和代理媒体，不加更多节点类型 |
| 测试用户只打开候选网格、不看画布 | 收缩为 Candidate Manager，画布降级为可选视图 |
| 用户愿用画布但不看成本 | 保留本地/开放价值，推迟成本路由卖点 |
| 用户只想一句话自动成片 | 不追随；该群体不是第一用户 |
