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
    downloadTitle: "Your next idea starts here.",
    downloadNote:
      "Requires your own ComfyUI and models for generation. The app is currently primarily in Chinese. Beta packages are not Apple-notarized or commercially Windows-signed.",
    installGuide: "Installation and opening help",
    guideLink: "Make your first project",
    eyebrow: "AI CREATION CANVAS · BUILT ON COMFYUI",
    heading: "Give your ideas\nroom to unfold.",
    intro:
      "An open-source canvas for AI images and video. Bring models, media and prompts together. Create with ComfyUI, then take the result somewhere new.",
    note: "Open-source desktop app. Local use needs no account. Generation requires your own ComfyUI, models and nodes.",
    preview: "See it in motion",
    previewNote: "Development preview · simulated outputs",
    caption:
      "Reference media and shot connections in TakeBoard. Simulated interaction, not model-generated output.",
    featuresTitle: "More ways to make it yours.",
    features: [
      [
        "Workflows",
        "The model fits the idea.",
        "Add a recommended workflow or bring your own from ComfyUI. Choose a compatible model for the image or video you want to make.",
      ],
      [
        "Controls",
        "Compose the details.",
        "Work with prompts, references and generation controls in one place. Explore variations without leaving your project.",
      ],
      [
        "Devices",
        "Create where you are.",
        "Run ComfyUI on your computer or connect to a remote machine. The canvas stays with you; you choose where generation happens.",
      ],
    ],
    startTitle: "A familiar engine.\nA new creative space.",
    starts: [
      [
        "Have ComfyUI ready?",
        "Connect it in Settings, add a compatible workflow and create your first shot.",
      ],
      [
        "Just looking around?",
        "Create a project and bring in an image. Explore the canvas before connecting a generation service.",
      ],
    ],
    faqTitle: "A few useful answers.",
    faq: [
      [
        "Is this a replacement for ComfyUI?",
        "TakeBoard brings image and video creation onto a connected canvas, using your own ComfyUI to run the workflows. Use ComfyUI's editor when you need to change the underlying node graph. TakeBoard is an independent project, not affiliated with Comfy Org.",
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
    kitTitle: "Share the canvas.",
    kitIntro:
      "Product descriptions, screenshots and an interaction video for your next article, tutorial or review.",
    kitDownload: "Download media kit",
    kitRead: "Read the media kit",
    facts: "Product facts (JSON)",
    feedbackTitle: "Help shape what comes next.",
    feedback: "Share feedback",
    skip: "Skip to content",
    principles: [
      ["One canvas", "Images, video, connected ideas"],
      ["Your workflow", "Recommended or custom"],
      ["Open source", "Your models. Your machines."],
    ],
    canvasTitle: "Create. Connect. Keep going.",
    canvasIntro:
      "A reference becomes an image. An image becomes a shot. Build on what you make, or explore a different direction alongside it.",
    provenance: "About this demo",
    steps: [
      ["Bring an idea", "Add your references and write a prompt."],
      ["Make it visible", "Choose a workflow and generate on the canvas."],
      ["Take it further", "Connect a result to your next creative step."],
    ],
    modelListLabel: "Example recommended workflow families",
    modelsNote:
      "Models and nodes are installed separately. Available inputs depend on the workflow.",
    demoTitle: "See the canvas at work.",
    demoIntro: "A short look at connecting references and reviewing results.",
    downloadIntro: "The desktop app, for your computer.",
    director: {
      label: "TakeBoard director board",
      front: "TakeBoard creation canvas. Development preview with simulated outputs.",
      back: "TakeBoard results view. Development preview with simulated outputs.",
      flip: "Turn the board over",
      help: "Drag horizontally to rotate. Use left and right arrows, Enter to turn over, or Escape to return to the front.",
    },
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
    downloadTitle: "下一幅画面，从这里开始。",
    downloadNote: "生成需自备 ComfyUI 与模型。Beta 安装包尚未完成 Apple 公证与 Windows 商业签名。",
    installGuide: "安装与首次打开说明",
    guideLink: "开始第一个创作项目",
    eyebrow: "开源 AI 创作画布 · 基于 COMFYUI",
    heading: "让想法，\n有新的画面。",
    intro:
      "把模型、素材与提示词放进同一张画布。通过 ComfyUI 生成图片与视频，让每一次创作成为下一步的起点。",
    note: "开源桌面应用，本机使用无需注册。生成需要自备 ComfyUI、模型与节点。",
    preview: "观看演示",
    previewNote: "开发版交互演示 · 模拟输出",
    caption: "TakeBoard 的参考素材与镜头连线。模拟交互示例，非模型生成效果。",
    featuresTitle: "创作方式，由你选择。",
    features: [
      [
        "工作流",
        "为想法，选择合适的模型。",
        "按需添加推荐模板，或导入自己的 ComfyUI 工作流。选择兼容的模型，创作图片与视频。",
      ],
      [
        "参数",
        "画面细节，自己把握。",
        "提示词、参考素材与生成参数，在同一个创作空间中调整。保留想要的结果，也试试另一个版本。",
      ],
      [
        "设备",
        "在手边创作，按需连接。",
        "使用本机 ComfyUI，或连接远程设备。画布留在手边，生成在哪里运行，由你决定。",
      ],
    ],
    startTitle: "熟悉的 ComfyUI，\n新的创作空间。",
    starts: [
      ["已有 ComfyUI？", "在设置中连接服务，添加兼容工作流，开始第一个镜头。"],
      ["先试试画布？", "新建项目，放入一张图片。先体验创作空间，需要生成时再连接服务。"],
    ],
    faqTitle: "你可能想了解",
    faq: [
      [
        "它会替代 ComfyUI 吗？",
        "TakeBoard 将图片与视频创作放进相连的画布，使用自己的 ComfyUI 执行工作流。需要修改底层节点图时，进入 ComfyUI 编辑器。TakeBoard 是独立项目，与 Comfy Org 无隶属关系。",
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
    kitTitle: "把画布分享出去。",
    kitIntro: "项目介绍、截图与交互视频，供文章、教程和评测使用。",
    kitDownload: "下载宣传素材包",
    kitRead: "阅读素材说明",
    facts: "产品事实（JSON）",
    feedbackTitle: "一起打磨下一版。",
    feedback: "分享使用反馈",
    skip: "跳到正文",
    principles: [
      ["一张画布", "图片、视频与创意相连"],
      ["自己的工作流", "推荐模板，也支持自定义"],
      ["开源，自主", "自己的模型与设备"],
    ],
    canvasTitle: "生成画面，也连接想法。",
    canvasIntro: "从一张参考图到一个镜头，用生成的结果继续创作，也在一旁尝试新的方向。",
    provenance: "演示说明",
    steps: [
      ["放入想法", "导入参考素材，写下想要的画面。"],
      ["生成画面", "选择工作流，在画布中完成生成。"],
      ["继续创作", "把结果连接到下一步，探索新的可能。"],
    ],
    modelListLabel: "推荐工作流系列示例",
    modelsNote: "模型与节点需另行安装；可用输入取决于工作流。",
    demoTitle: "看看创作如何展开。",
    demoIntro: "连接参考素材，在画布中查看生成结果。",
    downloadIntro: "选择适合你电脑的桌面版本。",
    director: {
      label: "TakeBoard 导演板",
      front: "TakeBoard 创作画布，开发版模拟输出预览。",
      back: "TakeBoard 生成结果，开发版模拟输出预览。",
      flip: "翻转导演板",
      help: "横向拖动可旋转；左右方向键调整角度，回车翻面，Esc 返回正面。",
    },
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
      "Development screenshots use simulated results, not model output. Choose an installer below to get the current beta.",
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
        "Choose a task and workflow.",
        "Choose whether to make an image or a video. Add a recommended template that matches your installed models, or import a workflow you already use in ComfyUI. Once TakeBoard reports it usable, choose it for your shot and connect the reference media it accepts. Text-only generation needs no image input.",
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
    sources: "Full getting-started guide",
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
    scope: "开发版截图使用模拟结果，非模型输出。下方下载入口提供当前测试版。",
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
        "选择创作任务与工作流。",
        "先决定生成图片还是视频。从“可添加”中选择与已安装模型匹配的模板，或导入自己在 ComfyUI 中使用的工作流。检查显示可用后，将它用于镜头，再连接支持的参考素材。文生图与文生视频可以直接从提示词开始。",
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
