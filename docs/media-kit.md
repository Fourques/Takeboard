# TakeBoard · 媒体素材包

更新：2026-09-30。由项目维护者提供。

[项目源码](https://github.com/Fourques/Takeboard) · [中文下载](downloads.md) · [English downloads](downloads.en.md) · [开始创作](first-session.md)

## 核心介绍

**TakeBoard：基于 ComfyUI 的开源 AI 创作画布。**

**把 AI 图片与视频创作，放进同一张画布。**

TakeBoard 将模型选择、素材连接、提示词和图片 / 视频生成整合到统一的可视化工作区。生成一张图片，接着用它制作视频；保留几个版本，再往不同方向尝试。底层使用自己的本机或远程 ComfyUI，推荐模板按需添加，也能导入自己的工作流。

当前提供 Mac、Windows、Debian/Ubuntu 桌面 Beta。本机使用无需注册；ComfyUI、模型与节点需另行准备。

## English introduction

**TakeBoard: an open-source AI creation canvas built on ComfyUI.**

**One canvas for AI image and video creation.**

Choose models, connect media, write prompts and generate in one visual workspace. Make an image and use it in a video, or explore several directions side by side. TakeBoard runs workflows through your own local or remote ComfyUI. Add recommended templates or import your own workflows.

Desktop beta for macOS, Windows and Debian/Ubuntu. Local use needs no account. ComfyUI, models and custom nodes are separate prerequisites. The app interface is currently primarily Chinese; the website and getting-started materials are available in English.

## 三个值得展示的场景

| 场景 | 演示主线 |
| --- | --- |
| 从图片到视频 | 选择图片生成工作流 → 生成并选择结果 → 接入兼容的视频工作流 → 查看视频 |
| 带参考素材创作 | 导入图片或视频 → 连接支持的输入 → 写提示词 → 生成并比较不同方向 |
| 笔记本连接 GPU 服务器 | 桌面创作画布 → 已配置的远程生成设备 → 提交生成 → 结果回到当前项目 |

这些是产品使用场景，不是已录制案例；每一步需要使用相应的兼容工作流。素材管理、参数记录与任务中心是支撑能力，不作为产品主标题。公开介绍不使用其他产品名称来定义 TakeBoard。

## 现有截图与视频

| 素材 | 内容 |
| --- | --- |
| [创作画布](assets/takeboard-demo-cover.png) | 参考素材、镜头和输入连线 |
| [结果界面](assets/takeboard-demo-results.png) | 示例批次的结果比较 |
| [11.44 秒交互视频](assets/takeboard-product-walkthrough.webm) | 查看输入、比较模拟结果、返回画布 |
| [图标 SVG](../apps/web/public/takeboard-icon.svg) | 项目标识 |

图注：**TakeBoard 开发版交互演示，使用模拟结果，非模型输出。**

Caption: **TakeBoard development-build interaction demo with simulated results, not model output.**

引用时保留 **SIMULATED OUTPUTS · NO GPU** 标记并链接项目。来源与校验值见[素材清单](assets/takeboard-demo-manifest.json)，录制范围见[演示说明](demo-guide.md)。允许在介绍、教程与评测中引用以上项目素材；第三方或用户素材不在此授权内。代码许可见 [LICENSE](../LICENSE)。

## 可直接使用的短帖

中文：

> 正在做 TakeBoard：基于 ComfyUI 的开源 AI 创作画布。选择模型、连接素材、生成图片与视频，再用结果继续下一步创作。支持自己的本机或远程 ComfyUI，桌面 Beta 已可下载：https://fourques.github.io/Takeboard/zh/

English:

> I'm building TakeBoard, an open-source AI creation canvas on ComfyUI. Choose models, connect media, generate images or videos, and use a result in your next step. Desktop beta; bring your own ComfyUI. https://fourques.github.io/Takeboard/

平台专用稿见[渠道内容](outreach-2026-09.md)，实际发布状态见[推广记录](promotion-log.md)。保持维护者身份，不包装成独立测评。

## 给编辑的事实核对

| 项目 | 当前状态 |
| --- | --- |
| 许可与关系 | Apache-2.0；独立项目，与 Comfy Org 无隶属关系 |
| 公开版本 | [v0.2.0-beta.17](https://github.com/Fourques/Takeboard/releases/tag/v0.2.0-beta.17)，六个系统 / 架构安装包 |
| 运行前提 | 安装包含应用运行时，不含 ComfyUI、模型或节点 |
| 工作流 | 内置适配按需添加，自定义工作流需检查依赖、输入映射和执行信任；不保证任意图通用 |
| 语言 | 应用界面目前主要为中文，官网与入门材料有中英两版 |
| 系统签名 | 未完成 Apple 公证 / Windows 商业代码签名；[首次打开说明](downloads.md) |
| 生成证据 | [兼容矩阵](compatibility-matrix.md)记录特定环境的真实运行；现有宣传视频仅为模拟交互 |
| 数据位置 | 项目保存到所选位置；远程生成上传必要输入并取回输出，[详见](generation-and-storage.md) |
| 后续代码 | main 有尚未进入安装包的修复，[版本记录](../CHANGELOG.md)单独列出 |

“镜头”是一个可生成图片或视频的单元；画布连接输入，但不是一键执行全图的流水线。“采用结果”是创作者的选择，不是强制审批。模型与自定义节点有各自许可，Apache-2.0 不授予它们额外权利。

## 下一份 Demo

优先制作真实的“图片 → 视频”创作案例，以生成结果和画布操作为主。参数、版本与硬件放在配套说明，等待可剪辑但保留实际耗时。没有跑通的步骤不拼接成已完成流程。当前真实生成 Demo 待制作，脚本见[渠道内容](outreach-2026-09.md#真实-demo-脚本待制作)。

[中文入门](https://fourques.github.io/Takeboard/zh/guides/organize-comfyui-results/) · [English guide](https://fourques.github.io/Takeboard/guides/organize-comfyui-results/) · [交流与反馈](https://github.com/Fourques/Takeboard/discussions/10)
