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

async function newPage(width, height, options = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: "reduce",
    ...options,
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
        ".mjs": "text/javascript",
      };
      await route.fulfill({
        body: await readFile(file),
        contentType: types[extname(file)] ?? "application/octet-stream",
      });
    });
  }
  return page;
}

async function checkDirector(page, label) {
  const stage = page.locator(".director-stage");
  const board = page.locator(".director-board");
  const front = page.locator(".slate-front");
  const back = page.locator(".slate-back");
  await page.locator(".director-flip").waitFor({ state: "visible" });
  const angle = () =>
    board.evaluate((el) => Number.parseFloat(el.style.getPropertyValue("--turn")));
  await stage.focus();
  await stage.press("Home");
  assert.equal(await angle(), 0);
  await stage.press("Enter");
  assert.equal(await back.getAttribute("aria-hidden"), "false");
  assert.equal(await front.getAttribute("aria-hidden"), "true");
  await page.screenshot({ path: join(output, `${label}-back.png`) });
  await page.locator(".director-flip").click();
  assert.equal(await front.getAttribute("aria-hidden"), "false");
  await stage.press("Home");
  const box = await stage.boundingBox();
  for (let i = 0; i < 2; i++) {
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.45, { steps: 14 });
    await page.mouse.up();
  }
  assert.ok((await angle()) > 360, "Dragging should rotate through a full turn, not just tilt");
  assert.equal(await page.locator(".is-dragging").count(), 0);
  await stage.press("Escape");
  assert.equal(await angle(), 0);
  await stage.press("ArrowRight");
  assert.equal(await angle(), 30);
  // Keyboard modifiers must not steal browser shortcuts.
  await stage.press("Alt+ArrowRight");
  assert.equal(await angle(), 30);
  await stage.press("Escape");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 400);
  await page.waitForFunction((y) => scrollY > y, before);
  assert.equal(await angle(), 0, "Wheel scroll must never rotate the board");
  await ready(page);
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
        await checkDirector(page, label);
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
  const touch = await newPage(390, 844, { hasTouch: true, isMobile: true });
  await touch.goto(`${base}zh/`, { waitUntil: "load" });
  await touch.locator(".director-stage").scrollIntoViewIfNeeded();
  const area = await touch.locator(".director-stage").boundingBox();
  const cdp = await touch.context().newCDPSession(touch);
  const swipe = async (dx, dy) => {
    const x = area.x + area.width * 0.25;
    const y = area.y + area.height * 0.65;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 1; step <= 12; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * step) / 12, y: y + (dy * step) / 12 }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const touchAngle = () =>
    touch
      .locator(".director-board")
      .evaluate((el) => Number.parseFloat(el.style.getPropertyValue("--turn")));
  await swipe(150, 0);
  assert.ok((await touchAngle()) > 100, `Touch rotation: ${await touchAngle()}`);
  const heldAngle = await touchAngle();
  const startScroll = await touch.evaluate(() => scrollY);
  await swipe(0, -150);
  await touch.waitForFunction((y) => scrollY > y, startScroll);
  assert.equal(await touchAngle(), heldAngle);
  assert.equal(await touch.locator(".is-dragging").count(), 0);
  await touch.context().close();
  console.log("Touch: horizontal rotation and native vertical scrolling passed");

  const staticPage = await newPage(390, 844, { javaScriptEnabled: false });
  await staticPage.goto(base, { waitUntil: "load" });
  assert.equal(await staticPage.locator(".director-flip").isVisible(), false);
  assert.equal(await staticPage.locator(".slate-front .slate-capture").isVisible(), true);
  await staticPage.locator('.hero a[href="#download"]').click();
  assert.equal(new URL(staticPage.url()).hash, "#download");
  assert.equal(await staticPage.locator(".download-card").count(), 6);
  await staticPage.context().close();
  console.log("No JavaScript: product image, navigation and downloads remain usable");
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}
