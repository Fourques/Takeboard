#!/usr/bin/env node
// Rebuild the original brand card, not a fabricated product screenshot.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const asset = (path) => fileURLToPath(new URL(path, import.meta.url));
const svg = async (path) =>
  `data:image/svg+xml;base64,${(await readFile(asset(path))).toString("base64")}`;
const art = await svg("../site/assets/canvas-study.svg");
const logo = await svg("../apps/web/public/takeboard-icon.svg");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#f7f6f2;color:#232823;font-family:Arial,sans-serif}
    main{width:1200px;height:630px;padding:54px 64px;position:relative;overflow:hidden}
    header{display:flex;align-items:center;gap:12px;font-size:27px;font-weight:600;letter-spacing:-1px}
    header img{width:44px;height:44px}p{margin:0}.eyebrow{margin-top:62px;color:#756038;font-size:14px;letter-spacing:2px}
    h1{font-size:62px;line-height:1.08;letter-spacing:-3px;font-weight:600;margin:24px 0;max-width:550px}
    .sub{font-size:23px;line-height:1.5;max-width:470px;color:#62665d}.art{position:absolute;right:12px;top:73px;width:600px;height:auto}
    footer{position:absolute;bottom:42px;left:64px;right:64px;border-top:1px solid #ddded5;padding-top:20px;display:flex;justify-content:space-between;font-size:14px;color:#62665d}
  </style></head><body><main><header><img src="${logo}" alt="">TakeBoard</header><p class="eyebrow">OPEN SOURCE · BUILT ON COMFYUI</p><h1>One canvas.<br>More possibilities.</h1><p class="sub">Create AI images and video<br>with your own models and workflows.</p><img class="art" src="${art}" alt="Original canvas illustration"><footer><span>macOS / Windows / Linux</span><span>fourques.github.io/Takeboard</span></footer></main></body></html>`);
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
