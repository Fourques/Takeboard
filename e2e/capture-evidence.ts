import type { Page } from "@playwright/test";

type ScreenshotOptions = NonNullable<Parameters<Page["screenshot"]>[0]>;

export async function captureEvidence(page: Page, options: ScreenshotOptions) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.screenshot(options);
      return;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const transientCaptureFailure = message.includes(
        "Protocol error (Page.captureScreenshot): Unable to capture screenshot",
      );
      if (!transientCaptureFailure || attempt === 2) throw cause;
      await page.waitForTimeout(250 * (attempt + 1));
    }
  }
}
