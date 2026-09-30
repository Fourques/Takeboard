import { directorBoard } from "./director-board.mjs";

// Shared line icons; no external icon font.
export function icon(name) {
  const paths = {
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
    canvas:
      '<rect x="3" y="4" width="7" height="7" rx="2"/><rect x="14" y="13" width="7" height="7" rx="2"/><path d="M10 7h5a3 3 0 0 1 3 3v3M6 14v6h5"/>',
    workflow:
      '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="19" r="2"/><path d="M7 6h10M6 8l5 9m7-9-5 9"/>',
    device:
      '<rect x="3" y="4" width="13" height="10" rx="2"/><path d="M9 14v4m-4 0h8"/><rect x="18" y="10" width="4" height="10" rx="1"/><path d="M20 13v1"/>',
    play: '<path d="m9 5 11 7-11 7z"/>',
    folder: '<path d="M3 7V5h7l2 3h9v12H3V7z"/>',
    code: '<path d="m7 7-5 5 5 5m10-10 5 5-5 5m-4-14-2 18"/>',
    laptop: '<rect x="5" y="3" width="14" height="13" rx="2"/><path d="m5 16-3 4h20l-3-4"/>',
    windows: '<path d="M3 4h7v7H3zm11 0h7v7h-7zM3 15h7v6H3zm11 0h7v6h-7z"/>',
    terminal: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m6 8 4 4-4 4m7 0h5"/>',
  };
  if (!paths[name]) throw new Error(`Unknown site icon: ${name}`);
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

export function header(c, product, home, alternate, h) {
  const zh = c.lang === "zh-CN";
  return `<header class="site-header"><div class="header-inner"><a class="brand" href="${home}" aria-label="TakeBoard"><img src="${product.website}media/takeboard-icon.svg" alt="" width="32" height="32"><span>TakeBoard</span></a><nav class="main-nav" aria-label="${zh ? "主导航" : "Main navigation"}"><a href="${home}#canvas">${zh ? "画布" : "Canvas"}</a><a href="${home}#workflows">${zh ? "工作流" : "Workflows"}</a><a href="${home}#download">${zh ? "下载" : "Download"}</a></nav><nav class="utility-nav" aria-label="${zh ? "资源与语言" : "Resources and language"}"><a href="${product.repository}">GitHub <span aria-hidden="true">↗</span></a><a class="language" href="${alternate}" lang="${zh ? "en" : "zh-CN"}">${h(c.switchLabel)}</a></nav></div></header>`;
}

export function footer(c, product, home, guideUrl, h) {
  const zh = c.lang === "zh-CN";
  const docs = `${product.repository}/blob/main/docs/`;
  return `<footer class="site-footer"><div class="footer-top"><div><a class="brand" href="${home}"><img src="${product.website}media/takeboard-icon.svg" alt="" width="32" height="32">TakeBoard</a><p>${zh ? "开放的画布。自己的创作。" : "An open canvas. Your creative space."}</p></div><div class="footer-group"><h2>${zh ? "产品" : "Product"}</h2><a href="${home}#download">${zh ? "下载应用" : "Get TakeBoard"}</a><a href="${guideUrl}">${zh ? "开始使用" : "Get started"}</a><a href="${product.evidence.release}">${zh ? "版本记录" : "Release notes"}</a></div><div class="footer-group"><h2>${zh ? "资源" : "Resources"}</h2><a href="${docs}README.md">${zh ? "文档" : "Documentation"}</a><a href="${product.repository}/discussions">${zh ? "社区" : "Community"}</a><a href="${docs}media-kit.md">${zh ? "媒体素材" : "Media kit"}</a></div><div class="footer-group"><h2>${zh ? "开源" : "Open source"}</h2><a href="${product.repository}">GitHub</a><a href="${product.repository}/blob/main/LICENSE">Apache-2.0</a><a href="${product.repository}/blob/main/SECURITY.md">${zh ? "安全" : "Security"}</a></div></div><div class="footer-bottom"><span>© ${h(product.reviewedAt.slice(0, 4))} TakeBoard</span></div></footer>`;
}

export function homeBody(c, product, guideUrl, h, installerUrl) {
  const base = product.website;
  const zh = c.lang === "zh-CN";
  const home = `${base}${zh ? "zh/" : ""}`;
  const docs = `${product.repository}/blob/main/docs/`;
  const sectionTitle = (title) => `<div class="section-heading"><h2>${h(title)}</h2></div>`;
  return `<body><a class="skip" href="#main">${h(c.skip)}</a>${header(c, product, home, `${base}${c.switchPath}`, h)}
<main id="main"><section class="hero shell" aria-labelledby="hero-title"><div class="hero-copy"><p class="eyebrow"><span class="status-dot"></span>${h(c.eyebrow)}</p><h1 id="hero-title">${c.heading.split("\n").map(h).join("<br>")}</h1><p class="lead">${h(c.intro)}</p><div class="actions"><a class="button primary" href="#download">${h(c.download)}${icon("arrow")}</a><a class="text-link" href="#demo">${icon("play")}${h(c.preview)}</a></div><p class="hero-meta"><a href="${product.evidence.release}">v${h(product.publicVersion)}</a><span>macOS / Windows / Linux</span></p></div>${directorBoard({ front: `${base}media/takeboard-demo-cover.png`, back: `${base}media/takeboard-demo-results.png`, logo: `${base}media/takeboard-icon.svg` }, c.director, h)}</section>
<div class="principles shell">${c.principles.map(([title, text], i) => `<div>${icon(["canvas", "workflow", "code"][i])}<span>${h(title)}</span><small>${h(text)}</small></div>`).join("")}</div>
<section id="canvas" class="product-section shell">${sectionTitle(c.canvasTitle)}<p class="section-intro">${h(c.canvasIntro)}</p><figure class="product-window"><img class="canvas" src="${base}media/takeboard-demo-cover.png" width="1440" height="900" loading="lazy" alt="${h(c.caption)}"><figcaption>${h(c.previewNote)} <a href="${product.evidence.demo}">${h(c.provenance)}</a></figcaption></figure><div class="creative-steps">${c.steps.map(([name, desc], i) => `<div><span class="step-number">0${i + 1}</span><h3>${h(name)}</h3><p>${h(desc)}</p></div>`).join("")}</div></section>
<section id="workflows" class="workflow-section shell">${sectionTitle(c.featuresTitle)}<div class="feature-grid"><article class="feature-card workflow-card"><div class="feature-icon">${icon("workflow")}</div><h3>${h(c.features[0][1])}</h3><p>${h(c.features[0][2])}</p><div class="model-list" aria-label="${h(c.modelListLabel)}">${["Qwen Image", "MiniMax H3", "Wan 2.2", "LTX 2.3"].map((name) => `<span>${name}</span>`).join("")}</div><p class="fine">${h(c.modelsNote)}</p></article><article class="feature-card"><div class="feature-icon">${icon("canvas")}</div><h3>${h(c.features[1][1])}</h3><p>${h(c.features[1][2])}</p><div class="formats" aria-hidden="true"><span class="format-square"></span><span class="format-portrait"></span><span class="format-landscape"></span></div></article><article class="feature-card"><div class="feature-icon">${icon("device")}</div><h3>${h(c.features[2][1])}</h3><p>${h(c.features[2][2])}</p><div class="device-path" aria-hidden="true">${icon("laptop")}<span></span>${icon("terminal")}</div></article></div></section>
<section id="demo" class="demo-section shell"><div class="demo-copy"><h2>${h(c.demoTitle)}</h2><p>${h(c.demoIntro)}</p><p class="fine">${h(c.previewNote)}</p><a class="text-link" href="${product.evidence.demo}">${h(c.provenance)}${icon("arrow")}</a></div><div class="video-stage"><video controls playsinline preload="none" poster="${base}media/takeboard-demo-results.png" aria-label="${h(c.previewNote)}"><source src="${base}media/takeboard-product-walkthrough.webm" type="video/webm"><a href="${base}media/takeboard-product-walkthrough.webm">WebM</a></video></div></section>
<section id="download" class="download-section"><div class="shell"><div class="download-heading"><div><h2>${h(c.downloadTitle)}</h2><p>${h(c.downloadIntro)}</p></div><a class="release-badge" href="${product.evidence.release}"><span class="status-dot"></span>v${h(product.publicVersion)}</a></div><div class="download-platforms">${[
    "macOS",
    "Windows",
    "Debian/Ubuntu",
  ]
    .map(
      (platform, i) =>
        `<article class="platform"><div class="platform-heading">${icon(["laptop", "windows", "terminal"][i])}<h3>${h(platform)}</h3></div>${product.installers
          .filter((item) => item.platform === platform)
          .map(
            (item) =>
              `<a class="download-card" href="${installerUrl(product, item.file)}"><span>${h(item.label.split(" · ")[1].replace("Apple silicon", zh ? "Apple 芯片" : "Apple silicon"))}<small>${h(item.file.split(".").at(-1).toUpperCase())}</small></span>${icon("download")}</a>`,
          )
          .join("")}</article>`,
    )
    .join(
      "",
    )}</div><div class="download-notes"><p>${h(c.downloadNote)}</p><a href="${docs}${c.downloadDoc}">${h(c.installGuide)} →</a></div></div></section>
<section class="start-section shell"><div><h2>${h(c.startTitle)}</h2><a class="text-link start-guide" href="${guideUrl}">${h(c.guideLink)}${icon("arrow")}</a></div><div class="start-paths">${c.starts.map(([title, text]) => `<article><h3>${h(title)}</h3><p>${h(text)}</p></article>`).join("")}</div></section>
<section class="questions shell"><div><h2>${h(c.faqTitle)}</h2><a class="text-link" href="${product.evidence.compatibility}">${h(c.evidence)}${icon("arrow")}</a></div><div class="faq-list">${c.faq.map(([q, a]) => `<details><summary>${h(q)}<span aria-hidden="true">+</span></summary><p>${h(a)}</p></details>`).join("")}</div></section>
<section id="media-kit" class="resource-section shell"><div><h2>${h(c.kitTitle)}</h2><p>${h(c.kitIntro)}</p></div><div class="resource-links"><a href="${base}takeboard-media-kit.zip" download>${icon("folder")}${h(c.kitDownload)}${icon("arrow")}</a><a href="${docs}media-kit.md">${h(c.kitRead)}${icon("arrow")}</a><a href="${base}product.json">${h(c.facts)}${icon("arrow")}</a></div></section><div class="feedback shell"><span>${h(c.feedbackTitle)}</span><a href="${product.repository}/issues/new?template=first_try.yml">${h(c.feedback)} ↗</a></div></main>${footer(c, product, home, guideUrl, h)}</body>`;
}
