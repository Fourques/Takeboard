import { chromium } from "@playwright/test";

const baseUrl = process.env.TAKEBOARD_URL ?? "http://127.0.0.1:48220";
const projectTitle = process.env.TAKEBOARD_PROJECT_TITLE ?? "TakeBoard 4090 首个真实项目";
const output = process.env.TAKEBOARD_SCREENSHOT ?? "test-results/takeboard-4090-real-take.png";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
try {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
  const closeCreate = page.getByRole("button", { name: "关闭新建项目" });
  if (await closeCreate.isVisible()) await closeCreate.click();
  await page.getByText(projectTitle, { exact: true }).click();
  await page.getByText("CANDIDATE", { exact: true }).waitFor({ timeout: 20_000 });
  await page.screenshot({ path: output, fullPage: true });
  const summary = await page.evaluate(() => ({
    title: document.querySelector(".project-heading strong")?.textContent,
    worker: document.querySelector(".sidebar-bottom div")?.textContent?.trim(),
    candidates: document.querySelectorAll(".candidate-card").length,
    videos: document.querySelectorAll(".candidate-card video").length,
  }));
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} finally {
  await browser.close();
}
