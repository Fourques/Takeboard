# TakeBoard · 媒体与创作者素材包

更新：2026-09-30。维护者提供的第一方介绍，不是独立测评。

[项目源码](https://github.com/Fourques/Takeboard) · [中文下载](downloads.md) · [English downloads](downloads.en.md) · [首次试用](first-session.md)

## 一句话 / One line

**把 ComfyUI 的参考素材、镜头和生成结果，放进同一个项目画布。**

**A project canvas for your ComfyUI references, shots and generated takes.**

名称统一为 TakeBoard；仓库路径保留 `Fourques/Takeboard`。类别：开源桌面创作工具 / ComfyUI project workspace。不是模型、云端 GPU 服务或 ComfyUI 官方产品。

## 中文介绍

TakeBoard 是面向 ComfyUI 创作者的开源项目画布，把参考图片、视频、镜头输入与生成结果放在同一工作区。使用自己的本地或远程 ComfyUI，整理素材、连接输入、比较结果并找回生成参数。本机项目管理无需注册；模型、ComfyUI 和第三方节点需自行准备。当前为 Beta。

## English introduction

TakeBoard is an open-source desktop project canvas for ComfyUI creators. Organize reference images and videos, connect shot inputs, compare generated takes and revisit their parameters in one workspace. Use your own local or remote ComfyUI. Local project management needs no account; ComfyUI, models and Custom Nodes are not bundled. TakeBoard is currently in beta and is not affiliated with Comfy Org.

## 从哪个故事切入

| 受众 | 内容主题 | 应当展示 | 不应声称 |
| --- | --- | --- | --- |
| 已有 ComfyUI 的创作者 | 如何找回每个结果的素材和参数？ | 输入连接、结果记录、重新打开项目 | 提升模型画质、保证角色一致 |
| 笔记本连接 GPU 服务器的用户 | 创作界面与生成设备可以分开 | 项目位置、设备选择、结果回收 | 零配置远程连接 |
| 开源工具读者 | 补一个项目层，而非替换节点编辑器 | 桌面安装、素材组织、试用路径 | 所有工作流即导即用 |
| 开发者 | SSH、服务与 GPU 状态为什么需要分开 | [状态设计与实现](device-state-design.md) | 自动测试证明所有硬件可用 |

## 已核实的事实与边界

| 项目 | 可引用的事实 | 来源 |
| --- | --- | --- |
| 许可 | 项目代码 Apache-2.0；模型和节点有各自许可 | [LICENSE](../LICENSE) |
| 公开安装包 | v0.2.0-beta.17；macOS、Windows、Debian/Ubuntu，分别有 x64 / ARM64 | [Release](https://github.com/Fourques/Takeboard/releases/tag/v0.2.0-beta.17) |
| 依赖 | 含应用运行时，不含 ComfyUI、模型、自定义节点 | [安装说明](downloads.md) |
| 账号 | 本机项目管理无需注册；远程和账号项目仍有权限边界 | [权限说明](access-control.md) |
| 工作流 | 任意 JSON 不保证执行；需检查依赖、绑定及信任 | [创作指南](creator-workstation.md) |
| 系统信任 | 未完成 Apple 公证与 Windows 商业代码签名 | [发行说明](desktop-production-signing.md) |
| 真实生成 | 一条 Linux / RTX 4090 / H3 T2V 自动完整性验收，不是全模型测试或视觉质量背书 | [矩阵](compatibility-matrix.md) |
| 数据 | 使用所选存储；远程生成向所选服务传输所需输入 | [数据与设备](generation-and-storage.md) |

不能把 main 的新变化当成 beta.17 已包含的功能，不从单条记录推导通用速度。

## 截图、视频与品牌资源

| 文件 | 用途 | 必须保留的说明 |
| --- | --- | --- |
| [画布截图](assets/takeboard-demo-cover.png) | 项目介绍主图 | 开发版模拟交互，非模型输出 |
| [结果截图](assets/takeboard-demo-results.png) | 候选与结果查看 | 模拟结果，不代表画质 |
| [11.44 秒 WebM](assets/takeboard-product-walkthrough.webm) | 交互演示 | 保留 SIMULATED OUTPUTS · NO GPU |
| [来源与 SHA-256](assets/takeboard-demo-manifest.json) | 核验来源 | b58fd27，不是安装包版本证明 |
| [图标 SVG](../apps/web/public/takeboard-icon.svg) | 标识本项目 | 不暗示 ComfyUI 官方出品 |

中文图注：**TakeBoard 开发版：参考素材、镜头与输入连线。模拟交互，非模型生成效果；公开安装包界面可能不同。**

English caption: **TakeBoard development build: references, shots and input connections. Simulated interaction, not model-generated output. Published installers may differ.**

介绍或评测可引用上述截图、录屏和图标，请链接项目并注明模拟性质。本说明不授权用户私人素材或第三方产物，不构成第三方背书；代码转载遵循 LICENSE。

## 可直接发布的短帖

中文：我在开发 TakeBoard，一个开源 ComfyUI 项目画布，想解决生成多个镜头后素材、参数与结果散落的问题。本机项目管理无需注册，真实生成使用自己的 ComfyUI。现在是 Beta，自定义工作流可能需要适配。欢迎带一个能运行的工作流试试，告诉我第一处不顺手的地方。https://github.com/Fourques/Takeboard

English: Disclosure: I maintain TakeBoard, an open-source project canvas for ComfyUI references, shots and generated takes. Bring your own ComfyUI; workflows may need bindings and dependencies. This is a beta, not a hosted model service. Feedback on your first blocked step is welcome: https://github.com/Fourques/Takeboard

发布前核对平台规则，不用于禁止 AI 撰写内容的渠道（包括 HN），不伪装成独立测评。

## 教程：两种演示脚本

### A. 无 GPU 的项目组织教程

0–8 秒展示画布与要解决的问题；8–25 秒创建测试项目、导入授权图片并移动命名；25–40 秒从资产库找回素材；40–55 秒关闭重开项目确认保存；55–65 秒给下载与反馈入口。明确没有生成图片或视频。

这是待录制脚本。已有 11 秒 Demo 未覆盖上述完整流程。

### B. 真实生成案例

连接可信 ComfyUI，选择已验证工作流，小尺寸提交，展示真实结果、来源与参数，导出并播放。等待可剪辑，但标明实际耗时。

发布前记录：应用版本、工作流来源/哈希、模型、节点版本、GPU、宽高/时长、步数、实际耗时、素材授权、完整观看结果的结论。输入未生效或画质不合格时如实说明，不用其他工具样片替换。当前真实案例待录制。

## 合作与反馈

可引用的实用教程：[中文：整理参考素材与生成记录](https://fourques.github.io/Takeboard/zh/guides/organize-comfyui-results/) / [English: organize references and generation records](https://fourques.github.io/Takeboard/guides/organize-comfyui-results/)。包含无 GPU 的首次整理测试、输入能力核对、结果记录和重开项目检查；不是新的真实 GPU 案例。

[合作讨论](https://github.com/Fourques/Takeboard/discussions/10) · [首次反馈](https://github.com/Fourques/Takeboard/issues/new?template=first_try.yml)

不要求正面评价、不以点赞换权益、不批量私信。应用版本、系统和第一处阻碍即可，来源选填；不上传私人素材或凭据。邀请草稿见[执行包](outreach-2026-09.md)，实际发布见[记录](promotion-log.md)。
