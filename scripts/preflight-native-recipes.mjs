import {
  buildLtx23I2VPrompt,
  buildMiniMaxH3Prompt,
  buildWan22FirstLastPrompt,
  ComfyClient,
} from "../packages/executor-comfy/dist/index.js";

const comfyUrl = process.env.COMFY_URL ?? "http://127.0.0.1:8188";
const comfy = new ComfyClient(comfyUrl);
const shared = {
  positivePrompt: "TakeBoard native Recipe preflight",
  width: 480,
  height: 848,
  durationSeconds: 5,
  fps: 16,
  seed: 1,
  filenamePrefix: "takeboard/preflight/never-submit",
};

const ltxWorkflow = await comfy.workflow("Kino/Kino_LTX23_I2V_Draft.json");
const recipes = {
  "wan22-flf2v": buildWan22FirstLastPrompt({
    ...shared,
    image: "preflight-start.png",
    lastImage: "preflight-end.png",
  }),
  "minimax-h3-t2v": buildMiniMaxH3Prompt({ ...shared, fps: 24, steps: 20 }),
  "ltx23-i2v-draft": buildLtx23I2VPrompt(ltxWorkflow, {
    ...shared,
    image: "preflight-start.png",
    fps: 25,
  }),
};

const results = Object.fromEntries(
  await Promise.all(
    Object.entries(recipes).map(async ([name, prompt]) => [
      name,
      await comfy.preflightPrompt(prompt),
    ]),
  ),
);
console.log(JSON.stringify(results, null, 2));
if (Object.values(results).some((errors) => errors.length > 0)) process.exitCode = 1;
