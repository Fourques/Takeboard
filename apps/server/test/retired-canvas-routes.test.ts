import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { executeTestCommand } from "./command-fixture.js";

it("all retired canvas writes fail explicitly without changing the project or audit", async () => {
  const root = await mkdtemp(join(tmpdir(), "takeboard-retired-api-"));
  const app = buildApp({ projectsRoot: root });
  try {
    const created = (
      await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { title: "Migration boundary" },
      })
    ).json();
    const { key } = created;
    const shot = await executeTestCommand(app, key, { type: "canvas.create_shot" });
    expect(shot.statusCode).toBe(200);
    const before = shot.json();
    for (const [method, path] of [
      ["POST", "shots"],
      ["DELETE", `shots/${before.shotId}`],
      ["POST", "text-nodes"],
      ["POST", "canvas-connections"],
      ["DELETE", "canvas-connections"],
      ["DELETE", "canvas-connections/missing"],
      ["PATCH", "canvas-position"],
      ["POST", "canvas-items"],
      ["POST", `canvas-items/${before.itemId}/duplicate`],
      ["PATCH", `canvas-items/${before.itemId}`],
      ["DELETE", `canvas-items/${before.itemId}`],
    ] as const) {
      const response = await app.inject({
        method,
        url: `/api/projects/${key}/${path}`,
        payload: {},
      });
      expect(response.statusCode, `${method} ${path}`).toBe(410);
      expect(response.json().code).toBe("LEGACY_CANVAS_API_RETIRED");
    }
    const after = (await app.inject({ method: "GET", url: `/api/projects/${key}` })).json();
    expect(after.revision).toBe(before.revision);
    expect(after.snapshot).toEqual(before.snapshot);
    const audit = (await app.inject({ method: "GET", url: `/api/projects/${key}/audit` })).json();
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0].commandType).toBe("canvas.create_shot");

    const unconfirmed = await executeTestCommand(app, key, {
      type: "shot.delete",
      shotId: before.shotId,
    });
    expect(unconfirmed.statusCode).toBe(409);
    const confirmed = await executeTestCommand(
      app,
      key,
      { type: "shot.delete", shotId: before.shotId },
      { confirm: true },
    );
    expect(confirmed.statusCode).toBe(200);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
