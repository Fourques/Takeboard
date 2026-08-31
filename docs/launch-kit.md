# TakeBoard 首轮推广执行包

目标不是追求一次性虚高流量，而是找到真实使用 ComfyUI 做连续镜头、短片和广告的创作者，并把反馈转成可复现的 Workflow 兼容矩阵。

## 一句话定位

TakeBoard 是面向 ComfyUI 创作者的开源、本地优先 AI 影像工作台：把素材、镜头输入、可信 Workflow、每次生成、候选与选片放回同一个项目。

## 首轮受众与渠道

| 优先级 | 受众 | 渠道 | 目标动作 |
| --- | --- | --- | --- |
| 1 | 已经维护多个 ComfyUI Workflow 的视频创作者 | GitHub Release、Discussions、ComfyUI 社区 | 下载并提交一个真实兼容性报告 |
| 2 | 独立 AI 短片/广告创作者 | Bilibili、即刻、X、小红书/V2EX 的创作与技术社区 | 看 60–90 秒真实流程并进入 README |
| 3 | 开源与本地优先工具用户 | Show HN、Reddit 自托管/生成式 AI 社区 | 讨论架构、安全边界与可移植性 |
| 4 | 通用早期用户 | Product Hunt | 在演示、净机安装和 5 人测试完成后再发布 |

## 可直接使用的中文首发文案

> 我做了 TakeBoard：一个给 ComfyUI 创作者使用的开源、本地优先 AI 影像工作台。它不重做节点编辑器，而是补上项目层——素材、镜头、首尾帧/参考输入、Workflow、每次 Run、候选 Take 与批准结果都在同一张画布里；需要检查整片节奏时，再启用只读粗剪扩展。
>
> 项目和媒体保存在自己的机器；自定义 Workflow 不会因为文件名相似就直接执行，而是先诊断依赖、建立参数 Binding，并用内容哈希锁定信任。生成进度只在 ComfyUI 提供真实节点信息时显示百分比，未知时明确保持不确定状态。
>
> v0.1.0 是 Public Preview，适合个人创作者和可信自托管团队，不宣称是零配置桌面软件或公网 SaaS。现在最希望找到几位有真实视频 Workflow 的创作者，测试“导入 → 映射 → 生成 → 选片”，以及按需启用粗剪的全过程。欢迎直接反馈阻断点；运行中心可以导出不含素材、提示词、账号和路径的诊断报告。
>
> GitHub: https://github.com/Fourques/Takeboard

## Show HN：只提供事实清单，不提供代写正文

Hacker News 当前规则明确写明不要发布 AI 生成或 AI 润色的内容，因此不要复制本文件或让 AI 代写 Show HN 正文。请由开发者本人用自己的经历写，并确保发布时可以在线回答问题。可以自行核对以下事实：

- 为什么 ComfyUI 节点图不足以管理多镜头项目；
- 自己在文件夹、标签页、Run 和选片上遇到的具体问题；
- TakeBoard 如何保存来源、Binding、候选与批准关系；
- 为什么未知进度不显示假百分比，为什么 Workflow 不按文件名获得执行权限；
- 当前公开预览的真实边界和最希望测试者验证的部分；
- 直接链接可运行的源码仓库，不链接只有注册表单的落地页。

标题同样请自行撰写，并以 `Show HN:` 开头。不要让朋友集中点赞或评论，也不要把 HN 主要当作推广渠道。

## Product Hunt 草稿（准备完成后使用）

- **Name:** TakeBoard
- **Tagline:** A local-first production canvas for ComfyUI filmmakers
- **Short description:** Organize assets, shots, trusted workflows, generation runs, candidate takes and approvals in one self-hosted project—then review the sequence as a rough cut.
- **Maker first comment:** Explain the folder/tab problem, why Workflow trust is explicit, what works today, and ask for compatibility feedback rather than votes.

Product Hunt 官方建议在真正准备好时发布、由 Maker 自己参与讨论，并禁止付费推广或直接索要 upvote。TakeBoard 应在演示视频、三平台净机验证和首批 5 人任务测试完成后再提交，避免消耗首次发布机会。

## 60–90 秒演示脚本

1. 0–8s：首页旋转导演板，进入一个真实项目；屏幕字幕“本地优先，不上传你的素材”。
2. 8–22s：拖入原图/视频，连到镜头首帧、尾帧或参考输入；展示原图没有裁切。
3. 22–38s：选择可信 Workflow，展示依赖/Binding 状态和画布内主要参数。
4. 38–55s：开始生成，显示真实节点进度或明确的不确定状态，再打开跨项目任务中心。
5. 55–70s：比较候选、批准一个 Take，镜头节点变成完整生成结果。
6. 70–82s：说明粗剪是可选扩展，启用后打开分镜墙与粗剪，显示未完成镜头的计划空镜。
7. 82–90s：项目包导出与运行诊断；结尾只放 GitHub 地址和“寻找真实 Workflow 测试者”。

## 两周执行节奏

- Day 1：发布 GitHub v0.1.0、仓库简介/Topics、欢迎 Discussion；确认 CI 全绿。
- Day 2–3：录制不剪辑造假的完整流程，再剪出 90 秒版本；在中文创作者社区发布。
- Day 4–7：邀请 5 位目标用户，各自带一个 Workflow；只观察，不代操作。
- Week 2：公开兼容矩阵与最常见三个阻断点；发布修复版本和一篇技术文章。
- Product Hunt / Show HN：演示和陌生用户证据齐全后再发；发布当天持续回答技术与边界问题。

## 衡量方式

首轮不以 Star 为唯一目标。记录：安装成功率、首次项目完成率、首个 Workflow 成功绑定率、每位用户需要的支持分钟数、有效兼容性报告数、7 日后仍继续使用的人数。任何渠道都不购买点赞、不群发骚扰、不伪装成普通用户推荐。

## 规则与参考

- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)：用 Tag 标记可下载、可订阅的软件迭代；
- [GitHub Discussions](https://docs.github.com/en/discussions/collaborating-with-your-community-using-discussions/about-discussions)：把开放交流与可执行 Bug 分开；
- [GitHub Issue Forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository)：收集结构化复现信息；
- [Product Hunt Launch Guide](https://www.producthunt.com/launch)：准备充分后由 Maker 真实参与，不购买推广、不索要 upvote；
- [Show HN Guidelines](https://news.ycombinator.com/showhn.html) 与 [HN Guidelines](https://news.ycombinator.com/newsguidelines.html)：必须可试用、本人参与、不拉票，也不发布 AI 生成/润色正文。
