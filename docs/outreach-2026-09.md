# TakeBoard 宣传内容与渠道稿

更新：2026-10-02。本文维护当前可用文案；历史投稿和回复保留在[推广记录](promotion-log.md)，草稿不等于已发布。

## 统一定位

**TakeBoard 是基于 ComfyUI 的开源 AI 创作画布。**

主张：**把 AI 图片与视频创作，放进同一张画布。**

English: **An open-source AI creation canvas built on ComfyUI. One canvas for AI image and video creation.**

核心顺序：统一画布中的完整创作 → 按任务使用模型与工作流 → 自己的本机或远程生成环境。素材管理、参数记录和任务状态用于支撑操作，不再作为首屏主卖点。公开文案不以其他产品或“替代品”定位自己。

## 信息放在哪一层

| 层级 | 应当提供 | 不在此处展开 |
| --- | --- | --- |
| 简介、首屏、短帖 | 是什么、能创作什么、画布如何连接步骤、开源、试用入口 | 架构、状态机、审计指标、完整限制清单 |
| 下载与首次使用 | 平台、Beta、ComfyUI 与模型需自备、工作流兼容、首次打开方法 | 历史重构和测试实现 |
| 使用指南、技术与验收文档 | 输入映射、远程存储、权限、具体兼容记录与复现条件 | 泛化成所有用户都会经历的必要步骤 |

素材是模拟的就标在素材旁；缺少的生成依赖在下载前说明。减少工程细节不等于制造“不需要 ComfyUI”“所有模型即用”等错误预期。

## 中文创作者社区草稿（未发布）

标题：TakeBoard：把 AI 图片与视频创作，放进同一张画布

我在开发 TakeBoard，一个基于 ComfyUI 的开源 AI 创作画布。

想试一个画面时，在画布上选择模型、接上参考素材、写提示词就可以提交生成。满意的图片可以接着用来生成视频，也可以并排保留几个版本，继续往不同方向尝试。底层使用自己的 ComfyUI 工作流，日常操作留在创作画布中，需要调整节点时再进入 ComfyUI。

现在提供 Mac、Windows、Debian/Ubuntu 桌面 Beta。本机无需注册，支持本机或远程生成设备。ComfyUI、模型和节点需另外准备，自定义工作流可能需要适配。

想邀请已有 ComfyUI 环境的创作者试试：从一份参考素材到一个结果，再把结果用到下一步，整条创作流程是否顺手？

下载与介绍：https://fourques.github.io/Takeboard/zh/

公开演示目前是带有标记的模拟交互，不是生成样片。按目标社区规则选择分类，不重复投稿。

## 短帖草稿（未发布）

中文：

> 正在做 TakeBoard：基于 ComfyUI 的开源 AI 创作画布。选择模型、连接素材、生成图片与视频，再用结果继续下一步创作。支持自己的本机或远程 ComfyUI，桌面 Beta 已可下载：https://fourques.github.io/Takeboard/zh/

English:

> I'm building TakeBoard, an open-source AI creation canvas on ComfyUI. Choose models, connect media, generate images or videos, and use a result in your next step. Desktop beta; bring your own ComfyUI. https://fourques.github.io/Takeboard/

## 真实 Demo 脚本（待制作）

标题：从图片到视频，在一张画布里创作

- 开头直接展示最终视频与对应画布。
- 回到一个干净项目，导入有授权的参考素材或从文生图开始。
- 选择一个真实可用的工作流，连接输入，填写提示词，提交生成。
- 展示真实结果，再将它接入下一步创作。只有实际跑通后才展示两步生成；否则清楚展示已完成的一步。
- 结尾留一个下载入口。录屏可剪去等待，但标注实际耗时。

画面主角是创作和结果，不是下载模型、解释参数映射或展示运行日志。版本、模型、工作流、硬件与参数放在配套说明；素材授权和输入是否生效需先核对。现有模拟视频可以说明交互，不能替代真实生成案例。

## 编辑与教程作者

可引用介绍、截图和素材授权说明统一见[媒体包](media-kit.md)。邀请内容围绕实际创作场景定制，不要求正面评价，不复制泛化邀请批量私信。

适合的选题：如何用自己的 ComfyUI，在可视化画布中完成图片与视频创作。参数找回、远程状态等可作为后续专项教程，不占据产品主介绍。

## 已发布内容的本轮校准

仅编辑原帖，不新增渠道、不顶帖、不重复投稿。

- [ComfyUI Show and tell](https://github.com/Comfy-Org/ComfyUI/discussions/16666)：向已有 ComfyUI 的用户解释创作画布如何使用工作流。
- [项目公告](https://github.com/Fourques/Takeboard/discussions/10)：双语试用入口、主要创作路径和 beta.18 更新。
- [科技爱好者周刊](https://github.com/ruanyf/weekly/issues/11963)：简短介绍核心用途与试用条件。
- [HelloGitHub](https://github.com/521xueweihan/HelloGitHub/issues/3804)：按投稿字段提供定位、能力与截图。
- [GitHubDaily](https://github.com/GitHubDaily/GitHubDaily/issues/1125)：用图片接视频的创作例子解释用途。
- [ComfyUI UI 目录](https://github.com/light-and-ray/awesome-alternative-uis-for-comfyui/issues/107)：说明集成类别、工作流执行边界与依赖。

[ComfyUI UI 目录](https://github.com/light-and-ray/awesome-alternative-uis-for-comfyui#-takeboard)已于 9 月 30 日正式收录；其余投稿与两个目录 PR 继续等待审核。详情见[推广记录](promotion-log.md)。

10 月 2 日原位更新项目公告、周刊和 HelloGitHub 中的版本说明；目录中偏重生成历史的旧介绍已提交[单段修订 PR #113](https://github.com/light-and-ray/awesome-alternative-uis-for-comfyui/pull/113)，尚待合并。没有重新投稿或要求维护者提前审核。

### ComfyUI Show and tell 正文

标题：TakeBoard: an open-source AI creation canvas built on ComfyUI

<!-- show-tell-post:start -->
I'm the maintainer of **TakeBoard**, an open-source AI creation canvas built on ComfyUI.

It brings image and video creation into one workspace: choose a model through an available workflow, connect reference media, write a prompt and generate. Keep several directions on the canvas, then use a result as the input for your next step—for example, taking an image into an image-to-video workflow.

The canvas is for creative work with media and generation nodes. Your ComfyUI still executes the underlying graph, and you can open its editor when a workflow needs deeper changes.

- Image and video tasks show the inputs and parameters supported by the selected workflow.
- Add recommended templates or import your own workflows; custom graphs may need input mapping and dependency fixes.
- Connect local or remote ComfyUI. A project can stay on your laptop while outputs are collected from your GPU server.

![TakeBoard creation canvas; development-build UI with simulated results](https://raw.githubusercontent.com/Fourques/Takeboard/8a2f03543497731b2d141ef233609ef25f6d6a5f/docs/assets/takeboard-demo-cover.png)

*The screenshot and [short interaction demo](https://github.com/Fourques/Takeboard/blob/main/docs/demo-guide.md#english) use simulated results, not real model output.*

**[Try the desktop beta](https://fourques.github.io/Takeboard/#download)** · [Getting started](https://fourques.github.io/Takeboard/guides/organize-comfyui-results/) · [Source](https://github.com/Fourques/Takeboard)

macOS, Windows and Debian/Ubuntu installers are available. Local use needs no account. Bring your own ComfyUI, models and nodes; this is beta software and workflow compatibility varies. [Installation notes](https://github.com/Fourques/Takeboard/blob/main/docs/downloads.en.md) cover the unsigned/notarization-pending packages.

I'd welcome feedback on the creation flow: can you go from a reference to a generated result and use it in the next step without losing your place? If something blocks that, [tell us which step](https://github.com/Fourques/Takeboard/issues/new?template=first_try.yml).

Apache-2.0. Independent project, not affiliated with Comfy Org.
<!-- show-tell-post:end -->

## 渠道规则与衡量

发布前检查社区当前规则与账号权限。HN 禁止 AI 生成或润色文字，不将这些草稿用于 HN。Reddit、短视频等未发布渠道仍记为待执行；本轮不扩展。

观察有效创作反馈、首次阻碍、是否完成生成与是否继续使用。Stars、下载与克隆不是活跃用户数，不据此宣称增长效果。沿用已有复盘，不增加跟踪脚本或重复自动化。技术依据见 [AI 搜索策略](ai-discovery-strategy.md)。
