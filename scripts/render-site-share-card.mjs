#!/usr/bin/env node
// Social export shares the site's palette and director-board component.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { content } from "../site/content.mjs";
import { directorBoard } from "../site/director-board.mjs";
import { escapeHtml } from "./build-public-site.mjs";

const asset = (path) => fileURLToPath(new URL(path, import.meta.url));
const data = async (path, mime) =>
  `data:${mime};base64,${(await readFile(asset(path))).toString("base64")}`;
const media = {
  front: await data("../docs/assets/takeboard-demo-cover.png", "image/png"),
  back: await data("../docs/assets/takeboard-demo-results.png", "image/png"),
  logo: await data("../apps/web/public/takeboard-icon.svg", "image/svg+xml"),
};
const css = await readFile(asset("../site/style.css"), "utf8");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}
    .social-card{width:1200px;height:630px;padding:54px 60px;position:relative;overflow:hidden}
    .social-card .brand{font-size:26px}.social-card .brand img{width:40px;height:40px}
    .social-copy{margin-top:70px;max-width:530px}.social-copy h1{font-size:56px;letter-spacing:-.05em}
    .social-copy .lead{margin-top:24px;font-size:20px;max-width:430px;line-height:1.6}
    .social-card .director-view{position:absolute;right:18px;top:85px;width:550px}
    .social-card footer{position:absolute;bottom:30px;left:60px;right:60px;border-top:1px solid var(--line);padding-top:18px;display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}
  </style></head><body><main class="social-card"><div class="brand"><img src="${media.logo}" alt="">TakeBoard</div><div class="social-copy"><p class="eyebrow">OPEN SOURCE · BUILT ON COMFYUI</p><h1>Give your ideas<br>room to unfold.</h1><p class="lead">One canvas for AI images and video.<br>Your models. Your workflows.</p></div>${directorBoard(media, content.en.director, escapeHtml)}<footer><span>Development preview · simulated outputs</span><span>fourques.github.io/Takeboard</span></footer></main></body></html>`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.decode()));
  });
  const path = asset("../site/assets/takeboard-social.png");
  await page.screenshot({ path });
  console.log(path);
} finally {
  await browser.close();
}
