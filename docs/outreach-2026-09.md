# TakeBoard 宣传内容与渠道稿

更新：2026-10-10。本文维护当前可用文案；历史投稿和回复保留在[推广记录](promotion-log.md)，草稿不等于已发布。

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

现在有一支 42 秒真实项目短片，展示参考连接、生成、选择结果与继续创作：https://fourques.github.io/Takeboard/zh/#demo 。生成等待已剪去。按目标社区规则选择分类，不重复投稿。

## 短帖草稿（未发布）

中文：

> 正在做 TakeBoard：基于 ComfyUI 的开源 AI 创作画布。选择模型、连接素材、生成图片与视频，再用结果继续下一步创作。支持自己的本机或远程 ComfyUI，桌面 Beta 已可下载：https://fourques.github.io/Takeboard/zh/

English:

> I'm building TakeBoard, an open-source AI creation canvas on ComfyUI. Choose models, connect media, generate images or videos, and use a result in your next step. Desktop beta; bring your own ComfyUI. https://fourques.github.io/Takeboard/

## 当前产品短片

[中文](https://fourques.github.io/Takeboard/zh/#demo) · [English](https://fourques.github.io/Takeboard/#demo) · [媒体素材](media-kit.md)

42 秒，真实创作画布中的参考、生成、采用与结果复用。展示一个完成结果及未生成的备选分支，不宣称整部故事已生成；生成等待已剪去。对外围绕创作过程，不把制作参数、执行日志或内部审片记录当作宣传内容。

## 编辑与教程作者

可引用介绍、截图和素材授权说明统一见[媒体包](media-kit.md)。邀请内容围绕实际创作场景定制，不要求正面评价，不复制泛化邀请批量私信。

适合的选题：如何用自己的 ComfyUI，在可视化画布中完成图片与视频创作。参数找回、远程状态等可作为后续专项教程，不占据产品主介绍。

## 已发布内容的本轮校准

已有入口原位更新，不顶帖、不重复投稿；新增渠道按下方发布顺序单独核验与记录。

- [ComfyUI Show and tell](https://github.com/Comfy-Org/ComfyUI/discussions/16666)：向已有 ComfyUI 的用户解释创作画布如何使用工作流。
- [项目公告](https://github.com/Fourques/Takeboard/discussions/10)：双语试用入口、主要创作路径与当前下载入口。
- [科技爱好者周刊](https://github.com/ruanyf/weekly/issues/11963)：简短介绍核心用途与试用条件。
- [HelloGitHub](https://github.com/521xueweihan/HelloGitHub/issues/3804)：按投稿字段提供定位、能力与截图。
- [GitHubDaily](https://github.com/GitHubDaily/GitHubDaily/issues/1125)：用图片接视频的创作例子解释用途。
- [ComfyUI UI 目录](https://github.com/light-and-ray/awesome-alternative-uis-for-comfyui/issues/107)：说明集成类别、工作流执行边界与依赖。

[ComfyUI UI 目录](https://github.com/light-and-ray/awesome-alternative-uis-for-comfyui#-takeboard)已于 9 月 30 日正式收录；其余投稿与两个目录 PR 继续等待审核。详情见[推广记录](promotion-log.md)。

10 月 2 日原位更新项目公告、周刊和 HelloGitHub 中的版本说明；目录中偏重生成历史的旧介绍通过[单段修订 PR #113](https://github.com/light-and-ray/awesome-alternative-uis-for-comfyui/pull/113)更新，已于同日合并并核对实际 README。没有重新投稿或要求维护者提前审核。

10 月 10 日，项目公告改用当前下载入口；周刊、HelloGitHub、GitHubDaily 和两个待审目录 PR 的旧模拟演示说明已原位换成当前产品短片。两个待审 PR 的实际条目也统一到创作画布定位，仅修改原有单行贡献，没有新增评论或重复投稿。具体回读结果见推广记录。

### ComfyUI Show and tell 正文

标题：TakeBoard: an open-source AI creation canvas built on ComfyUI

<!-- show-tell-post:start -->
I'm the maintainer of **TakeBoard**, an open-source AI creation canvas built on ComfyUI.

It brings image and video creation into one workspace: choose a model through an available workflow, connect reference media, write a prompt and generate. Keep several directions on the canvas, then use a result as the input for your next step—for example, taking an image into an image-to-video workflow.

The canvas is for creative work with media and generation nodes. Your ComfyUI still executes the underlying graph, and you can open its editor when a workflow needs deeper changes.

- Image and video tasks show the inputs and parameters supported by the selected workflow.
- Add recommended templates or import your own workflows; custom graphs may need input mapping and dependency fixes.
- Connect local or remote ComfyUI. A project can stay on your laptop while outputs are collected from your GPU server.

[![A real TakeBoard project: references, generated media and creative branches](https://fourques.github.io/Takeboard/media/takeboard-film-poster.en.jpg)](https://fourques.github.io/Takeboard/#demo)

**[Watch the 42-second film](https://fourques.github.io/Takeboard/#demo)**—a real project, from a reference to a generated result and the next creative step. Generation wait is omitted; both editions show the actual Chinese app interface.

**[Try the desktop beta](https://fourques.github.io/Takeboard/#download)** · [Getting started](https://fourques.github.io/Takeboard/guides/organize-comfyui-results/) · [Source](https://github.com/Fourques/Takeboard)

macOS, Windows and Debian/Ubuntu installers are available. Local use needs no account. Bring your own ComfyUI, models and nodes; this is beta software and workflow compatibility varies. [Installation notes](https://github.com/Fourques/Takeboard/blob/main/docs/downloads.en.md) cover the unsigned/notarization-pending packages.

I'd welcome feedback on the creation flow: can you go from a reference to a generated result and use it in the next step without losing your place? If something blocks that, [tell us which step](https://github.com/Fourques/Takeboard/issues/new?template=first_try.yml).

Apache-2.0. Independent project, not affiliated with Comfy Org.
<!-- show-tell-post:end -->

## 项目公告正文

<!-- project-announcement:start -->
## 把 AI 图片与视频创作，放进同一张画布

TakeBoard 是基于 ComfyUI 的开源 AI 创作画布。把参考素材、模型与提示词放在一起，生成图片和视频，再用结果继续下一步。保留几个方向，让想法逐渐成为画面。

[![TakeBoard 真实项目短片](https://fourques.github.io/Takeboard/media/takeboard-film-poster.zh.jpg)](https://fourques.github.io/Takeboard/zh/#demo)

**[观看短片 · 42 秒](https://fourques.github.io/Takeboard/zh/#demo)** · **[下载桌面 Beta](https://fourques.github.io/Takeboard/zh/#download)** · [开始第一个项目](https://github.com/Fourques/Takeboard/blob/main/docs/first-session.md)

短片展示真实项目的参考连接、生成、采用与继续创作，生成等待已剪去。

支持自己的本机或远程 ComfyUI，本机使用无需注册。Mac、Windows、Debian/Ubuntu 均有 x64 / ARM64 安装包。ComfyUI、模型与节点需另行准备；工作流兼容性和首次打开方法见[安装说明](https://github.com/Fourques/Takeboard/blob/main/docs/downloads.md)。

想做什么？哪一步不顺手？欢迎[告诉我们](https://github.com/Fourques/Takeboard/issues/new?template=first_try.yml)，不需要先做技术诊断。

## One canvas for AI image and video creation

TakeBoard is an open-source creative workspace built on ComfyUI. Connect reference media, choose models and write prompts on one canvas. Generate a result, keep different directions in view, then build the next scene from what you've made.

**[Watch the film · 42 sec](https://fourques.github.io/Takeboard/#demo)** · **[Download desktop beta](https://fourques.github.io/Takeboard/#download)** · [Get started](https://github.com/Fourques/Takeboard/blob/main/docs/first-session.md#english)

The film follows a real project through generation, choosing a result and connecting it to the next step. Generation wait is omitted. English titles accompany actual Chinese app capture.

Connect your own local or remote ComfyUI. Local use needs no account. Installers cover macOS, Windows and Debian/Ubuntu on x64 and ARM64. Bring your own ComfyUI, models and nodes; workflow compatibility varies. See [installation notes](https://github.com/Fourques/Takeboard/blob/main/docs/downloads.en.md) for first-launch guidance.

What would you like to create, and where does the flow get in your way? [Share your experience](https://github.com/Fourques/Takeboard/issues/new?template=first_try.yml).

维护者发布 / Posted by the maintainer. [媒体素材 / Media kit](https://github.com/Fourques/Takeboard/blob/main/docs/media-kit.md)
<!-- project-announcement:end -->

## 渠道规则与衡量

发布前检查社区当前规则与账号权限。HN 禁止 AI 生成或润色文字，不将这些草稿用于 HN。Reddit、短视频等渠道的草稿与实际发布分别记录；未确认账号、规则或实际发布 URL 时，不计为已完成。

观察有效创作反馈、首次阻碍、是否完成生成与是否继续使用。Stars、下载与克隆不是活跃用户数，不据此宣称增长效果。沿用已有复盘，不增加跟踪脚本或重复自动化。技术依据见 [AI 搜索策略](ai-discovery-strategy.md)。

## 发布案例与取舍（2026-10-10）

以下是从原项目公开页面观察到的做法，不是增长因果证明，也不是 TakeBoard 已取得的成绩。只借鉴信息组织和社区方式，不复用品牌、素材或公开借竞品定义价值。

| 案例与一手来源 | 可观察的做法 | TakeBoard 的具体取舍 |
| --- | --- | --- |
| [Penpot 正式发布](https://community.penpot.app/t/penpot-s-official-launch-brings-developers-and-designers-closer-than-ever/2384) | 以重点能力、操作演示、教程和社区讨论串联发布；回复中也出现官网图与实际 UI 不一致的疑问 | 每篇只讲一条创作路径；用实际应用录屏承接画布全景，不让后期空间运镜暗示未实现的编辑能力 |
| [Krita AI Diffusion](https://github.com/Acly/krita-ai-diffusion) | 创作效果与交互示例、安装下载和详细文档分层，底层技术另列 | 封面展示完整项目与分支关系；首帖只解释使用价值与必要条件，节点依赖留给安装和工作流指南 |
| [Excalidraw](https://github.com/excalidraw/excalidraw) | 开源仓库区分用户访问入口、产品能力和开发者集成内容 | 创作者默认去官网和下载，开发者去源码；不让调试脚本、测试统计和架构占据首发内容 |
| [Zed 社区实践](https://zed.dev/blog/community-champions) | 长期认识贡献者，重视问题复现、代码与社区协助，不靠单一指标判断贡献 | 当前先认识愿意完成一次创作的人；不照搬大项目的头衔、积分体系或大规模群运营 |
| [Product Hunt 官方发布指南](https://help.producthunt.com/en/articles/17350772-launch-guide) | 简洁介绍、实际产品画面、短演示、维护者首评及发布后的持续回复；禁止直接索票 | 准备完整提交稿，但不把冲榜当第一目标；能承接首次试用与评论时再正式发布，不买票、不群发催赞 |

### 接下来的分发顺序

1. B站：用现有中文 42 秒片原生投稿，封面强调创作画布；简介只给一个官网入口。先核验登录、分区和平台要求，不为了赶进度乱选分类。
2. 已有 ComfyUI 社区入口：更新原帖失效信息，回应实际问题；不因发布新安全版本另发重复宣传帖。Reddit 需核对目标社区的当前规则和登录状态，无法读取规则不等于允许发布。
3. 一个英文视觉渠道：优先用独立英文稿和真实应用画面，不假称已有英文界面。账号未授权时准备可直接投稿的内容，不宣称已发布。
4. 教程作者合作：先找公开接受选题或工具试用的作者，阅读其相关作品后定制邀请；不索要正面评价，不从陌生地址群发。没有经过核验的对象，不编造“已联系”名单。
5. Product Hunt：素材和维护者首评准备好后，结合可响应评论的时间再定发布日期；不是先制造预约或投票任务。

### B站投稿稿（未发布）

标题：**把 AI 图片与视频创作，放进一张画布｜TakeBoard**

简介：

做 AI 影像时，我想把参考、提示词、不同方向和生成结果放在一起，边看边往下做。

这是我在开发的 TakeBoard：基于 ComfyUI 的开源创作画布。接上参考，生成一个结果，再从这一版继续下一幕。视频里是一个真实项目，生成等待已剪去。

官网与下载：https://fourques.github.io/Takeboard/zh/

支持 Mac、Windows、Debian/Ubuntu，连接自己的本机或远程 ComfyUI。当前为 Beta，ComfyUI 与模型需自行准备。

如果你也在用 ComfyUI，想邀请你试着完成一次小创作。最想知道的是：哪一步顺手，哪一步让你停下来了？

建议标签：TakeBoard、ComfyUI、开源、AI视频、AI绘画。分区与是否需要 AI 内容标记以投稿时实际规则为准，不伪造纯人工制作声明。

### X 短帖（未发布）

> I’m building TakeBoard: an open-source canvas for AI image and video creation with your own ComfyUI. Keep references, creative branches and generated results together—and build the next scene from what you make. Watch the project in action: https://fourques.github.io/Takeboard/

附件选英文短片或真实画布截图，不同时堆封面、下载、源码和反馈四组链接。发布时按实际编辑器字符计算校验；不要截断必要使用条件。

### Reddit 创作流程帖（未发布，规则待核验）

标题：**I’m building an open-source image and video canvas for ComfyUI — looking for feedback on the creation flow**

I maintain TakeBoard, a desktop canvas for working with your own ComfyUI. References, prompts, generation steps and different directions stay in one project. A generated image or video can become an input to the next step.

The project shown here follows a reference into a generated result, then connects that result to another shot. The generation wait is cut; the app capture itself is real. This is a Chinese-language app today, with an English website and introduction.

I’m particularly interested in whether the canvas helps you develop a project, rather than just produce isolated outputs. If you try it, what is the first point where you lose track or need to return to ComfyUI?

Desktop beta for macOS, Windows and Debian/Ubuntu. Bring your own ComfyUI, models and nodes; custom workflows can need mapping and dependency fixes. Local use needs no account.

Project and downloads: https://fourques.github.io/Takeboard/

适配当前分类后只发布一次；不用泛泛的求赞、无关热点、第三方帖子下的广告回复或批量跨社区重复贴。目标社区不允许工具推广时不发布，不伪装成普通用户推荐。

### Product Hunt 提交稿（未提交，不设发布日期）

- Name: TakeBoard
- Tagline: An open-source canvas for AI image and video creation
- Description: Connect references, prompts and generation steps on one canvas. Create images and videos with your own local or remote ComfyUI, keep different directions in view, and build the next scene from your results. Desktop beta; Chinese app interface.
- Website: https://fourques.github.io/Takeboard/
- Gallery order: 完整真实画布 → 参考输入与生成配置 → 结果回到画布并连接下一步。只用已发布产品截图，不拼接不存在的功能。

Maker comment:

Hi, I’m the maintainer of TakeBoard. I wanted a place where a creative project could stay visible while I worked with ComfyUI—not just a prompt box and a single output.

TakeBoard brings references, prompts, generation steps and results onto one canvas. Keep different directions side by side, then use a result to continue the next scene. The underlying workflows still run in your own local or remote ComfyUI.

The desktop beta is available for macOS, Windows and Debian/Ubuntu. ComfyUI, models and custom nodes are separate prerequisites; workflow compatibility varies. The app interface is primarily Chinese today. I’d love to hear where the creation flow works for you and where you get stuck.

### 教程作者邀请模板（未发送）

你好，我是 TakeBoard 的维护者。看到你关于【确实看过的相关作品与具体内容】的分享，想邀请你试试这款基于 ComfyUI 的开源创作画布。

我想解决的是一个完整创作项目里的操作关系：参考接进生成，保留几条方向，结果回到画布，再接着做下一幕，而不是只展示模型画质。

这里有 42 秒产品片与下载：https://fourques.github.io/Takeboard/zh/

如果与你的内容方向合适，欢迎按自己的判断试用；不要求正面评价。你也可以直接告诉我不适合或哪一步用不下去。无需提供私人项目或账户信息。

发送前替换并核实括号内容、收件对象与其公开合作入口。未替换的模板不能直接发送。

### 发布后的反馈闭环

- 每个渠道只记录真实发布 URL、时间、实际可见的播放／点击／评论及首次使用反馈。拿不到的数据记未知，编辑器草稿不是已发布。
- 先邀请少量已有 ComfyUI 环境的创作者完成「参考 → 生成 → 结果接入下一步」；5 位有效试用者是本轮目标，不是现有用户数，不以 Star 或点赞兑换资格。
- 使用既有首次试用 Issue 或公告回复，允许只说卡在哪一步；不要强迫用户上传项目、令牌、SSH 信息或私人媒体。
- 有反馈后先复现最早的阻碍，记录受影响版本与修复，再征得用户同意引用其反馈。没有真实反馈，不生产“用户案例”或满意度数字。
- 搜索报告通过已经验证的站点账号读取，观察实际查询与点击；AI 自然发现按既有固定问题组记录模型、日期、搜索开关和引用，不把提供官网后的问答当自然推荐。
- 第一轮之后按有效试用反馈决定下一篇教程或演示内容，不机械按日历发同一份广告。
