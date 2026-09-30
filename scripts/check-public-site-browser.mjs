#!/usr/bin/env node
// Isolated website acceptance; never opens the app or starts a generation service.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

const base = "https://fourques.github.io/Takeboard/";
const guide = "guides/organize-comfyui-results/";
const local = process.argv.includes("--local");
const root = fileURLToPath(new URL("../dist/site/", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "takeboard-site-acceptance-"));
console.log(`Screenshots: ${output}`);
const browser = await chromium.launch({ headless: true });
const errors = [];

async function ready(page) {
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
    overflowing: Array.from(document.querySelectorAll("body *"))
      .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 15)
      .map((el) => ({ tag: el.tagName, class: el.className, text: el.textContent.slice(0, 60) })),
  }));
  assert.ok(size.content <= size.viewport, `Horizontal overflow: ${JSON.stringify(size)}`);
}

async function newPage(width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(error.message));
  if (local) {
    await page.route(`${base}**`, async (route) => {
      const path = decodeURIComponent(
        new URL(route.request().url()).pathname.slice("/Takeboard/".length),
      );
      const file = resolve(root, path.endsWith("/") || !path ? `${path}index.html` : path);
      assert.ok(file.startsWith(resolve(root) + sep));
      const types = {
        ".html": "text/html",
        ".css": "text/css",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".webm": "video/webm",
      };
      await route.fulfill({
        body: await readFile(file),
        contentType: types[extname(file)] ?? "application/octet-stream",
      });
    });
  }
  return page;
}

try {
  for (const locale of ["", "zh/"]) {
    for (const width of [320, 390, 768, 1280, 1440]) {
      const page = await newPage(width, 900);
      const label = `${locale ? "zh" : "en"}-${width}`;
      await page.goto(base + locale, { waitUntil: "load", timeout: 30_000 });
      await ready(page);
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(await page.locator(".download-card").count(), 6);
      // All rendered internal anchors must resolve, including navigation from guide pages.
      assert.deepEqual(
        await page.evaluate(() =>
          Array.from(document.links)
            .filter(
              (a) => a.origin === location.origin && a.pathname === location.pathname && a.hash,
            )
            .filter((a) => !document.getElementById(decodeURIComponent(a.hash.slice(1))))
            .map((a) => a.href),
        ),
        [],
      );
      if (width === 1440 || width === 390) {
        await page.screenshot({ path: join(output, `${label}-hero.png`) });
        await page.screenshot({ path: join(output, `${label}-full.png`), fullPage: true });
      }
      await page.locator('.hero a[href="#download"]').click();
      assert.equal(new URL(page.url()).hash, "#download");
      assert.ok(
        await page.locator("#download").evaluate((el) => {
          const box = el.getBoundingClientRect();
          return box.top < innerHeight && box.bottom > 0;
        }),
      );
      if (width === 1440) {
        await page.screenshot({ path: join(output, `${label}-downloads.png`) });
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        assert.deepEqual(
          results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
          [],
        );
        const summary = page.locator("summary").first();
        await summary.focus();
        await page.keyboard.press("Enter");
        assert.equal(await page.locator("details").first().getAttribute("open"), "");
        await page.keyboard.press("Enter");
        assert.equal(await page.locator("details").first().getAttribute("open"), null);
        await page.locator("video").evaluate((video) => video.play());
        await page.waitForFunction(() => document.querySelector("video").currentTime > 0);
        await page.locator("video").evaluate((video) => video.pause());
      }
      // Text enlarged independently of viewport; catch fixed-size clipping.
      if (width === 320 || width === 1280) {
        await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
        await ready(page);
      }
      await page.locator(".start-guide").click();
      await ready(page);
      assert.equal(page.url(), base + locale + guide);
      assert.equal(await page.locator(".guide-step").count(), 4);
      if (width === 1440) {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        assert.deepEqual(
          results.violations.map((v) => v.id),
          [],
        );
      }
      const other = locale ? "" : "zh/";
      await page.locator(".language").click();
      await ready(page);
      assert.equal(page.url(), base + other + guide);
      console.log(`${label}: layout, downloads, guide and language navigation passed`);
      await page.context().close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
