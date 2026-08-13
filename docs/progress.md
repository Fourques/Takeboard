# TakeBoard 执行进度

更新时间：2026-08-13
当前工作点：纵向 Demo 已完成；下一步补齐 `TB-006` Asset ingest，再进入真实 ComfyUI。

| 任务 | 状态 | 已验证结果 |
| --- | --- | --- |
| `TB-001` 范围与 ADR | 完成 | M0 黄金路径、非目标和 Gate 已冻结 |
| `TB-002` Monorepo 与质量门槛 | 完成 | Node 24/pnpm pin、Web/Server/Packages、CI、lint/typecheck/test/build |
| `TB-003` 领域契约 | 完成 | Zod + JSON Schema、UUIDv7、Run 状态机、Take/Approval 和跨对象一致性 |
| `TB-004` 项目存储 | 完成 | SQLite migration、revision/event log、原子开放快照、创建/修改/重开测试 |
| `TB-005` 最小画布 | Demo 完成 | Text/Entity/Asset/Shot/Take Stack、引用边、拖动保存、重开恢复 |
| `TB-006` Asset ingest | 未开始 | Demo 使用固定素材元数据，尚未实现用户文件导入/hash/缩略图 |
| `TB-007` Fake Executor | Demo 完成 | 4 独立 Run/Take、候选对比、淘汰、批准、撤销旧批准、刷新恢复 |

## 当前质量基线

- 契约测试：11 个；
- 领域规则测试：5 个；
- 服务端测试：6 个；
- Playwright 黄金路径：1 个，真实 Chromium 完整通过；
- `pnpm verify`：通过；
- `playwright test`：通过，覆盖重置、生成、淘汰、批准和刷新恢复。

## 下一纵向切片

实现 `TB-006` 的真实素材导入、SHA-256 去重和图片代理，然后实现 `TB-008`—`TB-010`：只连接一个
localhost ComfyUI、只支持一个经过验证的 API Workflow Recipe。Fake Executor 保留为 CI 和无 GPU Demo。
