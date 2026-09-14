import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = (
  await readFile(
    new URL("../deploy/comfyui-takeboard-bridge/js/takeboard-workflow-bridge.js", import.meta.url),
    "utf8",
  )
).replace(/^import .+;\n/gm, "");

async function open(
  document,
  path = "Kino/TakeBoard/version/Kino_MinimaxH3_T2V.json",
  apiSupported = true,
) {
  let extension;
  const calls = [];
  const app = {
    registerExtension(value) {
      extension = value;
    },
    async loadGraphData(value) {
      calls.push(["graph", value]);
    },
    ...(apiSupported
      ? {
          async loadApiJson(value) {
            calls.push(["prompt", value]);
          },
        }
      : {}),
  };
  runInNewContext(source, {
    URL,
    app,
    api: {
      async fetchApi(url) {
        calls.push(["fetch", url]);
        return { ok: true, json: async () => document };
      },
    },
    window: {
      location: { href: `http://comfy.test/?takeboard_workflow=${encodeURIComponent(path)}` },
      history: { replaceState() {} },
      alert(message) {
        calls.push(["alert", message]);
      },
    },
    console: { info() {}, error() {} },
  });
  await extension.setup();
  return calls;
}

test("ComfyUI bridge opens maintained API templates through the API loader, not the canvas loader", async () => {
  const prompt = { 1: { class_type: "SaveVideo", inputs: {} } };
  const calls = await open(prompt);
  assert.equal(
    calls[0][1],
    "/userdata/workflows%2FKino%2FTakeBoard%2Fversion%2FKino_MinimaxH3_T2V.json",
  );
  assert.deepEqual(calls[1], ["prompt", prompt]);
  const workflow = { nodes: [], links: [] };
  assert.deepEqual((await open(workflow))[1], ["graph", workflow]);
});

test("ComfyUI bridge refuses traversal and reports unsupported API loaders without pretending success", async () => {
  assert.deepEqual(await open({}, "../private.json"), []);
  const calls = await open({}, "TakeBoard/test.json", false);
  assert.equal(calls.at(-1)[0], "alert");
  assert.equal(
    calls.some(([kind]) => kind === "graph" || kind === "prompt"),
    false,
  );
});
