# 发布门槛

TakeBoard 的发布判断不使用“页面能打开”代替可靠性证据。候选版本至少通过以下三层门槛。

## 自动门槛

```bash
pnpm gate:release
```

该命令包含 lint、类型检查、生产构建、包体预算、全部单元/集成测试和 Playwright 浏览器旅程。其中：

- `release-gates.test.ts` 提交 40 个独立 Run，关闭并重建服务，再逐个从 ComfyUI History 对账；必须 40/40 完成，40 个 Take 和 40 个视频 Asset 必须与原 Run 一一对应。
- `large-canvas.spec.ts` 创建并实际渲染 500 个画布节点；打开时间必须低于 8 秒，60 帧采样 p95 必须低于 100ms，交互仍然有效。
- `project-sync.spec.ts` 使用两个浏览器上下文制造真实旧 revision 写入；服务端必须阻止覆盖，第二页面恢复最新状态，随后继续自动同步。

阈值故意保留 CI 波动空间；它们是阻止明显回退的底线，不是对所有电脑的帧率承诺。

## 真实 GPU 门槛

先启动 TakeBoard 与 ComfyUI，再使用专门的本地 Gate 账号运行：

```bash
TAKEBOARD_GATE_EMAIL='gate@example.com' \
TAKEBOARD_GATE_PASSWORD='本次使用的密码' \
pnpm gate:gpu
```

可用 `TAKEBOARD_GATE_URL`、`TAKEBOARD_GATE_WORKFLOW`、`TAKEBOARD_GATE_TIMEOUT_MINUTES` 覆盖入口、工作流和超时。脚本不会把密码写入报告。它会真实执行：

1. 验证 TakeBoard、ComfyUI、Workflow、模型与原生/可信 Binding；
2. 创建隔离 Gate 项目和镜头；
3. 提交 MiniMax H3 T2V，读取真实进度直至终态；
4. 验证 Run、Take、视频 Asset，并对项目媒体执行 Range 读取；
5. 输出不含凭据的 JSON 证据到 `test-results/release-gates/`；
6. 默认把 Gate 项目移入回收区；设置 `TAKEBOARD_GATE_KEEP=1` 可保留项目供人工观看。

`TAKEBOARD_GATE_AUTH=off` 仅供像 CI/临时数据目录这样的隔离回环实例使用，不应在正式实例绕过账号系统。

## 2026-08-30 基线

本次升级已在隔离数据目录真实通过：

| 门槛 | 结果 |
| --- | --- |
| 40 Run 重启恢复 | 40/40 completed，40/40 Take 与视频 Asset 正确关联 |
| 500 节点画布 | Chrome 实际渲染 500 节点并保持点击响应，满足 8s / 100ms p95 阈值 |
| 真实 GPU | ComfyUI 0.31.0，RTX 4090，MiniMax H3 T2V native，100 秒完成并回收 `video/mp4` |
| Workflow 内容哈希 | `4935b6999ca3088e511e5796137f2b8088e8e1c4d7b842c82f76d4d2df1d4cd7` |

真实 GPU 报告是单次环境证据，不等于不同驱动、模型或 Custom Node 组合都已认证；更换运行环境或 Workflow 内容哈希后应重跑。
