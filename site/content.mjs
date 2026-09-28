export const content = {
  en: {
    lang: "en",
    title: "TakeBoard — an open-source project canvas for ComfyUI",
    description:
      "Organize ComfyUI references, shots and generated takes in one desktop project canvas. Bring your own ComfyUI. Open source, local-first, currently in beta.",
    switchLabel: "简体中文",
    switchPath: "zh/",
    download: "Download beta",
    downloadDoc: "downloads.en.md",
    eyebrow: "OPEN SOURCE · LOCAL-FIRST · COMFYUI",
    heading: "Your references. Your takes. One project.",
    intro:
      "A project canvas for ComfyUI creators. Keep reference media, shot inputs and generated takes together, so you can return to the choices behind a result.",
    note: "Bring your own ComfyUI, models and nodes. Not a hosted generation service.",
    preview: "Explore the canvas",
    previewNote:
      "Development-build interaction demo · simulated outputs · no GPU. Published installers may differ.",
    caption:
      "Reference media and shot connections in TakeBoard. Simulated interaction, not model-generated output.",
    featuresTitle: "Keep the creative context.",
    features: [
      [
        "01 / Organize",
        "References belong with the project.",
        "Keep images, videos and shots on a canvas instead of treating each generation as an isolated form.",
      ],
      [
        "02 / Connect",
        "Make the inputs visible.",
        "Connect media to supported workflow inputs. ComfyUI still runs the graph; TakeBoard provides the project workspace.",
      ],
      [
        "03 / Revisit",
        "Find the take—and its parameters.",
        "Review attempts alongside generation records and keep the results you want to build on.",
      ],
    ],
    startTitle: "Start with what you already have.",
    starts: [
      [
        "No ComfyUI yet?",
        "Install the app, create a disposable project, import your own image and reopen it to check that it was saved. No account or GPU is needed for this organization-only trial.",
      ],
      [
        "Already generating with ComfyUI?",
        "Connect your trusted local or remote service. Start with a compatible workflow and a small test. Inspect the actual output and where it was saved.",
      ],
    ],
    checklist: "First-session checklist",
    faqTitle: "Before you download",
    faq: [
      [
        "Is this a replacement for ComfyUI?",
        "No. TakeBoard adds a project layer around generation. Use ComfyUI itself to edit node graphs. TakeBoard is an independent project, not an official Comfy Org product.",
      ],
      [
        "Does every imported workflow work?",
        "No. A workflow may need dependencies, explicit input bindings and trust approval. Importing a JSON file is not proof that it can execute. Use the compatibility evidence and test your own setup.",
      ],
      [
        "Do I need a cloud account or subscription?",
        "Local project management does not require registration. TakeBoard supplies no hosted GPU service. Your models, remote infrastructure and any third-party services have their own requirements and costs.",
      ],
      [
        "Where does my media go?",
        "Projects use your selected storage location. Remote generation transfers required inputs to the service you choose. Only connect trusted devices; do not expose ComfyUI directly to the internet.",
      ],
      [
        "What has actually been verified?",
        "The public compatibility matrix records one Linux / RTX 4090 / H3 text-to-video run with automated integrity checks. It is not proof of every workflow, hardware combination or visual quality. The video on this page is a simulated UI demonstration.",
      ],
      [
        "Is the desktop preview signed?",
        "Current packages are not Apple-notarized or commercially Windows-code-signed. Read the installation guidance; do not globally disable system protections to try an app.",
      ],
    ],
    evidence: "Compatibility evidence",
    releaseLabel: "Public preview",
    kitTitle: "For creators, writers and curious people.",
    kitIntro:
      "Descriptions, screenshots, a short interaction video, source manifest and honest boundaries. Ready to reference, not a collection of endorsements.",
    kitDownload: "Download media kit",
    kitRead: "Read the media kit",
    facts: "Product facts (JSON)",
    feedbackTitle: "What got in your way?",
    feedback: "Share your first blocked step",
    footer:
      "Independent open-source project. No tracking scripts or application services on this site.",
    skip: "Skip to content",
  },
  zh: {
    lang: "zh-CN",
    title: "TakeBoard — 面向 ComfyUI 创作者的开源项目画布",
    description:
      "把 ComfyUI 的参考素材、镜头输入与生成结果放进同一张项目画布。开源、本地优先；使用自己的 ComfyUI 和模型，当前为 Beta。",
    switchLabel: "English",
    switchPath: "",
    download: "下载测试版",
    downloadDoc: "downloads.md",
    eyebrow: "开源 · 本地优先 · COMFYUI",
    heading: "参考素材与每次尝试，都在同一个项目。",
    intro:
      "给 ComfyUI 创作者的一张项目画布。把素材、镜头输入和生成结果放在一起，回到一个结果时，也能找回它背后的选择。",
    note: "需要自备 ComfyUI、模型与节点。不提供托管生成服务。",
    preview: "看看画布如何工作",
    previewNote: "开发版交互演示 · 模拟输出 · 未使用 GPU。公开安装包界面可能不同。",
    caption: "TakeBoard 的参考素材与镜头连线。模拟交互示例，非模型生成效果。",
    featuresTitle: "创作的来龙去脉，留在画布里。",
    features: [
      [
        "01 / 整理",
        "素材属于项目，不再散落。",
        "把图片、视频与镜头放进画布，不把每次生成当成互不相关的一张表单。",
      ],
      [
        "02 / 连接",
        "看得见每个镜头的输入。",
        "将素材连接到工作流支持的输入。ComfyUI 负责执行节点图，TakeBoard 补上项目工作区。",
      ],
      ["03 / 回看", "找回结果，也找回参数。", "结合生成记录查看不同尝试，保留想继续创作的结果。"],
    ],
    startTitle: "从你已有的环境开始。",
    starts: [
      [
        "还没有 ComfyUI？",
        "安装后新建测试项目，导入自己的图片，再重新打开确认保存。只试项目组织，不需要账号或 GPU。",
      ],
      [
        "已经在用 ComfyUI？",
        "连接可信的本机或远程服务，从兼容工作流和一次小测试开始。检查真实输出，以及结果保存的位置。",
      ],
    ],
    checklist: "首次试用清单",
    faqTitle: "下载之前，你可能想知道",
    faq: [
      [
        "它会替代 ComfyUI 吗？",
        "不会。TakeBoard 补充生成前后的项目组织；编辑节点图仍使用 ComfyUI。TakeBoard 是独立项目，不是 Comfy Org 官方产品。",
      ],
      [
        "导入工作流就能运行吗？",
        "不一定。工作流可能需要补齐依赖、显式输入绑定和信任确认。导入成功不等于可执行，请查看兼容证据并验证自己的环境。",
      ],
      [
        "需要注册或购买云端订阅吗？",
        "本机项目管理无需注册。TakeBoard 不提供托管 GPU；用户选择的模型、远程基础设施和第三方服务有各自的使用条件与成本。",
      ],
      [
        "素材会保存和传输到哪里？",
        "项目使用你选择的存储位置。远程生成会将所需输入传给所选服务；只连接可信设备，不要把 ComfyUI 直接暴露到公网。",
      ],
      [
        "目前哪些内容经过了验证？",
        "公开兼容矩阵有一条 Linux / RTX 4090 / H3 文生视频的自动完整性记录，不代表所有工作流、硬件或视觉质量已验证。本页视频只演示模拟交互。",
      ],
      [
        "安装包有系统签名吗？",
        "当前尚无 Apple 公证或 Windows 商业代码签名。请阅读安装指南，不要为了试用而全局关闭系统安全保护。",
      ],
    ],
    evidence: "查看兼容证据",
    releaseLabel: "公开预览版",
    kitTitle: "给想介绍它的人，一份完整素材。",
    kitIntro:
      "中英文介绍、截图、交互视频、来源清单与使用边界。便于引用，不伪装成独立测评或第三方背书。",
    kitDownload: "下载宣传素材包",
    kitRead: "阅读素材说明",
    facts: "产品事实（JSON）",
    feedbackTitle: "第一处不顺手的地方是什么？",
    feedback: "告诉我们你的试用经历",
    footer: "独立开源项目。此网站无追踪脚本，也不运行生成服务。",
    skip: "跳到正文",
  },
};
