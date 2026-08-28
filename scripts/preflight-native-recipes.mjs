import {
  buildLtx23I2VPrompt,
  buildMiniMaxH3Prompt,
  buildMiniMaxH3ReferencePrompt,
  buildQwenImage2512Prompt,
  buildWan22FirstLastPrompt,
  buildWan22I2VPrompt,
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
  "qwen-image-2512-t2i": buildQwenImage2512Prompt({
    positivePrompt: shared.positivePrompt,
    width: 928,
    height: 1664,
    seed: 1,
    steps: 50,
    filenamePrefix: shared.filenamePrefix,
  }),
  "qwen-image-2512-i2i-lightning": buildQwenImage2512Prompt({
    image: "preflight-start.png",
    positivePrompt: shared.positivePrompt,
    width: 928,
    height: 1664,
    seed: 1,
    steps: 4,
    denoise: 0.65,
    filenamePrefix: shared.filenamePrefix,
  }),
  "wan22-flf2v": buildWan22FirstLastPrompt({
    ...shared,
    image: "preflight-start.png",
    lastImage: "preflight-end.png",
  }),
  "wan22-i2v-quality": buildWan22I2VPrompt({
    ...shared,
    image: "preflight-start.png",
    steps: 20,
    qualityProfile: "quality",
  }),
  "wan22-i2v-preview": buildWan22I2VPrompt({
    ...shared,
    image: "preflight-start.png",
    qualityProfile: "preview",
  }),
  "minimax-h3-t2v": buildMiniMaxH3Prompt({ ...shared, fps: 24, steps: 20 }),
  "minimax-h3-ref2va": buildMiniMaxH3ReferencePrompt({
    ...shared,
    fps: 24,
    steps: 20,
    referenceImages: ["preflight-reference.png"],
    referenceVideos: ["preflight-reference.mp4"],
    referenceAudios: ["preflight-reference.wav"],
  }),
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
