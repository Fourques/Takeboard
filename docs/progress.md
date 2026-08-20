# TakeBoard 执行进度

更新时间：2026-08-20
当前工作点：真实本地生成闭环、图片 Recipe 与项目重开后的 Run 自动恢复均已完成；下一步是四候选批量、WebSocket 真实进度和整片分镜墙。

| 任务 | 状态 | 已验证结果 |
| --- | --- | --- |
| `TB-001` 范围与 ADR | 完成 | M0 黄金路径、非目标和 Gate 已冻结 |
| `TB-002` Monorepo 与质量门槛 | 完成 | Node 24/pnpm pin、Web/Server/Packages、CI、lint/typecheck/test/build |
| `TB-003` 领域契约 | 完成 | Zod + JSON Schema、UUIDv7、Run 状态机、Take/Approval 和跨对象一致性 |
| `TB-004` 项目存储 | 完成 | SQLite migration、真实 revision/event log、数据库与开放快照协同提交、创建/修改/重开测试 |
| `TB-005` 最小画布 | Demo 完成 | Text/Entity/Asset/Shot/Take Stack、引用边、拖动保存、重开恢复 |
| `TB-006` Asset ingest | 完成 | 文件导入、SHA-256、签名/MIME/尺寸/解码校验、512px JPEG 代理图 |
| `TB-007` Fake Executor | Demo 完成 | 4 独立 Run/Take、候选对比、淘汰、批准、撤销旧批准、刷新恢复 |
| `TB-008` Comfy Worker | 完成 | localhost 健康、设备/显存、Workflow 与模型检测 |
| `TB-009` Recipe 与预检 | 完成 | Contract 0.1、Wan/MiniMax/LTX 原生映射、object_info 入队预检 |
| `TB-010` 真实生成 | 完成 | 提交前落盘、异常补偿、重开恢复、幂等输出回收、可重试取消；Wan/MiniMax/Qwen 路径验证 |

## 当前质量基线

- 自动测试：57 个（契约、领域、Recipe、执行器、服务）；
- 领域规则测试：5 个；
- 服务端测试：27 个；
- Playwright 黄金路径：4 个，真实 Chromium 完整通过；
- `pnpm verify`：通过；
- `playwright test`：通过，覆盖重置、生成、淘汰、批准、真实项目与后台 Run 重开恢复。

## 下一纵向切片

先完成“一组四候选”批量提交、服务端无人值守对账和 WebSocket 真实进度，再建设分镜墙与整片覆盖率。Qwen
Image 2512 继续承担官方 T2I/I2I Recipe，Fake Executor 继续作为 CI 和无 GPU Demo。
