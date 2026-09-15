import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../apps/server/src/app.js";

if (process.env.TAKEBOARD_REAL_LIFECYCLE_TEST !== "1")
  throw new Error("Explicit real-service test opt-in required");
const root = await mkdtemp(join(tmpdir(), "takeboard-lifecycle-real-"));
const apps = [];
const report: Record<string, unknown> = { root, startedAt: new Date().toISOString() };
console.log(JSON.stringify(report));
const make = () =>
  buildApp({
    projectsRoot: root,
    auth: { mode: "off" },
    webRoot: null,
    comfyUrl: "http://127.0.0.1:8188",
    workerOptions: { startupTimeoutMs: 60_000 },
  });
try {
  const first = make();
  apps.push(first);
  await first.listen({ host: "127.0.0.1", port: 0 });
  const started = await first.inject({
    method: "POST",
    url: "/api/workers/comfy/start",
    payload: { action: "safe-start" },
  });
  if (started.statusCode !== 200) throw new Error(started.body);
  report.started = true;
  await first.close();
  const second = make();
  apps.push(second);
  await second.listen({ host: "127.0.0.1", port: 0 });
  const deadline = Date.now() + 70_000;
  let ready = false;
  while (Date.now() < deadline) {
    const status = (await second.inject("/api/workers/comfy")).json();
    if (status.status === "ready" && status.control?.canStop) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error("Reopen did not restore owned service");
  report.restored = true;
  await second.close();
  report.passed = true;
} catch (error) {
  report.error = String(error);
  report.passed = false;
  process.exitCode = 1;
} finally {
  for (const app of apps) await app.close();
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
