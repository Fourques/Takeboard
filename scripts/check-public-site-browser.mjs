#!/usr/bin/env node
// Manual public-site acceptance: isolated browser, no app login or real generation.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const base = "https://fourques.github.io/Takeboard/";
const guide = "guides/organize-comfyui-results/";
const output = await mkdtemp(join(tmpdir(), "takeboard-site-acceptance-"));
const browser = await chromium.launch({ headless: true });

async function ready(page) {
  // DOMContentLoaded does not wait for stylesheets on a page without deferred scripts.
  // Measuring an unstyled 1440px image would report a false mobile overflow.
  await page.waitForFunction(
    () => getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() !== "",
    {},
    { timeout: 15_000 },
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(resolveFrame)),
    );
  });
  const size = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert.ok(size.content <= size.viewport, `Horizontal overflow: ${JSON.stringify(size)}`);
}

try {
  const desktop = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  desktop.setDefaultTimeout(15_000);
  await desktop.goto(`${base}zh/`, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await ready(desktop);
  await desktop.getByRole("link", { name: "下载测试版", exact: true }).click();
  assert.equal(await desktop.locator(".download-card").count(), 6);
  await desktop.screenshot({ path: join(output, "desktop-downloads.png") });
  await desktop.getByRole("link", { name: "如何整理参考素材与生成记录 →", exact: true }).click();
  await ready(desktop);
  assert.equal(desktop.url(), `${base}zh/${guide}`);
  assert.equal(await desktop.locator(".guide-step").count(), 4);
  console.log("Desktop: download section and practical-guide navigation passed.");
  await desktop.close();

  for (const [name, url] of [
    ["mobile-guide", `${base}zh/${guide}`],
    ["mobile-downloads", `${base}zh/#download`],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(15_000);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await ready(page);
    await page.screenshot({ path: join(output, `${name}.png`) });
    if (name === "mobile-guide") {
      await page.getByRole("link", { name: "English", exact: true }).click();
      await ready(page);
      assert.equal(page.url(), `${base}${guide}`);
      assert.equal(
        await page
          .getByRole("link", { name: "Send first-session feedback", exact: true })
          .getAttribute("href"),
        "https://github.com/Fourques/Takeboard/issues/new?template=first_try.yml",
      );
    } else {
      assert.equal(await page.locator(".download-card").count(), 6);
      assert.ok(
        await page.getByRole("link", { name: "安装与首次打开说明 →", exact: true }).isVisible(),
      );
    }
    console.log(`${name}: layout and links passed.`);
    await page.close();
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
