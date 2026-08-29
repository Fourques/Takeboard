# TakeBoard 执行进度

更新时间：2026-08-30
当前阶段：0.1.0 Public Preview 发布门禁

## 已完成纵向闭环

| 领域 | 状态 | 可验证结果 |
| --- | --- | --- |
| 项目与画布 | 完成 | 多项目、Scene/Shot/Asset/Text/Entity/Take Stack、位置与连线持久化、上下文检查器 |
| 素材 | 完成 | 原件保留、签名/MIME/尺寸检查、代理图、图片/视频/音频语义输入、资产库整理 |
| Workflow | Public Preview 完成 | 内置 Recipe、UI Workflow 诊断、Binding v1、内容哈希、依赖预检、可移植 Recipe 包 |
| 真实生成 | 完成 | 提交、真实/不确定进度、取消、断线对账、输出回收、Run/Take 来源、批量候选与重试 |
| 审核与整片 | 完成 | 候选比较、淘汰/批准、分镜墙、顺序调整、覆盖率、只读粗剪 |
| 数据安全 | 完成 | 项目目录隔离、回收区、完整性导入导出、迁移前备份/回滚、实例备份/恢复 |
| 账号权限 | 可信团队完成 | 账号、设备会话、恢复码、邀请、实例角色、项目 Owner/Editor/Viewer 与审计 |
| 运行维护 | 完成 | easy launcher、SSH helper、安全启动 ComfyUI、任务/存储中心、脱敏运行诊断 |
| 发布与协作 | 进行中 | 中英文 README、Issue/PR 模板、成熟度边界、GitHub Release 与首轮反馈招募 |

## 当前质量门禁

- Linux、macOS、Windows：锁文件安装、lint、typecheck、build、unit/integration tests；
- Linux production Chromium：账号、权限、主页、项目、素材、连线、Workflow、生成恢复、视频预览、分镜、删除、备份与诊断旅程；
- Release Gate：40 Run 恢复与 500 节点画布性能阈值；
- GPU Gate：独立脚本对已启动的私有实例执行真实生成，不能由 Fake Executor 替代；
- Bundle Gate：初始资源、最大异步 Chunk 与 CSS 均有硬阈值，超出即构建失败。

最新一次通过的准确测试数、性能值和 CI 链接应记录在 GitHub Release；本文不复制易漂移的统计数字。

## 发布后最近任务

1. 三平台净机验证并记录 easy launcher 的首次成功率；
2. 邀请 5 名陌生创作者各自带一个真实 Workflow 完成任务，不远程代操作；
3. 每周执行私有 GPU Gate，形成模型/ComfyUI/Custom Node/Workflow 哈希兼容矩阵；
4. 录制 60–90 秒不隐藏失败边界的真实演示；
5. 设计签名桌面安装、定时异地备份与存储生命周期 Gate。

更完整的上线判定见[成熟度评估](maturity-audit-2026-08-30.md)，历史任务分解见[路线图](roadmap.md)。
