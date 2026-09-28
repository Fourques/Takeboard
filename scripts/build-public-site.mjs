import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { content } from "../site/content.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFile(resolve(root, path), "utf8");
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export async function buildSite(output = resolve(root, "dist/site")) {
  const product = JSON.parse(await read("site/product.json"));
  const manifest = JSON.parse(await read("docs/assets/takeboard-demo-manifest.json"));
  if (manifest.generation.realGpu !== false || product.demo.sourceCommit !== manifest.sourceCommit)
    throw new Error("Review public demo provenance before publishing");
  const key = (await read("site/indexnow-key.txt")).trim();
  if (!/^[a-f0-9]{32}$/.test(key)) throw new Error("Invalid IndexNow ownership key");
  const base = product.website;
  const docs = `${product.repository}/blob/main/docs/`;
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
      url: base,
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
<html lang="${c.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(c.title)}</title><meta name="description" content="${h(c.description)}">
<link rel="canonical" href="${url}"><link rel="alternate" hreflang="en" href="${base}"><link rel="alternate" hreflang="zh-CN" href="${base}zh/"><link rel="alternate" hreflang="x-default" href="${base}">
<meta property="og:type" content="website"><meta property="og:title" content="${h(c.title)}"><meta property="og:description" content="${h(c.description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${base}media/takeboard-demo-cover.png"><meta property="og:image:alt" content="${h(c.caption)}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${base}media/takeboard-icon.svg"><link rel="stylesheet" href="${base}style.css">
<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script></head>
<body><a class="skip" href="#main">${h(c.skip)}</a><header><a class="brand" href="${base}"><img src="${base}media/takeboard-icon.svg" alt="" width="34" height="34">TakeBoard</a><nav aria-label="${locale === "zh" ? "主导航" : "Main navigation"}"><a href="${product.repository}">GitHub</a><a href="${base}${c.switchPath}" lang="${locale === "zh" ? "en" : "zh-CN"}">${h(c.switchLabel)}</a></nav></header>
<main id="main"><div class="hero"><p class="eyebrow">${h(c.eyebrow)}</p><h1>${h(c.heading)}</h1><p class="lead">${h(c.intro)}</p><div class="actions"><a class="button primary" href="${docs}${c.downloadDoc}">${h(c.download)}</a><a class="button" href="#demo">${h(c.preview)}</a></div><p class="fine">${h(c.note)}</p><p class="fine">${h(c.releaseLabel)} · <a href="${product.evidence.release}">v${product.publicVersion}</a></p></div>
<figure><img class="canvas" src="${base}media/takeboard-demo-cover.png" width="1440" height="900" alt="${h(c.caption)}"><figcaption>${h(c.previewNote)}</figcaption></figure>
<section><h2>${h(c.featuresTitle)}</h2><div class="grid">${c.features.map(([label, title, text]) => `<article><p class="eyebrow">${h(label)}</p><h3>${h(title)}</h3><p>${h(text)}</p></article>`).join("")}</div></section>
<section id="demo" class="demo"><div><h2>${h(c.preview)}</h2><p>${h(c.previewNote)}</p><a href="${product.evidence.demo}">${locale === "zh" ? "演示范围与来源" : "Demo scope and provenance"}</a></div><video controls playsinline preload="none" poster="${base}media/takeboard-demo-results.png" aria-label="${h(c.previewNote)}"><source src="${base}media/takeboard-product-walkthrough.webm" type="video/webm"><a href="${base}media/takeboard-product-walkthrough.webm">WebM</a></video></section>
<section><h2>${h(c.startTitle)}</h2><div class="paths">${c.starts.map(([title, text]) => `<article><h3>${h(title)}</h3><p>${h(text)}</p></article>`).join("")}</div><a href="${docs}first-session.md${locale === "en" ? "#english" : ""}">${h(c.checklist)} →</a></section>
<section class="questions"><h2>${h(c.faqTitle)}</h2>${c.faq.map(([q, a]) => `<details><summary>${h(q)}</summary><p>${h(a)}</p></details>`).join("")}<a href="${product.evidence.compatibility}">${h(c.evidence)} →</a></section>
<section id="media-kit" class="kit"><h2>${h(c.kitTitle)}</h2><p>${h(c.kitIntro)}</p><div class="actions"><a class="button primary" href="${base}takeboard-media-kit.zip" download>${h(c.kitDownload)}</a><a href="${docs}media-kit.md">${h(c.kitRead)}</a><a href="${base}product.json">${h(c.facts)}</a></div></section>
<div class="feedback"><h2>${h(c.feedbackTitle)}</h2><a href="${product.repository}/issues/new?template=first_try.yml">${h(c.feedback)} →</a></div></main><footer><span>TakeBoard · Apache-2.0 · ${product.reviewedAt}</span><span>${h(c.footer)}</span></footer></body></html>`;
    await writeFile(join(output, locale === "zh" ? "zh/index.html" : "index.html"), html);
  }
  await writeFile(
    join(output, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}</loc></url><url><loc>${base}zh/</loc></url></urlset>`,
  );
  return { output, product, urls: [base, `${base}zh/`] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await buildSite();
  console.log(`Built public-only site: ${result.output}`);
}
