import { fork } from "node:child_process";
import { mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Fastify from "../apps/server/node_modules/fastify/fastify.js";
import { ProjectStore } from "../apps/server/src/storage/project-store.js";

// Real OS child/IPC loss, simulated Comfy execution. No real GPU endpoint is touched.
const root = await mkdtemp(join(tmpdir(), "takeboard-background-exit-"));
const mock = Fastify();
let completed = false;
let releases = 0;
mock.get("/system_stats", async () => ({ system: { comfyui_version: "test" }, devices: [] }));
mock.get("/object_info", async () =>
  Object.fromEntries(
    [
      "UNETLoader",
      "CLIPLoader",
      "VAELoader",
      "MiniMaxH3ImageToVideo",
      "RandomNoise",
      "BasicGuider",
      "KSamplerSelect",
      "BasicScheduler",
      "SamplerCustomAdvanced",
      "VAEDecode",
      "VAEDecodeAudio",
      "CreateVideo",
      "SaveVideo",
    ].map((name) => [name, { input: { required: {} } }]),
  ),
);
mock.post("/prompt", async () => ({ prompt_id: "smoke-prompt" }));
mock.get("/queue", async () => ({
  queue_running: completed ? [] : [[0, "smoke-prompt"]],
  queue_pending: [],
}));
mock.get("/history/:id", async () =>
  completed
    ? {
        "smoke-prompt": {
          status: { completed: true },
          outputs: {
            "1": { videos: [{ filename: "result.mp4", subfolder: "", type: "output" }] },
          },
        },
      }
    : {},
);
mock.get("/view", async (_request, reply) =>
  reply.type("video/mp4").send(Buffer.from("00000018667479706d70343200000000", "hex")),
);
mock.post("/free", async () => {
  releases++;
  return {};
});
await mock.listen({ host: "127.0.0.1", port: 0 });
const address = mock.server.address();
if (!address || typeof address === "string") throw new Error("Missing test port");
const log = await open(join(root, "server.log"), "a", 0o600);
const child = fork(resolve("apps/server/dist/index.js"), [], {
  execArgv: [],
  stdio: ["ignore", log.fd, log.fd, "ipc"],
  env: {
    ...process.env,
    TAKEBOARD_DESKTOP: "1",
    TAKEBOARD_AUTH_MODE: "off",
    TAKEBOARD_DATA_ROOT: root,
    TAKEBOARD_HOST: "127.0.0.1",
    TAKEBOARD_PORT: "0",
    COMFY_URL: `http://127.0.0.1:${address.port}`,
    TAKEBOARD_WEB_ROOT: join(root, "no-web"),
  },
});
await log.close();
const report: Record<string, unknown> = { root, kind: "real IPC disconnect, simulated Comfy" };
try {
  let port = 0;
  for (let attempt = 0; attempt < 100 && !port; attempt++) {
    port = await readFile(join(root, ".system", "instance.json"), "utf8")
      .then((s) => JSON.parse(s).port)
      .catch(() => 0);
    if (!port) await new Promise((r) => setTimeout(r, 100));
  }
  if (!port) throw new Error("Server did not become ready");
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    return result;
  };
  const project = await post("/api/projects", {
    title: "Background exit test",
    aspectRatio: "9:16",
  });
  await post(`/api/projects/${project.key}/shots/${project.snapshot.shots[0].id}/generate`, {
    recipePath: "Kino/Kino_MinimaxH3_T2V.json",
    prompt: "Test",
  });
  child.disconnect();
  await new Promise((r) => setTimeout(r, 1000));
  if (child.exitCode !== null) throw new Error("Server exited before output was ready");
  completed = true;
  for (let attempt = 0; attempt < 150 && child.exitCode === null; attempt++)
    await new Promise((r) => setTimeout(r, 100));
  if (child.exitCode !== 0)
    throw new Error(`Background collector did not exit cleanly (${child.exitCode})`);
  const store = ProjectStore.openExisting(join(root, project.key));
  try {
    const snapshot = store?.loadCurrent()?.snapshot;
    if (snapshot?.runs[0]?.status !== "completed" || snapshot.takes.length !== 1)
      throw new Error("Output was not durably collected");
    report.saved = true;
    report.releases = releases;
    if (!releases) throw new Error("No idle resource cleanup on exit");
    report.passed = true;
  } finally {
    store?.close();
  }
} catch (error) {
  report.error = String(error);
  report.passed = false;
  process.exitCode = 1;
} finally {
  if (child.exitCode === null) child.kill("SIGKILL");
  await mock.close();
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
