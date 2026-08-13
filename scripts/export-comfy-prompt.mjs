import { chromium } from "@playwright/test";

const baseUrl = process.env.COMFY_URL ?? "http://127.0.0.1:48188";
const workflowPath = process.env.COMFY_WORKFLOW ?? "workflows/Kino/Kino_Wan22_I2V.json";
const inputImage = process.env.COMFY_INPUT;
const shouldSubmit = process.env.COMFY_SUBMIT === "1";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(5_000);

  const result = await page.evaluate(
    async ({ input, path, submit }) => {
      const response = await fetch(`/api/userdata/${encodeURIComponent(path)}`);
      if (!response.ok) {
        throw new Error(`Unable to load workflow: ${response.status}`);
      }
      const workflow = await response.json();
      const takeboardWindow = window;
      const app = takeboardWindow.app;

      if (!app) {
        throw new Error("ComfyUI app is not ready");
      }

      await app.loadGraphData(workflow);
      const prompt = await app.graphToPrompt();
      const output = prompt.output ?? {};
      if (input && output["97"]?.inputs) {
        output["97"].inputs.image = input;
      }

      let submission;
      if (submit) {
        const submitResponse = await fetch("/api/prompt", {
          body: JSON.stringify({
            client_id: `takeboard-smoke-${Date.now()}`,
            prompt: output,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        submission = await submitResponse.json();
        if (!submitResponse.ok) {
          throw new Error(`Prompt rejected: ${JSON.stringify(submission)}`);
        }
      }

      return {
        classTypes: Object.values(output).map((node) => node.class_type),
        output: submit ? undefined : output,
        promptNodeCount: Object.keys(output).length,
        submission,
        workflowNodeCount: workflow.nodes?.length ?? 0,
      };
    },
    { input: inputImage, path: workflowPath, submit: shouldSubmit },
  );

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
