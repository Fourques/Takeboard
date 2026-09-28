# 第一次使用 TakeBoard

目标：用约十分钟确认它是否适合你的项目组织方式。模型下载和生成等待时间不计入；这不是性能承诺。

## 先准备什么

从[下载页](downloads.md)选择安装包，准备一张不含隐私、可以用于测试的图片。先新建测试项目，不导入唯一一份重要数据。

安装包不包含 ComfyUI、模型或第三方节点；本机管理项目无需注册。当前是未公证 / 未商业签名的测试版，不要为打开应用全局关闭系统安全保护。

## 没有 ComfyUI 也能试

1. 安装并打开 TakeBoard，创建项目，确认保存位置。
2. 导入测试图片，检查完整画面、移动节点，打开资产库再返回画布。
3. 关闭并重新打开项目，确认素材、位置和名称还在。

这条路径只体验组织与保存，不会生成新图片或视频。

## 已有能正常运行的 ComfyUI

1. 先确认同一工作流在 ComfyUI 本身能够运行；避免同时排查两个系统。
2. 在设置中配置生成设备。项目位置与生成设备不同：连接远程生成服务不等于移动项目。
3. 选择可用工作流，连接它支持的输入，填写提示词。不要把“导入成功”当作“可生成”。
4. 用小尺寸、短时长做第一次测试；提交前检查最终宽高、时长和输入素材。
5. 检查任务状态、取回结果、查看生成参数，并确认结果保存在哪里。

远程输入会传到选定服务；只连接你信任的机器。不要把 ComfyUI 端口直接暴露到公网。

## 卡住后，发什么最有用

- 应用版本、操作系统、芯片 / GPU、连接方式。
- 做到哪一步，预期什么，实际出现什么；截图请遮住地址、路径和私人素材。
- 工作流是否能在 ComfyUI 独立运行；能提供公开来源链接最好。
- 可选：在哪里看到 TakeBoard。无需提供邮箱或真实姓名。

[使用交流](https://github.com/Fourques/Takeboard/discussions) · [问题反馈](https://github.com/Fourques/Takeboard/issues/new/choose)

不确定是不是 Bug？使用[第一次使用反馈](https://github.com/Fourques/Takeboard/issues/new?template=first_try.yml)，无需写技术诊断。

不要公开密钥、密码、未检查的日志或私人工作流；安全问题使用仓库的私密报告入口。

## English

Try a disposable project first. Download the installer from the [English guide](downloads.en.md), add a non-private image, move its node, inspect the asset library, then reopen the project and check that it was saved. Local project management needs no account or ComfyUI.

For generation, start with a workflow that already runs in your own ComfyUI. Configure the generation device, choose a usable workflow, connect supported inputs, and submit a small test. Inspect the output and its saved parameters. ComfyUI, models and Custom Nodes are not bundled; arbitrary imported JSON is not guaranteed to run. Remote execution transfers inputs to the selected service.

This is an unsigned/notarization-pending beta, not a hosted generation service. Never disable system protections globally or expose ComfyUI directly to the internet. Installer/runtime checks do not demonstrate every GPU/workflow combination.

Share your OS, app version, connection mode and the first step that failed in [Discussions](https://github.com/Fourques/Takeboard/discussions). Public workflow links help; private media, credentials and unredacted logs do not belong in public reports. The checklist is a suggested short trial, not a generation-speed claim.
