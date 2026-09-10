import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "./fixtures";

test("fresh theme and explicit display choices survive reload", async ({ page, context }) => {
  await context.clearCookies({ name: "takeboard_theme" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "chroma");
  await page.getByRole("button", { name: "打开工作区选项" }).click();
  await page.getByRole("button", { name: "黑曜主题" }).click();
  await page.getByRole("button", { name: "显示大小：清晰" }).click();
  await page.getByRole("button", { name: /大字/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "noir");
  await expect(page.getByRole("button", { name: "黑曜主题" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "noir");
  await expect(page.locator("html")).toHaveAttribute("data-display-scale", "1-24");
});

test("desktop restart preserves display choices across a real port change", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  await test.step("save actual UI choices and close the original desktop page", async () => {
    await page.goto("/");
    await page.getByRole("button", { name: "打开工作区选项" }).click();
    await page.getByRole("button", { name: "显示大小：清晰" }).click();
    // Test the real low-power preference as well. The separate fresh-theme case
    // keeps default 3D rendering; restarting preferences need not repeatedly
    // compile the 3D scene on CI's software renderer.
    await page.getByRole("button", { name: "节能 始终使用清晰静态封面" }).click();
    await page.getByRole("button", { name: /大字/ }).click();
    await page.getByRole("button", { name: "黑曜主题" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "noir");
    await expect(page.locator("html")).toHaveAttribute("data-display-scale", "1-24");
    await expect(page.getByRole("img", { name: /TakeBoard 导演板静态封面/ })).toBeVisible();
    // A restart does not leave the old 3D page rendering alongside the new one.
    await page.close();
  });

  // Use a real second loopback port, not mocked preference getters. Carry only
  // persistent cookies into a fresh browser context, just like a desktop restart.
  const upstream = new URL(baseURL as string);
  const proxy = createServer((incoming, outgoing) => {
    const forwarded = httpRequest(
      new URL(incoming.url ?? "/", upstream),
      { method: incoming.method, headers: { ...incoming.headers, host: upstream.host } },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    forwarded.on("error", () => {
      outgoing.writeHead(502);
      outgoing.end();
    });
    outgoing.on("close", () => forwarded.destroy());
    incoming.pipe(forwarded);
  });
  const restarted = await browser.newContext({
    storageState: { cookies: await context.cookies(), origins: [] },
  });
  let cleanup: PromiseSettledResult<void>[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(0, "127.0.0.1", resolve);
    });
    const newPort = (proxy.address() as AddressInfo).port;
    expect(newPort).not.toBe(Number(upstream.port));
    const newPage = await restarted.newPage();
    await test.step("restore persistent cookies without carrying local storage", async () => {
      await newPage.goto(`http://127.0.0.1:${newPort}`);
      await expect(newPage.locator("html")).toHaveAttribute("data-theme", "noir");
      await expect(newPage.locator("html")).toHaveAttribute("data-display-scale", "1-24");
      await expect(newPage.getByRole("img", { name: /TakeBoard 导演板静态封面/ })).toBeVisible();
    });
    await test.step("save another theme on the new port and reload", async () => {
      await newPage.getByRole("button", { name: "打开工作区选项" }).click();
      await newPage.getByRole("button", { name: "柔彩主题" }).click();
      await newPage.reload();
      await expect(newPage.locator("html")).toHaveAttribute("data-theme", "chroma");
      await expect(newPage.locator("html")).toHaveAttribute("data-display-scale", "1-24");
      await expect(newPage.getByRole("img", { name: /TakeBoard 导演板静态封面/ })).toBeVisible();
    });
  } finally {
    proxy.closeAllConnections();
    cleanup = await Promise.allSettled([
      restarted.close(),
      new Promise<void>((resolve) => proxy.close(() => resolve())),
    ]);
    // A timed-out test may already have had its context closed by Playwright.
    // Preserve the original assertion/step failure; cleanup must still run.
  }
  for (const result of cleanup) if (result.status === "rejected") throw result.reason;
});
