import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { content, guideContent } from "../site/content.mjs";
import { footer, header, homeBody } from "../site/presentation.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFile(resolve(root, path), "utf8");
// Public ownership tag supplied by the site owner; keep it across deployments.
const googleSiteVerification = "p9K6gs2ufn_xckxL_UKIuCShYn1gYmtibd3vjU6xJNM";
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export function installerUrl(product, file) {
  if (
    !/^TakeBoard_[0-9A-Za-z.-]+_(?:aarch64|x64|arm64|amd64)(?:-setup)?\.(?:dmg|exe|deb)$/.test(
      file,
    ) ||
    !file.startsWith(`TakeBoard_${product.publicVersion}_`)
  )
    throw new Error("Installer must belong to the documented public release");
  return `${product.repository}/releases/download/v${product.publicVersion}/${file}`;
}

function head(c, product, url, alternatives, schema) {
  const h = escapeHtml;
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="google-site-verification" content="${h(googleSiteVerification)}">
<title>${h(c.title)}</title><meta name="description" content="${h(c.description)}">
<link rel="canonical" href="${url}"><link rel="alternate" hreflang="en" href="${alternatives.en}"><link rel="alternate" hreflang="zh-CN" href="${alternatives.zh}"><link rel="alternate" hreflang="x-default" href="${alternatives.en}">
<meta property="og:site_name" content="TakeBoard"><meta property="og:locale" content="${c.lang === "zh-CN" ? "zh_CN" : "en_US"}"><meta property="og:type" content="${schema["@type"] === "TechArticle" ? "article" : "website"}"><meta property="og:title" content="${h(c.title)}"><meta property="og:description" content="${h(c.description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${product.website}media/takeboard-social.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${c.lang === "zh-CN" ? "TakeBoard：基于 ComfyUI 的开源 AI 创作画布，原创品牌插画" : "TakeBoard: open-source AI creation canvas on ComfyUI, original brand illustration"}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${product.website}media/takeboard-icon.svg"><link rel="stylesheet" href="${product.website}style.css">
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script>`;
}

export async function buildSite(output = resolve(root, "dist/site")) {
  const product = JSON.parse(await read("site/product.json"));
  const manifest = JSON.parse(await read("docs/assets/takeboard-demo-manifest.json"));
  if (manifest.generation.realGpu !== false || product.demo.sourceCommit !== manifest.sourceCommit)
    throw new Error("Review public demo provenance before publishing");
  const key = (await read("site/indexnow-key.txt")).trim();
  if (!/^[a-f0-9]{32}$/.test(key)) throw new Error("Invalid IndexNow ownership key");
  const base = product.website;
  const docs = `${product.repository}/blob/main/docs/`;
  if (product.installers.length !== 6 || new Set(product.installers.map((i) => i.file)).size !== 6)
    throw new Error("Review the six distinct public installers before publishing");
  const guidePath = "guides/organize-comfyui-results/";
  const guideUrls = { en: `${base}${guidePath}`, zh: `${base}zh/${guidePath}` };
  const assetNames = [
    "takeboard-demo-cover.png",
    "takeboard-demo-results.png",
    "takeboard-product-walkthrough.webm",
    "takeboard-demo-manifest.json",
  ];
  await mkdir(join(output, "media"), { recursive: true });
  await mkdir(join(output, "zh"), { recursive: true });
  for (const name of assetNames) {
    const source = resolve(root, "docs/assets", name);
    const evidence =
      Object.values(manifest.files).find((entry) => entry.name === name) ??
      (name.endsWith("cover.png")
        ? manifest.files.cover
        : name.endsWith("results.png")
          ? manifest.files.results
          : null);
    if (
      evidence &&
      createHash("sha256")
        .update(await readFile(source))
        .digest("hex") !== evidence.sha256
    )
      throw new Error(`Media hash mismatch: ${name}`);
    await copyFile(source, join(output, "media", name));
  }
  await copyFile(
    resolve(root, "apps/web/public/takeboard-icon.svg"),
    join(output, "media/takeboard-icon.svg"),
  );
  await copyFile(
    resolve(root, "site/assets/canvas-study.svg"),
    join(output, "media/canvas-study.svg"),
  );
  await copyFile(
    resolve(root, "site/assets/takeboard-social.png"),
    join(output, "media/takeboard-social.png"),
  );
  await copyFile(resolve(root, "site/style.css"), join(output, "style.css"));
  await copyFile(resolve(root, "site/product.json"), join(output, "product.json"));
  // Turn repository-relative links into absolute links so downloaded Markdown remains usable.
  const kit = (await read("docs/media-kit.md")).replace(
    /\]\((?!https?:|#)([^)]+)\)/g,
    (_, path) => `](${new URL(path, docs).href})`,
  );
  await writeFile(join(output, "media/README.md"), kit);
  await copyFile(resolve(root, "LICENSE"), join(output, "media/LICENSE"));
  await copyFile(resolve(root, "site/product.json"), join(output, "media/product.json"));
  await writeFile(join(output, `${key}.txt`), key);
  await writeFile(join(output, ".nojekyll"), "");
  for (const [locale, c] of Object.entries(content)) {
    const url = `${base}${locale === "zh" ? "zh/" : ""}`;
    const schema = {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: product.name,
      url,
      inLanguage: c.lang,
      applicationCategory: "MultimediaApplication",
      operatingSystem: product.platforms.join(", "),
      softwareVersion: product.publicVersion,
      license: `${product.repository}/blob/main/LICENSE`,
      description: c.description,
      sameAs: [product.repository],
      downloadUrl: `${docs}${c.downloadDoc}`,
      softwareRequirements: c.note,
    };
    const h = escapeHtml;
    const html = `<!doctype html>
<html lang="${c.lang}"><head>${head(c, product, url, { en: base, zh: `${base}zh/` }, schema)}</head>
${homeBody(c, product, guideUrls[locale], h, installerUrl)}</html>`;
    await writeFile(join(output, locale === "zh" ? "zh/index.html" : "index.html"), html);
  }
  for (const [locale, c] of Object.entries(guideContent)) {
    const h = escapeHtml;
    const home = `${base}${locale === "zh" ? "zh/" : ""}`;
    const url = guideUrls[locale];
    const directory = join(output, locale === "zh" ? "zh" : "", guidePath);
    await mkdir(directory, { recursive: true });
    const schema = {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      headline: c.title,
      description: c.description,
      url,
      inLanguage: c.lang,
      dateModified: product.reviewedAt,
      author: { "@type": "Organization", name: "TakeBoard maintainers", url: product.repository },
      about: { "@type": "SoftwareApplication", name: product.name, url: base },
    };
    const html = `<!doctype html>
<html lang="${c.lang}"><head>${head(c, product, url, guideUrls, schema)}</head><body>
<a class="skip" href="#main">${h(c.skip)}</a>${header(c, product, home, guideUrls[locale === "en" ? "zh" : "en"], h)}
<main id="main" class="guide"><article><div class="hero"><p class="eyebrow">TAKEBOARD / ${locale === "zh" ? "使用指南" : "PRACTICAL GUIDE"}</p><h1>${h(c.heading)}</h1><p class="lead">${h(c.intro)}</p><p class="fine">${h(c.scope)}</p><div class="actions"><a class="button primary" href="${home}#download">${h(c.download)}</a><a href="${docs}${content[locale].downloadDoc}">${h(c.install)}</a></div></div>
${c.sections.map(([number, title, text]) => `<section class="guide-step"><p class="eyebrow">${number}</p><h2>${h(title)}</h2><p>${h(text)}</p></section>`).join("")}
<figure class="guide-figure"><img class="canvas" src="${base}media/takeboard-demo-results.png" width="1440" height="900" alt="${h(c.resultCaption)}"><figcaption>${h(c.resultCaption)}</figcaption></figure>
<section><h2>${h(c.checklistTitle)}</h2><ul class="checklist">${c.checklist.map((item) => `<li>${h(item)}</li>`).join("")}</ul><a href="${docs}first-session.md${locale === "en" ? "#english" : ""}">${h(c.sources)} →</a></section>
<section><h2>${h(c.troubleshootingTitle)}</h2>${c.troubleshooting.map(([title, text]) => `<div class="guide-issue"><h3>${h(title)}</h3><p>${h(text)}</p></div>`).join("")}</section>
<section class="feedback"><h2>${h(c.feedbackTitle)}</h2><p>${h(c.feedbackText)}</p><a class="button primary" href="${product.repository}/issues/new?template=first_try.yml">${h(c.feedback)}</a></section></article></main>
${footer(c, product, home, url, h)}</body></html>`;
    await writeFile(join(directory, "index.html"), html);
  }
  const urls = [base, `${base}zh/`, guideUrls.en, guideUrls.zh];
  await writeFile(
    join(output, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${url}</loc></url>`).join("")}</urlset>`,
  );
  return { output, product, urls };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await buildSite();
  console.log(`Built public-only site: ${result.output}`);
}
