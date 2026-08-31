import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectSnapshot } from "@takeboard/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ExtensionRegistry } from "../src/extension-registry.js";

const cleanup: string[] = [];

afterEach(async () => {
  for (const directory of cleanup.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("ExtensionRegistry", () => {
  it("requires inspect-confirm-install and keeps local extensions disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-extensions-"));
    cleanup.push(root);
    const registry = new ExtensionRegistry(join(root, "extensions.json"));
    const manifest = {
      format: "takeboard.extension",
      manifestVersion: 1,
      id: "studio.example.delivery",
      name: "Delivery checks",
      version: "1.0.0",
      description: "Checks empty shots",
      author: "Example Studio",
      permissions: ["project.read"],
      contributions: {
        qcRules: [
          {
            id: "empty-shots",
            title: "Empty shots",
            check: "shots_without_candidates",
            severity: "warning",
          },
        ],
      },
    };
    const inspection = registry.inspect(manifest);
    await expect(registry.install(manifest, "0".repeat(64))).rejects.toThrow(/不一致/);
    const installed = await registry.install(manifest, inspection.confirmationToken);
    expect(installed).toMatchObject({ enabled: false, source: "local_manifest" });
    await registry.setEnabled(installed.manifest.id, true);
    const reloaded = new ExtensionRegistry(join(root, "extensions.json"));
    expect(reloaded.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          manifest: expect.objectContaining({ id: "studio.example.delivery" }),
          enabled: true,
        }),
      ]),
    );
  });

  it("evaluates declarative QC without executing extension code", async () => {
    const root = await mkdtemp(join(tmpdir(), "takeboard-extensions-"));
    cleanup.push(root);
    const registry = new ExtensionRegistry(join(root, "extensions.json"));
    const timestamp = "2026-08-31T12:00:00.000Z";
    const snapshot = {
      schemaVersion: "0.1.0",
      exportedAt: timestamp,
      project: {
        id: "project_018f47a0-2c91-8a4f-a812-78f12a2c4510",
        schemaVersion: "0.1.0",
        title: "QC",
        defaultAspectRatio: "16:9",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      scenes: [],
      textItems: [],
      entities: [],
      assets: [],
      shots: [],
      runs: [],
      takes: [],
      approvals: [],
      canvasItems: [],
      canvasEdges: [],
    } satisfies ProjectSnapshot;
    const checks = registry.evaluate(snapshot);
    expect(checks).toHaveLength(4);
    expect(checks.every((check) => check.count === 0)).toBe(true);
  });
});
