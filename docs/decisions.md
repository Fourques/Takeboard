# TakeBoard 架构与产品决策记录

更新时间：2026-08-13
规则：已接受的决定若要改变，新增一条决策并说明替代关系，不直接删除历史理由。

## ADR-001：画布是产品主界面

状态：M0 接受

TakeBoard 以内容节点、来源连线和派生结果作为主交互，分镜墙和粗剪是同步视图。它不是 ComfyUI 图的皮肤，也不是完整 NLE。

原因：闭源平台已验证内容画布的可理解性；TakeBoard 的机会是把该体验建立在开放 Workflow 和自有算力之上。

## ADR-002：M0 只接本地 ComfyUI

状态：M0 接受

两周 Gate 只验证一个本地 Worker 和一个可靠 Recipe。远程 Worker、BYOK 和预算进入 M1。

原因：否则无法判断问题来自画布、Recipe Contract、网络、鉴权还是 Provider 差异。

## ADR-003：React Flow 作为首版画布库

状态：M0 接受

使用 MIT 许可的 React Flow。画布数据通过自有 `CanvasItem/CanvasEdge` 投影进入组件，不保存 React Flow 私有对象为项目格式。

未选 tldraw：当前生产使用需要许可证 Key，核心 SDK 为 source-available。未选自研 Canvas：M0 成本过高。

## ADR-004：首版使用单一 TypeScript 栈

状态：M0 接受

Web 和本地服务都使用 TypeScript/Node LTS，并共享 Zod 契约。模型推理由外部 ComfyUI 承担。

后续只有在 DramaGuard 或媒体算法出现明确 Python 需求时，才添加独立 Python 包，不预先建设微服务。

## ADR-005：领域图与画布投影分离

状态：M0 接受

Shot、Run、Take、Approval、Asset 是领域对象；位置、尺寸、分组和折叠是画布投影。删除画布卡片不等于删除领域历史。

原因：保证更换画布库、增加分镜墙或 CLI 时不破坏项目数据。

## ADR-006：SQLite 事务 + 开放 JSON 快照

状态：M0 接受，M2 复核

SQLite 是运行时事务源；每次稳定领域事务后去抖写出版本化 JSON 快照。媒体保存为项目目录文件。

原因：纯 JSON 难以可靠处理队列和高频状态，只有 SQLite 又不利于迁移、审查和生态集成。

## ADR-007：Run/Take/Approval 历史追加而非覆盖

状态：接受

重新生成创建新 Run/Take；批准和撤销批准都作为事件记录。不能用 `final.mp4` 指针抹掉失败和决策历史。

## ADR-008：M0/M1 不做 Agent

状态：接受

首版使用“显式选中来源 → 选择 Recipe → 确认输入/数量 → 生成”。Agent 只有在这套确定性命令模型稳定后才能调用相同命令。

原因：Agent 不能替代尚未定义清楚的数据模型和权限/预算边界。

## ADR-009：本地安全默认

状态：接受

TakeBoard 默认监听 `127.0.0.1`，不自动暴露 ComfyUI，不自动安装 Custom Node，不把 Secret 写进项目。远程模式必须显式配置安全传输和鉴权。

## ADR-010：Apache-2.0 作为首选代码许可

状态：发布前待最终确认

理由：与 ComfyUI 生态和商业集成友好；核心开放有利于第一阶段获客。云托管、团队、私有 Registry 和企业支持可独立商业化。

发布前必须完成第三方依赖许可证清单。Toonflow 存在附加商业限制，只做行为研究，不复制源码。

## ADR-011：先以项目聚合行验证持久化，再按运行热点拆表

状态：M0 接受，`TB-007`—`TB-010` 复核

`TB-004` 在 SQLite 中保存一份通过 `ProjectSnapshot` 契约校验的项目聚合，另存 revision 和追加式
event log；事务提交后原子更新开放 JSON 快照。一个 `.takeboard` 目录只允许一个 Project。

原因：Day 2 首先要证明创建、修改、关闭重开和开放导出可靠，不应在命令边界尚未稳定时同时维护十余套
ORM 映射。Run/Take/Approval 在进入独立队列和恢复流程前必须拆为可独立事务更新的规范化表，不能长期
依赖整项目重写。该阶段性选择不改变 JSON 交换契约。
