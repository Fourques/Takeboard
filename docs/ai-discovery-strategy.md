# TakeBoard：AI 搜索发现与引用策略

研究日期：2026-09-28。目标是让相关用户发现、理解和试用，不承诺任何模型优先推荐。

## 机制与证据

1. **训练知识不等于实时搜索。**无法让现有闭源模型立即“记住”项目。可控部分是公开页面、可访问性、内容准确性和真实第三方反馈。
2. [OpenAI 爬虫文档](https://developers.openai.com/api/docs/bots)区分 OAI-SearchBot（搜索）、GPTBot（可能用于训练）与 ChatGPT-User（用户触发访问）。允许搜索抓取不是训练授权或推荐保证。
3. [Google 官方指南](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)强调有用原创内容、可抓取页面和正常 SEO；不要求特殊 AI 标记，不使用 llms.txt 提升排名，反对批量近似内容和虚假提及。不批量造“十大工具”网页、不购买提及、不写隐藏模型指令。
4. [Perplexity](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)与 [Anthropic](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)区分搜索抓取与其他访问。不同厂商的索引排序不同；不把 ChatGPT 说明外推到豆包、DeepSeek、Kimi。
5. [GEO 原始研究](https://arxiv.org/abs/2311.09735)提供黑盒实验与可见性指标，但实验效果不能直接外推为 TakeBoard 收益。[后续综述](https://arxiv.org/abs/2607.14035)也提醒指标和证据标准不一致。不引用实验百分比作为增长承诺。

## 实施顺序

| 阶段 | 动作 | 验收标准 |
| --- | --- | --- |
| 本轮先做 | 双语媒体包：事实、图注、边界、合作入口 | 有来源，模拟素材标记，无虚构案例 |
| 本轮落实 | 双语静态介绍页，回答真实问题 | 无 JS 仍完整；手机可读；下载反馈可达 |
| 本轮落实 | canonical、hreflang、地图、SoftwareApplication 数据 | 正文与元数据一致，不伪造评分 |
| 部署后 | 验证公网并通过 IndexNow 通知新页面 | 记录接收状态，不把提交当索引 |
| 7 天后 | 检查发现、回复和首次试用阻碍 | 时间、问题、引用 URL 与限制 |
| 真实案例后 | 可复现教程，联系接受合作的作者 | 标明关联和硬件参数，允许负面反馈 |
| 需用户账号 | Google Search Console / Bing Webmaster 验证和查看报告 | 获授权后操作，不伪造验证状态 |

使用免费 GitHub Pages，只部署明确挑选的公开文件，不部署 API、项目目录或用户素材。项目站点在 `/Takeboard/`；此路径下的 robots.txt 不控制域名根，本轮不放假有效配置。上线前根 `/robots.txt` 为 404；迁移域名后重查 robots 与防火墙，不把伪装 User-Agent 请求当真实爬虫证据。

## 内容选择

两种语言维护一个主题，不为每种关键词造重复页。主线是基于 ComfyUI 的统一创作画布：怎样选择模型、连接素材、生成图片与视频、用结果继续创作。依赖、工作流限制、存储与远程传输放在用户决策和操作需要的位置。结构化数据描述实际产品，不是特殊排名通道。

## 评估方法

固定问题，下轮按相同语言、地区、产品和搜索开关复查。未授权/未使用的模型记为“未测试”，不是“未推荐”。

- TakeBoard 是什么？需要自己安装 ComfyUI 吗？
- What is TakeBoard for ComfyUI, and what does it require?
- 有哪些开源工具可以组织 ComfyUI 的参考素材、镜头和生成结果？
- Open-source project canvas for organizing ComfyUI references and generated video takes
- Can I use TakeBoard without a GPU or a cloud account?

区分：可达 → 搜索出现 → AI 提及 → 正确引用 → 试用反馈。不能用给定官网后的问答冒充自然推荐，不反复查询刷印象，不购买 API 调用伪造流量。

2026-09-30 定位 Review 后，后续问题组应增加“基于 ComfyUI 的开源图片与视频创作画布有哪些？”和“Open-source canvas for image and video creation using my own ComfyUI”。上述整理/记录问题保留为旧基线，不以问题改变后的结果声称排名提升。对外不使用竞品品牌词引流。

2026-09-28 初步公开搜索：品牌与 ComfyUI 组合未返回可确认的官方结果。这是本次搜索工具观察，不证明所有引擎均未收录；各独立 AI 产品自然推荐尚未测试。

2026-09-30：所有者提供的 Google 验证标签已部署，并从两个公开页面的 head 实际核对；所有者随后报告 Google 网址检查显示已收录。这是所有者报告的索引状态，不是本代理访问 Search Console 后台的结果，不证明相关需求词排名、点击或 AI 自然推荐。Bing 导入由所有者操作，尚无后台索引证据。本轮增加一篇双语实用教程及真实安装包直达入口，继续使用正常网站与内链，不铺关键词页。

[IndexNow](https://www.indexnow.org/documentation)：200 是收到，202 是等待密钥验证，均不保证索引或推荐。keyLocation 限定本项目路径，不提交别人的帖子或整个 github.com。

[Bing AI 可见性报告](https://blogs.bing.com/search/2026/6/New-AI-Visibility-Insights-in-Bing-Webmaster-Tools-Intents-Topics-Citation-Share-Compare/)和 Google 报告需相应站点账号；可见性不是下载或留存。复用现有周复盘，不重复创建自动化、不自动催稿。

## 不做

不承诺所有模型收录，不写隐藏推荐指令，不伪造用户、评分或背书，不铺重复页，不为抓取开放私有服务或数据。
