# TakeBoard

<p align="right">简体中文 · <a href="README.en.md">English</a></p>

**把 AI 图片与视频创作，放进同一张画布。**

TakeBoard 是基于 ComfyUI 的开源 AI 创作画布。在同一工作区选择模型、连接素材、编写提示词，生成图片与视频，再用结果继续创作。桌面应用连接你自己的本机或远程 ComfyUI，让日常创作围绕画面展开。

[**下载测试版**](docs/downloads.md) · [交互演示](docs/demo-guide.md) · [开始使用](docs/first-session.md) · [官网](https://fourques.github.io/Takeboard/zh/)

[![CI](https://github.com/Fourques/Takeboard/actions/workflows/ci.yml/badge.svg)](https://github.com/Fourques/Takeboard/actions/workflows/ci.yml) [![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-315EFB.svg)](LICENSE)

![TakeBoard：参考素材、镜头与输入连线；模拟交互示例](docs/assets/takeboard-demo-cover.png)

*开发版界面，使用模拟结果。不是模型生成样片；[演示范围与来源](docs/demo-guide.md)。*

## 为什么使用 TakeBoard

把已经配置好的 ComfyUI 工作流，变成可以在画布中使用的创作工具。从单张图片到多个视频镜头，不必为每次尝试重新进入底层节点图。

- **一张画布，完成多步创作。** 放入参考图片或视频，创建生成节点，连接输入、调整提示词与参数、查看结果。保留不同尝试，也可以将生成结果连接到下一个节点继续创作。
- **按创作任务选择模型。** 文生图、图生图、文生视频、图生视频和参考生成，按可用工作流展示相应输入与参数。推荐模板按需添加，也能导入自己的工作流；需要深入调整时再进入 ComfyUI。
- **开源，使用自己的生成环境。** 在当前电脑或远程 GPU 上运行 ComfyUI，项目保存位置由你选择。本机项目可以连接远程生成服务，输出自动取回项目。源码开放，不依赖官方云端订阅。

适合希望用可视化画布完成图片与视频创作、同时保留 ComfyUI 工作流选择与控制能力的用户。已有 ComfyUI 环境可以直接开始配置；还没有环境，也可以先体验画布与素材操作。

## 开始使用

当前公开版本：[**v0.2.0-beta.18**](https://github.com/Fourques/Takeboard/releases/tag/v0.2.0-beta.18)。提供 macOS、Windows、Debian/Ubuntu 的 x64 / ARM64 安装包，包含应用运行时，不需要安装开发工具。

1. [下载并安装](docs/downloads.md)，新建项目，选择保存位置。
2. 在设置中连接已有的 ComfyUI，添加一个适合当前设备的工作流。
3. 新建镜头，选择生成类型和可用工作流，连接需要的素材，填写提示词并生成。
4. 查看结果与生成记录，保留满意的版本，或继续用它生成下一个结果。

本机使用无需注册。**安装包不包含 ComfyUI、模型或第三方节点**；没有生成环境时，也可以先试素材导入、画布和项目保存。当前 Mac 包未完成 Apple 公证，Windows 包未进行商业代码签名，首次打开方法见[安装说明](docs/downloads.md#安装与首次打开)。

## 工作流与使用条件

- **推荐模板按需添加。** 提供 Qwen Image、MiniMax H3、Wan 2.2、LTX 2.3 等适配配置，具体可用性取决于生成设备上的模型与节点。
- **可以导入自己的工作流。** 支持 Workflow JSON、API Prompt JSON，以及包含工作流元数据的 PNG。TakeBoard 会检查依赖与输入；自定义工作流可能需要确认参数映射和执行信任。不能转换的工作流可在 ComfyUI 中导出 API 格式后再导入。
- **当前为 Beta。** 不同工作流的输入能力与硬件要求不同；首次使用建议从一个兼容工作流开始。[工作流指南](docs/creator-workstation.md) · [兼容记录](docs/compatibility-matrix.md)。

beta.18 包含连接重试、取消恢复及依赖安全修复。更新内容见[版本记录](CHANGELOG.md)。

## 按需了解

| 想做什么 | 入口 |
| --- | --- |
| 完成第一次生成 | [首次使用](docs/first-session.md) · [工作流与创作指南](docs/creator-workstation.md) |
| 用笔记本连接 GPU 服务器 | [生成设备与项目位置](docs/generation-and-storage.md) |
| 调整项目目录、备份或更新 | [设置与更新](docs/settings-and-updates.md) · [数据目录](docs/data-layout.md) |
| 共享或自托管项目 | [账号与权限](docs/access-control.md) · [自托管部署](docs/self-hosting.md) |
| 使用可选工具或参与开发 | [扩展](docs/extensions.md) · [贡献指南](CONTRIBUTING.md) · [文档索引](docs/README.md) |

遇到问题可以从设置运行诊断，或直接[描述卡在哪一步](https://github.com/Fourques/Takeboard/issues/new?template=first_try.yml)。无需先判断是哪一层出了问题；公开反馈请去除私人素材与凭据。

代码使用 [Apache-2.0](LICENSE) 许可。模型与第三方节点遵循各自许可。TakeBoard 是独立项目，与 Comfy Org 无隶属关系。[安全报告](SECURITY.md) · [路线图](docs/roadmap.md)
