# 看看 TakeBoard 如何组织一次创作

[画布截图](assets/takeboard-demo-cover.png) · [结果查看](assets/takeboard-demo-results.png) · [交互视频（WebM）](assets/takeboard-product-walkthrough.webm)

这段演示来自 2026-09-28 的开发分支，展示参考节点、镜头、模拟候选和采用结果。画面始终标注 **SIMULATED OUTPUTS · NO GPU**。候选是代码绘制的演示卡片，不是模型生成的视频；不能据此判断生成速度或画质。

beta.17 安装包仍保留发布时的代码，本轮开发分支修复了示例候选显示，不代表已重发安装包。

## 视频展示与没有展示什么

- 展示：打开示例项目、检查来源、触发模拟候选、比较与采用、回到画布。
- 不展示：真实模型加载与生成、任意自定义工作流兼容、真实素材导入或完整资产库、跨设备生成性能。
- 没有 ComfyUI 也能体验项目组织；要测试真实生成，请带一份能在自己的 ComfyUI 中运行的工作流。

进入[首次试用清单](first-session.md)，或直接提交[第一次使用反馈](https://github.com/Fourques/Takeboard/issues/new?template=first_try.yml)。

## 可复现录制

```bash
pnpm demo:capture
```

需要匹配当前 Node ABI 的原生依赖和已安装的 Playwright Chromium。切换 Node 主版本后，如 SQLite 提示 ABI 不匹配，请按本地开发环境重新安装或重建依赖，不是修改项目数据。

脚本使用独立临时数据目录、临时演示账号和回环端口，明确禁用真实 ComfyUI 连接。完成或失败后都关闭所属浏览器与服务并清理临时数据，不触碰用户项目。

产物位于 `test-results/demo/`：视频、画布截图、结果截图与来源清单。来源清单记录版本、完整提交、工作树状态、文件 SHA-256 和 `realGpu: false`。CI 模式拒绝脏工作树；发布公开素材前仍需人工检查画面、名称与完整视频。

这次没有修改全平台安装包，也没有把本地录制冒充 GitHub 构建来源证明。真实性清单见 [manifest](assets/takeboard-demo-manifest.json)。

## English

This is a recorded interaction demo from development main on 2026-09-28, not a GPU benchmark. It shows source inspection, four simulated candidates, adoption and a return to the canvas. The visible simulation label stays on-screen. The beta.17 installers have not been rebuilt for this documentation update.

ComfyUI, models and nodes are not bundled. Workflow compatibility varies. Start with the [first-session checklist](first-session.md#english), then report the first step that blocked you. The recording does not demonstrate real generation, real media import or the full asset library.
