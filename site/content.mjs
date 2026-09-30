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
    downloadTitle: "Choose your computer.",
    downloadNote:
      "Beta installers include the app runtime, not ComfyUI or models. Apple notarization and commercial Windows signing are still pending.",
    installGuide: "Installation and opening help",
    guideLink: "A practical guide to references and generation records",
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
    downloadTitle: "选择你的电脑，下载一个安装包。",
    downloadNote:
      "测试版包含应用运行时，不包含 ComfyUI 或模型。Apple 公证与 Windows 商业签名尚未完成。",
    installGuide: "安装与首次打开说明",
    guideLink: "如何整理参考素材与生成记录",
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

// One useful tutorial in two languages, not keyword-specific copies of a landing page.
export const guideContent = {
  en: {
    lang: "en",
    title: "Organize ComfyUI references and generation records — TakeBoard guide",
    description:
      "A practical first-session guide to keeping ComfyUI inputs, prompts and generated takes in a project. Includes a no-GPU trial and workflow compatibility checks.",
    heading: "Find the inputs behind a result.",
    intro:
      "A preview tells you what you made. A useful project also tells you which reference, prompt and settings led to it. This guide walks through that distinction in TakeBoard.",
    scope:
      "Maintainer-written guide · public beta.17 · development screenshots show simulated results, not model output. Newer main UI may differ from the installer.",
    switchLabel: "简体中文",
    back: "TakeBoard",
    sections: [
      [
        "01",
        "Try organization before connecting a GPU.",
        "Create a disposable project and check its save location. Import a non-private image, move its node and find it in the asset library. Close and reopen the project: the image and its placement should still be there. This tests project organization, not generation; no ComfyUI or account is needed.",
      ],
      [
        "02",
        "Check what a workflow actually accepts.",
        "For a first generation, use a workflow that already runs in your own ComfyUI. In TakeBoard, check that its dependencies and input bindings are ready. Connect the supported inputs, then inspect the names of the connected assets before submitting. A visible line or an @ mention is not proof that a model supports that reference.",
      ],
      [
        "03",
        "Keep the attempt, not just the filename.",
        "After the task completes, open its result and generation record. Check the prompt, final seed, workflow, parameters and input assets saved with that attempt. A reused filename is not a reliable identity; use the saved result and its source references. Missing records or inputs should be reported, not reconstructed by guessing.",
      ],
      [
        "04",
        "Test the return trip.",
        "Reopen the project, locate the result and check that you can still inspect its inputs and settings. Export the media you want to use elsewhere, while keeping the project and a backup for its context. Saved parameters aid reproduction; changing model files, nodes or software can still change a rerun.",
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
    title: "如何整理 ComfyUI 参考素材与生成记录 — TakeBoard 使用指南",
    description:
      "从无 GPU 的项目整理测试，到检查输入绑定、查看提示词和种子、重新打开项目找回结果。TakeBoard 首次使用指南与工作流排查。",
    heading: "找到结果，也找到它的来路。",
    intro:
      "预览能告诉你生成了什么。一个可继续创作的项目，还需要保留用了哪份素材、什么提示词和哪些参数。这份指南带你在 TakeBoard 中检查这条链路。",
    scope:
      "维护者编写 · 公开版本 beta.17 · 开发版截图为模拟结果，非模型输出。main 的新界面可能与安装包不同。",
    switchLabel: "English",
    back: "TakeBoard",
    sections: [
      [
        "01",
        "先验证项目整理，不急着连接显卡。",
        "新建一个临时测试项目，确认保存位置。导入不含隐私的图片，移动节点，在资产库中找回它。关闭再打开项目，检查图片与位置是否保留。这一步只验证整理和保存，不进行生成，无需 ComfyUI 或账号。",
      ],
      [
        "02",
        "确认工作流真正接受什么输入。",
        "第一次生成，先使用一份在自己的 ComfyUI 中已经跑通的工作流。在 TakeBoard 中检查依赖与输入绑定，连接它支持的素材，提交前核对已连接的素材名称。有一根线，或提示词里有一个 @ 引用，不代表模型就支持这类参考输入。",
      ],
      [
        "03",
        "保留这次尝试，不只记文件名。",
        "任务完成后，打开结果与生成记录，核对这次保存的提示词、最终种子、工作流、参数和输入素材。同名文件不能可靠区分来源，应以保存的结果和素材引用为准。如果记录或输入缺失，请反馈，不要靠猜测还原。",
      ],
      [
        "04",
        "检查下次回来能否继续。",
        "重新打开项目，定位结果，确认仍能查看输入和参数。把需要的媒体导出到其他工具，同时保留项目及备份，以免丢失创作上下文。保存参数有助于复现，但更换模型文件、节点或软件版本后，重新生成仍可能得到不同结果。",
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
