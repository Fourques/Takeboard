export const content = {
  en: {
    lang: "en",
    title: "TakeBoard — open-source AI creation canvas, built on ComfyUI",
    description:
      "Choose models, connect media and generate images or videos in one visual workspace. An open-source desktop creation canvas built on your own local or remote ComfyUI.",
    switchLabel: "简体中文",
    switchPath: "zh/",
    download: "Download beta",
    downloadDoc: "downloads.en.md",
    downloadTitle: "Choose your computer.",
    downloadNote:
      "App interface currently primarily Chinese. Includes the app runtime, not ComfyUI or models. Apple notarization and commercial Windows signing are pending.",
    installGuide: "Installation and opening help",
    guideLink: "Make your first project",
    eyebrow: "OPEN SOURCE · LOCAL-FIRST · COMFYUI",
    heading: "One canvas for AI image and video creation.",
    intro:
      "Choose models, connect media and generate through your own ComfyUI. Use the results in your next step, or explore several ideas side by side.",
    note: "Open-source desktop app. Local use needs no account. Generation requires your own ComfyUI, models and nodes.",
    preview: "Explore the canvas",
    previewNote:
      "Development-build interaction demo · simulated outputs · no GPU. Published installers may differ.",
    caption:
      "Reference media and shot connections in TakeBoard. Simulated interaction, not model-generated output.",
    featuresTitle: "Your creative process, connected.",
    features: [
      [
        "01 / Canvas",
        "Create across connected steps.",
        "Bring references, prompts and generation nodes together. Make an image, use it in a video, or explore several versions on the same canvas.",
      ],
      [
        "02 / Workflows",
        "Pick the tool for what you want to make.",
        "Choose image or video generation and a compatible workflow. Its inputs and controls appear where you create. Add recommended templates or bring your own ComfyUI workflows.",
      ],
      [
        "03 / Open source",
        "Your models. Your machines.",
        "Connect to local or remote ComfyUI and choose where projects live. Work from a laptop with a GPU server, or keep the setup on one machine. No official cloud subscription required.",
      ],
    ],
    startTitle: "Start with what you already have.",
    starts: [
      [
        "Already using ComfyUI?",
        "Connect it in Settings, add a compatible workflow and create a shot. Start with one generation, then inspect the result and its saved prompt and parameters.",
      ],
      [
        "Want to explore first?",
        "Create a project and import an image. Try the canvas and asset library, then reopen the project. These features work without ComfyUI; generation needs a separate setup.",
      ],
    ],
    checklist: "First-session checklist",
    faqTitle: "Before you download",
    faq: [
      [
        "Is this a replacement for ComfyUI?",
        "TakeBoard lets you run generation and organize media, shots and results in a project. Use ComfyUI itself to edit the underlying node graph. TakeBoard is an independent project, not affiliated with Comfy Org.",
      ],
      [
        "Does every imported workflow work?",
        "Start with a recommended template or import your own Workflow JSON, API Prompt JSON or PNG with workflow metadata. TakeBoard checks dependencies and inputs. Custom workflows may need parameter mapping and trust confirmation; unsupported graphs can be exported as API format from ComfyUI and imported again.",
      ],
      [
        "Do I need a cloud account or subscription?",
        "Local project management does not require registration. TakeBoard supplies no hosted GPU service. Your models, remote infrastructure and any third-party services have their own requirements and costs.",
      ],
      [
        "Where does my media go?",
        "A local project saves to your chosen folder. Remote ComfyUI receives the required inputs, and TakeBoard collects outputs into that project. Opening a remote TakeBoard project is a separate option: its files stay on the remote host.",
      ],
      [
        "Which models can I use?",
        "Recommended adaptations include Qwen Image, MiniMax H3, Wan 2.2 and LTX 2.3. You can also import custom workflows. Available inputs and generation options depend on the workflow and the models and nodes installed on your device. TakeBoard is currently in beta.",
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
      "Bilingual descriptions, screenshots, an interaction video and source information for articles, tutorials and reviews.",
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
    title: "TakeBoard — 基于 ComfyUI 的开源 AI 创作画布",
    description:
      "在同一张画布中选择模型、连接素材、编写提示词，生成图片与视频。基于自己的本机或远程 ComfyUI，开源桌面创作工作台。",
    switchLabel: "English",
    switchPath: "",
    download: "下载测试版",
    downloadDoc: "downloads.md",
    downloadTitle: "选择你的电脑，下载一个安装包。",
    downloadNote:
      "测试版包含应用运行时，不包含 ComfyUI 或模型。Apple 公证与 Windows 商业签名尚未完成。",
    installGuide: "安装与首次打开说明",
    guideLink: "开始第一个创作项目",
    eyebrow: "开源 · 本地优先 · COMFYUI",
    heading: "把 AI 图片与视频创作，放进同一张画布。",
    intro:
      "选择模型、连接素材、编写提示词，生成图片与视频。用结果继续创作，在同一张画布中探索不同方向。",
    note: "开源桌面应用，本机使用无需注册。生成需要自备 ComfyUI、模型与节点。",
    preview: "看看画布如何工作",
    previewNote: "开发版交互演示 · 模拟输出 · 未使用 GPU。公开安装包界面可能不同。",
    caption: "TakeBoard 的参考素材与镜头连线。模拟交互示例，非模型生成效果。",
    featuresTitle: "把创作的每一步，连接起来。",
    features: [
      [
        "01 / 创作画布",
        "从一张图，继续创作下一个镜头。",
        "参考素材、提示词与生成节点放在一起。生成图片后继续制作视频，或在同一张画布上探索多个版本。",
      ],
      [
        "02 / 模型与工作流",
        "想做什么，就选择相应的创作工具。",
        "选择图片或视频生成，再选择兼容的工作流，画布上即可操作对应输入与参数。推荐模板按需添加，也能导入自己的 ComfyUI 工作流。",
      ],
      [
        "03 / 开源",
        "自己的模型，自己的设备。",
        "连接本机或远程 ComfyUI，自选项目保存位置。用笔记本连接 GPU 服务器，或在同一台电脑完成创作，无需官方云端订阅。",
      ],
    ],
    startTitle: "从你已有的环境开始。",
    starts: [
      [
        "已经在用 ComfyUI？",
        "在设置中连接服务，添加一个兼容工作流并新建镜头。从一次生成开始，查看结果及保存的提示词与参数。",
      ],
      [
        "想先看看是否顺手？",
        "新建项目，导入图片，试用画布与资产库，再重新打开项目。这些操作不需要 ComfyUI；生成时再配置环境。",
      ],
    ],
    checklist: "首次试用清单",
    faqTitle: "下载之前，你可能想知道",
    faq: [
      [
        "它会替代 ComfyUI 吗？",
        "TakeBoard 提供生成操作，以及素材、镜头和结果的项目管理。修改底层节点图仍使用 ComfyUI。TakeBoard 是独立项目，与 Comfy Org 无隶属关系。",
      ],
      [
        "导入工作流就能运行吗？",
        "可以按需添加推荐模板，或导入自己的 Workflow JSON、API Prompt JSON、含工作流元数据的 PNG。TakeBoard 会检查依赖与输入；自定义工作流可能需要确认参数映射和执行信任。无法转换的节点图可在 ComfyUI 中导出 API 格式后重新导入。",
      ],
      [
        "需要注册或购买云端订阅吗？",
        "本机项目管理无需注册。TakeBoard 不提供托管 GPU；用户选择的模型、远程基础设施和第三方服务有各自的使用条件与成本。",
      ],
      [
        "素材会保存和传输到哪里？",
        "本机项目保存在你选择的文件夹。远程 ComfyUI 接收所需输入，TakeBoard 将输出取回该项目。另一个可选功能是打开远程 TakeBoard 项目，此时项目文件保存在远程主机上。",
      ],
      [
        "可以使用哪些模型？",
        "推荐适配包括 Qwen Image、MiniMax H3、Wan 2.2、LTX 2.3，也可以导入自定义工作流。具体输入与生成选项由工作流，以及设备上已安装的模型和节点决定。TakeBoard 当前为 Beta。",
      ],
      [
        "安装包有系统签名吗？",
        "当前尚无 Apple 公证或 Windows 商业代码签名。请阅读安装指南，不要为了试用而全局关闭系统安全保护。",
      ],
    ],
    evidence: "查看兼容证据",
    releaseLabel: "公开预览版",
    kitTitle: "给想介绍它的人，一份完整素材。",
    kitIntro: "中英文介绍、截图、交互视频与来源说明，可用于撰写文章、教程和评测。",
    kitDownload: "下载宣传素材包",
    kitRead: "阅读素材说明",
    facts: "产品事实（JSON）",
    feedbackTitle: "第一处不顺手的地方是什么？",
    feedback: "告诉我们你的试用经历",
    footer: "独立开源项目。此网站无追踪脚本，也不运行生成服务。",
    skip: "跳到正文",
  },
};

// One useful tutorial in two languages, not keyword-specific copies of a landing page.
export const guideContent = {
  en: {
    lang: "en",
    title: "Create with ComfyUI on a canvas — TakeBoard getting-started guide",
    description:
      "Create a project, connect ComfyUI, choose a workflow and generate an image or video on the canvas. Use the result in your next creative step.",
    heading: "Start creating on the canvas.",
    intro:
      "Create a project, connect a compatible workflow, generate an image or video, and use the result in your next step. Start with a ComfyUI setup that already works for you.",
    scope:
      "Maintainer-written guide · public beta.17 · development screenshots show simulated results, not model output. Newer main UI may differ from the installer.",
    switchLabel: "简体中文",
    back: "TakeBoard",
    sections: [
      [
        "01",
        "Create a project and connect ComfyUI.",
        "Create a project and choose its save folder. Add reference media if your task needs it. In Settings, connect your local or remote ComfyUI. Without one, you can still explore the canvas and asset library; generation needs a configured service.",
      ],
      [
        "02",
        "Check what a workflow actually accepts.",
        "For a first generation, use a workflow that already runs in your own ComfyUI. In TakeBoard, check that its dependencies and input bindings are ready. Connect the supported inputs, then inspect the names of the connected assets before submitting. A visible line or an @ mention is not proof that a model supports that reference.",
      ],
      [
        "03",
        "Generate and choose a result.",
        "Create a shot, choose the generation type and an available workflow, connect its required media and write a prompt. Adjust dimensions and, for video, duration, then submit. Review the result on the canvas or in shot details. Try another version if you want to explore a different direction.",
      ],
      [
        "04",
        "Use the result in your next step.",
        "Keep the version you want or add several results to the canvas. Connect an image to a compatible image-to-video workflow, or use a result as a reference for another task. Each generation is submitted separately. You can return to earlier attempts and their settings, or download original media for other tools.",
      ],
    ],
    checklistTitle: "Before your first real generation",
    checklist: [
      "The workflow runs in ComfyUI itself.",
      "TakeBoard reports it usable and shows the intended inputs.",
      "The final width, height and—only for video—duration match your plan.",
      "The selected device and project save location are the ones you intended.",
      "Start with one small test; inspect the actual output before scaling up.",
    ],
    troubleshootingTitle: "If the first step does not work",
    troubleshooting: [
      [
        "The app will not open",
        "Read the platform installation guidance. This preview is unsigned/notarization-pending; do not disable system protections globally.",
      ],
      [
        "The imported workflow cannot generate",
        "Import success is not execution support. Check missing nodes/models, input bindings and workflow trust. Use ComfyUI's own editor for graph changes.",
      ],
      [
        "The output ignores a reference",
        "Confirm that the workflow and model support that input, that the intended asset is connected, and that the saved attempt records it. More prompt text cannot add a capability the model lacks.",
      ],
    ],
    feedbackTitle: "Tell us the first blocked step.",
    feedbackText:
      "App version, operating system, what you tried and what happened are enough. A public workflow link helps. Do not attach private media, credentials or unreviewed logs; where you found TakeBoard is optional.",
    feedback: "Send first-session feedback",
    download: "Choose an installer",
    install: "Installation help",
    sources: "Detailed first-session checklist",
    resultCaption:
      "Generation-record UI in a development build. The illustrated take is simulated, not model-generated.",
    footer: "Independent project · Apache-2.0 · no tracking scripts",
    skip: "Skip to content",
  },
  zh: {
    lang: "zh-CN",
    title: "在画布中使用 ComfyUI 创作 — TakeBoard 入门指南",
    description:
      "新建项目、连接 ComfyUI、选择工作流，在画布中生成图片或视频，再用结果继续创作。TakeBoard 入门指南与常见问题。",
    heading: "从第一个画布项目开始创作。",
    intro:
      "创建项目，连接可用工作流，生成图片或视频，再用结果继续下一步创作。已有 ComfyUI 环境的用户，可以从自己熟悉的工作流开始。",
    scope:
      "维护者编写 · 公开版本 beta.17 · 开发版截图为模拟结果，非模型输出。main 的新界面可能与安装包不同。",
    switchLabel: "English",
    back: "TakeBoard",
    sections: [
      [
        "01",
        "创建项目，连接生成设备。",
        "新建项目，选择保存文件夹，根据创作需要导入参考素材。在设置中连接本机或远程 ComfyUI；还没有生成环境时，可以先探索画布和资产库，生成时再配置服务。",
      ],
      [
        "02",
        "确认工作流真正接受什么输入。",
        "第一次生成，先使用一份在自己的 ComfyUI 中已经跑通的工作流。在 TakeBoard 中检查依赖与输入绑定，连接它支持的素材，提交前核对已连接的素材名称。有一根线，或提示词里有一个 @ 引用，不代表模型就支持这类参考输入。",
      ],
      [
        "03",
        "提交生成，选择满意的结果。",
        "新建镜头，选择生成类型与可用工作流，连接所需素材，填写提示词。调整宽高，视频再设置时长，然后提交。完成后在画布或镜头详情中查看结果，也可以继续尝试不同版本。",
      ],
      [
        "04",
        "用结果继续下一步创作。",
        "保留满意的版本，或将多个结果加入画布。把图片连接到兼容的图生视频工作流，也可以将结果作为下一次任务的参考素材。每次生成分别提交；需要时可回看旧结果及参数，或下载原文件交给其他工具。",
      ],
    ],
    checklistTitle: "第一次真实生成前，核对这几项",
    checklist: [
      "同一工作流在 ComfyUI 本身能运行。",
      "TakeBoard 显示可用，输入类型与预期一致。",
      "最终宽高符合计划；只有视频任务才检查时长。",
      "生成设备与项目保存位置都选对了。",
      "先做一次小测试，检查真实输出再扩大生成。",
    ],
    troubleshootingTitle: "第一步卡住了，先看这里",
    troubleshooting: [
      [
        "应用无法打开",
        "查看对应平台的安装说明。当前测试版尚未完成公证或商业签名，不要全局关闭系统安全保护。",
      ],
      [
        "工作流导入后不能生成",
        "导入成功不等于执行支持。检查模型与节点依赖、输入绑定及信任状态；节点图修改使用 ComfyUI 自身的编辑器。",
      ],
      [
        "结果没有使用参考素材",
        "核对工作流和模型是否支持该输入、是否连接了正确素材，以及这次生成记录是否保存了它。增加提示词不能补上模型本身没有的能力。",
      ],
    ],
    feedbackTitle: "告诉我们第一处阻碍。",
    feedbackText:
      "应用版本、系统、你想做什么和实际发生了什么即可。有公开工作流链接更好。不要附带私人素材、凭据或未检查的日志；来源渠道可选填。",
    feedback: "反馈首次使用体验",
    download: "选择安装包",
    install: "安装说明",
    sources: "完整首次使用清单",
    resultCaption: "开发版的生成记录界面。图中结果是模拟示例，非模型生成。",
    footer: "独立开源项目 · Apache-2.0 · 无追踪脚本",
    skip: "跳到正文",
  },
};
