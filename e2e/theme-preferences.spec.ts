import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "./fixtures";

test("fresh themes and explicit choices survive reload and desktop port changes", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
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
  try {
    await new Promise<void>((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(0, "127.0.0.1", resolve);
    });
    const newPort = (proxy.address() as AddressInfo).port;
    expect(newPort).not.toBe(Number(upstream.port));
    const newPage = await restarted.newPage();
    await newPage.goto(`http://127.0.0.1:${newPort}`);
    await expect(newPage.locator("html")).toHaveAttribute("data-theme", "noir");
    await expect(newPage.locator("html")).toHaveAttribute("data-display-scale", "1-24");
    await newPage.getByRole("button", { name: "打开工作区选项" }).click();
    await newPage.getByRole("button", { name: "柔彩主题" }).click();
    await newPage.reload();
    await expect(newPage.locator("html")).toHaveAttribute("data-theme", "chroma");
  } finally {
    await restarted.close();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});
