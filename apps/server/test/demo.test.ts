import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe("TakeBoard demo API", () => {
  it("runs generate, reject, approve and reopen as a persisted loop", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-demo-api-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const demoDirectory = join(root, "demo.takeboard");
    const app = buildApp({ demoDirectory });
    cleanup.push(() => app.close());

    const initial = await app.inject({ method: "GET", url: "/api/demo/project" });
    expect(initial.statusCode).toBe(200);
    const initialPayload = initial.json();
    const shotId = initialPayload.snapshot.shots[0].id as string;
    expect(initialPayload.snapshot.takes).toHaveLength(0);

    const generated = await app.inject({
      method: "POST",
      url: "/api/demo/generate",
      payload: { shotId },
    });
    expect(generated.statusCode).toBe(200);
    const generatedPayload = generated.json();
    expect(generatedPayload.snapshot.takes).toHaveLength(4);
    expect(generatedPayload.snapshot.canvasItems).toHaveLength(7);

    const [rejectedTake, approvedTake] = generatedPayload.snapshot.takes as Array<{ id: string }>;
    const rejected = await app.inject({
      method: "POST",
      url: "/api/demo/reject",
      payload: { takeId: rejectedTake?.id, reason: "角色漂移" },
    });
    expect(rejected.statusCode).toBe(200);

    const approved = await app.inject({
      method: "POST",
      url: "/api/demo/approve",
      payload: { takeId: approvedTake?.id, reason: "构图和表演最好" },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().snapshot.shots[0]).toMatchObject({
      status: "approved",
      approvedTakeId: approvedTake?.id,
    });

    const reopened = await app.inject({ method: "GET", url: "/api/demo/project" });
    expect(reopened.json().snapshot.takes.map((take: { status: string }) => take.status)).toEqual([
      "rejected",
      "approved",
      "candidate",
      "candidate",
    ]);
  });

  it("resets the project to its original fixture", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-demo-reset-"));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const app = buildApp({ demoDirectory: join(root, "demo.takeboard") });
    cleanup.push(() => app.close());

    await app.inject({ method: "GET", url: "/api/demo/project" });
    const reset = await app.inject({ method: "POST", url: "/api/demo/reset" });

    expect(reset.statusCode).toBe(200);
    expect(reset.json().snapshot).toMatchObject({ takes: [], approvals: [] });
  });
});
