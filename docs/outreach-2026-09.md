# TakeBoard：2026 年 9 月推广执行包

适用版本：v0.2.0-beta.17。本文是发布素材，不代表已在每个渠道发布；实际动作见文末执行记录。替代旧 launch-kit 中的版本与渠道草稿。

## 先把受众收窄

首轮面向已有 ComfyUI、开始管理多个素材与生成结果的创作者，以及使用笔记本连接 GPU 机器的人。不是向完全没有生成环境的用户承诺一键免费生成。

一句话：**把 ComfyUI 的素材、镜头和生成结果，放回同一个项目。**

英文：**A local-first project canvas for ComfyUI creators.**

核心行动只保留一个：下载，带一份已经能运行的工作流完成第一次小测试，再告诉我们最早卡住的地方。Star 可以反映关注，不能代替实际使用。

## V2EX / 中文创作者社区正文

标题：做了一个 ComfyUI 项目画布：TakeBoard，素材、镜头和生成结果放在一起

我在开发 TakeBoard，一个开源、本地优先的 ComfyUI 创作工作台。

它不是新的生成模型，也不打算替代 ComfyUI 的节点编辑器。我想解决的是另一个问题：当项目不止一张图、一个视频时，参考素材、工作流、提示词和每次生成的结果容易散在文件夹与不同窗口里。

TakeBoard 把这些放在一个项目画布中：导入素材，连接镜头输入，选择工作流，调整参数，查看结果与生成记录。可以用本机 ComfyUI，也可以连接自己的远程生成设备。本地项目管理无需注册。

现在提供 beta.17，Mac、Windows、Debian/Ubuntu 各有 x64 和 ARM64 安装包。应用包含自己的运行时，但不包含 ComfyUI、模型和自定义节点；自定义工作流也不是导入 JSON 就一定能运行。桌面包尚未完成 Apple 公证与 Windows 商业签名，属于适合愿意反馈问题的创作者使用的预览版。

最想听到的是：你用它完成一次小测试时，第一处不顺手的地方是什么？如果手上有已经能在 ComfyUI 运行的公开工作流，也欢迎分享链接和遇到的具体问题。

下载：https://github.com/Fourques/Takeboard/blob/main/docs/downloads.md

十分钟试用清单：https://github.com/Fourques/Takeboard/blob/main/docs/first-session.md

源码：https://github.com/Fourques/Takeboard

发布前确认社区规则和账号条件；不要跨多个节点重复发同一篇。以上是维护者视角草稿，不得伪装成无关联用户推荐。

## ComfyUI 社区英文正文

Title: TakeBoard: an open-source project canvas for ComfyUI assets, shots and results

Disclosure: I maintain TakeBoard.

ComfyUI handles the generation graph. TakeBoard is an attempt to keep the surrounding project together: reference media, shots, workflow inputs, prompts and generated takes on a canvas, with generation history alongside the results.

The beta.17 desktop preview has installers for macOS, Windows and Debian/Ubuntu, on x64 and ARM64. Local project management does not require an account. Generation uses your own local or remote ComfyUI installation; models and Custom Nodes are not bundled. Imported workflows may need dependency fixes or explicit input bindings. This is not a promise that every workflow works.

I'm looking for feedback from people who already have a working ComfyUI workflow: does the project layer make it easier to keep inputs and outputs organized, and where does the first attempt get stuck?

Source: https://github.com/Fourques/Takeboard

Installers: https://github.com/Fourques/Takeboard/blob/main/docs/downloads.en.md

First-session checklist: https://github.com/Fourques/Takeboard/blob/main/docs/first-session.md#english

The preview is not Apple-notarized or commercially Windows-code-signed. Six-platform installer checks are not six-platform GPU-generation validation. Remote generation sends the required inputs to your chosen server.

只在明确允许工具分享的版块发布；本轮未能从 Reddit 规则页读取完整规则，不据此推定许可。先人工确认社区规则，必要时询问版主。不得复制到 HN。

## X / 即刻短帖

中文：

> 做了 TakeBoard：给 ComfyUI 补一张项目画布，把参考素材、镜头、提示词和生成结果放在一起。beta.17 已提供 Mac / Windows / Linux 安装包。本地使用无需注册；生成需要自己的 ComfyUI 与模型。欢迎带一个工作流来试，告诉我第一处卡住的地方。https://github.com/Fourques/Takeboard

English:

> Building TakeBoard: a local-first project canvas for ComfyUI assets, shots and results. Mac, Windows and Linux beta installers. Bring your own ComfyUI; workflow compatibility varies. Feedback welcome: https://github.com/Fourques/Takeboard

## Bilibili / 短视频脚本（待真人录制）

标题：ComfyUI 生成完，素材和镜头怎么整理？试做了一个开源画布

0–8 秒：先展示同一项目的素材、连线和结果，不以空首页作为唯一展示。

8–25 秒：导入自己有授权的图片，连接支持的输入，写提示词。

25–45 秒：展示当前可用工作流与关键参数；有真实 GPU 条件才录制提交和生成。若用 Demo Worker，整段持续标注“交互演示，非模型生成”。

45–65 秒：查看结果、生成参数、资产库，再重开项目展示保存。

65–75 秒：说明模型需自备、处于测试版，给一个仓库链接。标题不写“免费无限生成”“所有模型通用”或未经测量的提速倍数。

已有 docs/assets/takeboard-home.webp 是历史首页截图，不是 beta.17 完整流程证明。9 月 28 日已录制[开发版交互视频](demo-guide.md)，持续标注模拟输出；真实 GPU 案例尚未录制，不能用交互视频代替画质或速度证据。

## 给教程作者和编辑的素材包

### 项目介绍（可引用，不要求照搬）

TakeBoard 是给 ComfyUI 创作者使用的开源项目画布，把参考素材、镜头输入和生成结果放在同一工作区。它补充项目组织能力，不替代 ComfyUI 节点编辑器，也不提供模型或托管算力。本机项目管理无需账号；生成需要用户自己的 ComfyUI。当前为测试版。

English: TakeBoard is an open-source project canvas for ComfyUI creators. It keeps reference media, shot inputs and generated takes in one workspace. It complements the node editor rather than replacing it. Bring your own ComfyUI, models and nodes; this is a beta, not a hosted generation service.

### 可直接使用的链接

- [项目与源码](https://github.com/Fourques/Takeboard)，Apache-2.0。
- [中文安装指南](https://github.com/Fourques/Takeboard/blob/main/docs/downloads.md) / [English downloads](https://github.com/Fourques/Takeboard/blob/main/docs/downloads.en.md)。
- [首次试用](https://github.com/Fourques/Takeboard/blob/main/docs/first-session.md)：没有 GPU 也能试项目组织；生成是另一条需要环境的路径。
- [画布截图](https://raw.githubusercontent.com/Fourques/Takeboard/8a2f03543497731b2d141ef233609ef25f6d6a5f/docs/assets/takeboard-demo-cover.png)、[结果截图](https://raw.githubusercontent.com/Fourques/Takeboard/8a2f03543497731b2d141ef233609ef25f6d6a5f/docs/assets/takeboard-demo-results.png)。两张均为模拟示例，引用时保留这一说明。
- [视频与来源说明](https://github.com/Fourques/Takeboard/blob/main/docs/demo-guide.md)。开发版截图不代表当前安装包完全相同，不裁掉模拟标识。
- [首次反馈表](https://github.com/Fourques/Takeboard/issues/new?template=first_try.yml)：只需说明第一处阻碍，不要求观众先排查底层节点。

### 合作邀请草稿（未发送）

你好，我在维护开源项目 TakeBoard，想向制作 ComfyUI 教程的创作者介绍一个“生成之外的项目组织”工具：把素材、镜头与每次结果放在同一张画布中。

如果这个方向适合你的内容，欢迎用自己的公开测试工作流试用，重点看能否更容易找到输入、比较结果和重新打开项目。可以如实展示失败和不适合的地方，不要求正面评价或点赞。安装包、试用步骤和模拟演示都在仓库里；目前没有可作为画质证明的宣传样片，也不承诺任意工作流即导即用。

项目：https://github.com/Fourques/Takeboard

仅在对方公开接受项目推荐或表达相关需求的渠道使用；按对方内容定制开头，不批量私信，不未经许可转用其作品。不代表已经建立合作。

### 下一条内容如何区别于已有公告

不再重复“发布一个新工具”。采用题目：**ComfyUI 生成了很多版本，怎样找回每个结果的参考素材和参数？**

结构：一个真实项目问题 → 输入与结果在画布中的对应关系 → 重新打开项目找回记录 → 当前限制 → 一个试用入口。若尚无授权真实案例，先做项目组织教程，不伪装成模型生成教程。

真实生成演示的发布门槛：素材授权清楚；记录应用版本、工作流来源、模型、硬件、宽高/时长与耗时；确认输入实际生效、结果可播放、项目重开后仍可找到；遮住个人路径和地址。完成前只称“待录制”，不拼接无关结果。

### 参考与取舍

- [Product Hunt 官方准备指南](https://www.producthunt.com/launch/preparing-for-launch)：用可理解的产品故事和演示帮助用户判断；本项目先把试用链路做好，不急于集中首发。
- [ComfyUI 官方项目页](https://github.com/Comfy-Org/ComfyUI)：明确产品定位、安装入口与社区入口；TakeBoard 应说明自己补充的是项目层，而不是暗示能取代整个生态。
- [HelloGitHub 自荐模板](https://github.com/521xueweihan/HelloGitHub/blob/master/.github/ISSUE_TEMPLATE/submit-cn.yaml)与[GitHubDaily 投稿入口](https://github.com/GitHubDaily/GitHubDaily#readme)：按编辑需要提供原创简介、适用对象与截图，不把投稿等同推荐。

## 技术文章切入点

可发布文章：[SSH 连上了，为什么生成服务还没就绪？](device-state-design.md)。适合开发者社区，重点是状态建模与可解释失败，不把文章写成按钮功能清单。

## 首批用户访谈（无需隐私数据）

请对方用自己的测试项目操作，不远程代做：安装 → 导入图片 → 连已有 ComfyUI → 一次小生成 → 找到输出。记录最早阻断、是否解决、是否愿意再次使用。只记录对方自愿给出的系统和公开工作流信息。

找 5 位测试者是目标，不是现有用户数。不要批量私信；只在对方明确表达相关需求或接受合作的渠道联系。

## 渠道与规则

- 科技爱好者周刊：[仓库说明](https://github.com/ruanyf/weekly#readme)明确接受软件 Issue 投稿。只投一条，公开关联，等待编辑决定；投稿不等于收录。
- V2EX：[分享创造](https://v2ex.com/go/create)欢迎作品分享；需要可用账号，仍受站点规则约束。
- ComfyUI 社区：[规则入口](https://www.reddit.com/r/comfyui/about/rules/)。此次完整规则未读出，不能直接判定允许自推广。
- HN：[现行规则](https://news.ycombinator.com/newsguidelines.html)禁止生成或 AI 润色文字。不提供代写正文、不代发、不拉票。维护者本人可用自己的经历撰写。
- Product Hunt：留到有真实创作者反馈和新版演示后，不为了渠道数量消耗首发。参考[官方指南](https://www.producthunt.com/launch)。

## 衡量与下一轮

2026-09-28 基线：GitHub 2 Stars、0 Forks，beta.17 Mac M 包累计下载 2 次，其他五包各 0 次。下载包含维护者测试，不能当作用户数；用户留存、曝光与渠道转化尚无数据。

优先看：有效试用反馈数、最早阻断点、解决后是否完成首次结果、是否自愿再用。GitHub 下载数只作粗指标，不偷偷加入应用遥测。用户可选说明来源，不强制追踪。

后续人工检查：发布后第 2、7、14 天分别查看回复与阻断；有结果再发修复故事。同一渠道不重复顶帖。这里是执行建议，不代表已经创建自动跟进或排期。

实际发布、待审核、未发布和账号阻塞分别记录在 [执行记录](promotion-log.md)。
