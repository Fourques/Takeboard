# 画布 API 迁移

适用于当前源码的未发布重构版本。已发布安装包不会被本文自动升级。

## 一个写入入口

画布结构修改统一使用 `POST /api/projects/:key/commands`。规则、权限、项目锁、预览、版本校验、幂等和撤销由现有命令服务负责。媒体上传、项目生命周期、生成任务、审批仍是各自的服务接口，并非全部合并到画布命令。

下面 11 个旧写入口已删除独立实现，返回 **410 Gone**、`code: LEGACY_CANVAS_API_RETIRED`，以及 `replacement` / `preview` 地址。不自动转发、不修改项目，也不会替调用者确认影响。

以下旧路径均相对 `/api/projects/:key/`：

| 旧方法与路径 | 对应命令 |
| --- | --- |
| `POST shots` | `canvas.create_shot` |
| `DELETE shots/:shotId` | `shot.delete` |
| `POST text-nodes` | `canvas.create_text` |
| `POST canvas-connections` | `canvas.connect_items` |
| `DELETE canvas-connections` | `canvas.disconnect`，须提供真实 `edgeId` |
| `DELETE canvas-connections/:edgeId` | `canvas.disconnect` |
| `PATCH canvas-position` | `canvas.move_item` |
| `POST canvas-items` | `canvas.add_item` |
| `POST canvas-items/:itemId/duplicate` | `canvas.duplicate_item` |
| `PATCH canvas-items/:itemId` | `canvas.edit_item` |
| `DELETE canvas-items/:itemId` | `canvas.remove_item` |

不能只替换 URL：参数取自共享契约 `packages/contracts/src/command.ts`。例如，删除连线不再支持模糊端点猜测；复制镜头/笔记创建独立对象；移除画布节点不删除底层资产；彻底删除镜头使用独立的 `shot.delete` 并保留运行引用保护。命令执行成功返回 200，结果和更新后的 snapshot/revision 一并返回。

## 确认与冲突

1. 向 `commands/preview` 提交 `{ "command": ... }`，读取实际影响、`currentRevision`、`requiresConfirmation` 和令牌。
2. 如果需要确认，先把影响展示给用户；取消时不提交命令。
3. 执行请求包含 `command`、唯一 `requestId`、预览的 `expectedRevision`。只有用户已明确批准该预览时，才附带其 `confirmationToken`。
4. 如果版本冲突，刷新并重新预览。不得自动换新令牌、重放已过期的同意。
5. 明确重试同一次请求时复用原 `requestId`；新的操作使用新 ID。网络错误不能视为“肯定没有执行”。

认证、CSRF 和项目角色仍适用。410 不是匿名读取项目的通道。`shots/:shotId/generate` 等生成接口不在停用范围内。

## 兼容性证据

本地发布标签 `v0.1.0`、`v0.2.0-beta.1`、`beta.2`、`beta.3` 的 Web API 已使用命令服务。仓库内仍调用旧入口的是部分测试准备代码，本次已按原测试意图迁移；未获得外部脚本调用统计，因此明确提供停用响应和迁移表，不宣称所有第三方已经兼容。

回归覆盖全部 11 个停用入口不改变快照、版本或审计；同时保留新命令的确认校验、独立复制、原件完整性和运行引用保护。浏览器另验收替换输入的取消、确认及撤销。
