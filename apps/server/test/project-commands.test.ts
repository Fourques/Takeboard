import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((task) => task()));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "takeboard-commands-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const app = buildApp({ projectsRoot: root, webRoot: null });
  cleanup.push(() => app.close());
  const created = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { title: "命令测试" },
  });
  expect(created.statusCode, created.body).toBe(201);
  return { app, key: created.json().key as string, revision: created.json().revision as number };
}

describe("project command API", () => {
  it("previews without mutation, executes idempotently, records, and undoes", async () => {
    const { app, key, revision } = await fixture();
    const command = { type: "canvas.create_shot" as const, label: "雾中入口" };
    const preview = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands/preview`,
      payload: { command, expectedRevision: revision },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().preview).toMatchObject({
      commandType: "canvas.create_shot",
      currentRevision: revision,
      requiresConfirmation: false,
      undoable: true,
      effects: [
        { action: "create", entityType: "shot", entityId: null },
        { action: "create", entityType: "canvas_item", entityId: null },
      ],
    });
    const unchanged = await app.inject({ method: "GET", url: `/api/projects/${key}` });
    expect(unchanged.json()).toMatchObject({ revision, snapshot: { shots: [] } });

    const envelope = {
      command,
      requestId: "test:create-shot:0001",
      expectedRevision: revision,
    };
    const executed = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: envelope,
    });
    expect(executed.statusCode, executed.body).toBe(200);
    expect(executed.json()).toMatchObject({
      replayed: false,
      revision: revision + 1,
      snapshot: { shots: [{ label: "雾中入口" }] },
    });
    const commandId = executed.json().commandId as string;

    const replayed = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: envelope,
    });
    expect(replayed.statusCode, replayed.body).toBe(200);
    expect(replayed.json()).toMatchObject({
      commandId,
      replayed: true,
      revision: revision + 1,
      snapshot: { shots: [{ label: "雾中入口" }] },
    });

    const audit = await app.inject({ method: "GET", url: `/api/projects/${key}/audit` });
    expect(audit.json().entries).toEqual([
      expect.objectContaining({
        id: commandId,
        commandType: "canvas.create_shot",
        status: "applied",
        undoable: true,
      }),
    ]);

    const undone = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands/${commandId}/undo`,
    });
    expect(undone.statusCode, undone.body).toBe(200);
    expect(undone.json()).toMatchObject({
      revision: revision + 2,
      undoneCommandId: commandId,
      snapshot: { shots: [], canvasItems: [] },
    });
    const secondUndo = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands/${commandId}/undo`,
    });
    expect(secondUndo.statusCode).toBe(409);
    expect(secondUndo.json().error).toContain("已经撤销");
  });

  it("requires a matching preview for destructive commands and restores deleted shots", async () => {
    const { app, key, revision } = await fixture();
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command: { type: "canvas.create_shot", label: "可撤销镜头" },
        requestId: "test:create-shot:0002",
        expectedRevision: revision,
      },
    });
    const shotId = created.json().shotId as string;
    const command = { type: "shot.delete" as const, shotId };
    const deletePreview = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands/preview`,
      payload: { command, expectedRevision: revision + 1 },
    });
    const preview = deletePreview.json().preview;
    expect(preview).toMatchObject({
      requiresConfirmation: true,
      confirmationToken: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const unconfirmed = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command,
        requestId: "test:delete-shot:0001",
        expectedRevision: revision + 1,
      },
    });
    expect(unconfirmed.statusCode).toBe(409);
    const stillPresent = await app.inject({ method: "GET", url: `/api/projects/${key}` });
    expect(stillPresent.json().snapshot.shots).toHaveLength(1);

    const deleted = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command,
        requestId: "test:delete-shot:0002",
        expectedRevision: revision + 1,
        confirmationToken: preview.confirmationToken,
      },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json().snapshot.shots).toEqual([]);

    const restored = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands/${deleted.json().commandId}/undo`,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().snapshot.shots).toEqual([
      expect.objectContaining({ id: shotId, label: "可撤销镜头" }),
    ]);
  });

  it("rejects stale revisions and unsafe undo after later edits", async () => {
    const { app, key, revision } = await fixture();
    const unchanged = await app.inject({
      method: "GET",
      url: `/api/projects/${key}/sync`,
      headers: { "if-none-match": `"takeboard-r${revision}"` },
    });
    expect(unchanged.statusCode).toBe(304);
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command: { type: "canvas.create_shot", label: "后续会移动" },
        requestId: "test:create-shot:0003",
        expectedRevision: revision,
      },
    });
    const stale = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command: { type: "canvas.create_shot", label: "过期请求" },
        requestId: "test:create-shot:0004",
        expectedRevision: revision,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toContain("当前版本");
    expect(stale.json()).toMatchObject({
      code: "REVISION_CONFLICT",
      currentRevision: revision + 1,
      expectedRevision: revision,
    });
    const synchronized = await app.inject({
      method: "GET",
      url: `/api/projects/${key}/sync`,
      headers: { "if-none-match": `"takeboard-r${revision}"` },
    });
    expect(synchronized.statusCode).toBe(200);
    expect(synchronized.headers.etag).toBe(`"takeboard-r${revision + 1}"`);
    expect(synchronized.json()).toMatchObject({ revision: revision + 1 });
    const staleRename = await app.inject({
      method: "PATCH",
      url: `/api/projects/${key}`,
      headers: { "x-takeboard-revision": String(revision) },
      payload: { title: "不应覆盖更新" },
    });
    expect(staleRename.statusCode).toBe(409);
    expect(staleRename.json()).toMatchObject({
      code: "REVISION_CONFLICT",
      currentRevision: revision + 1,
    });

    const moved = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command: {
          type: "canvas.move_item",
          itemId: created.json().itemId,
          x: 640,
          y: 280,
        },
        requestId: "test:move-item:0001",
      },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const unsafeUndo = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands/${created.json().commandId}/undo`,
    });
    expect(unsafeUndo.statusCode).toBe(409);
    expect(unsafeUndo.json().error).toContain("已经被修改");
  });

  it("reorders shots within a scene and safely restores the prior sequence", async () => {
    const { app, key, revision } = await fixture();
    const created: Array<{ shotId: string; revision: number }> = [];
    let currentRevision = revision;
    for (const [index, label] of ["远景", "中景", "特写"].entries()) {
      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${key}/commands`,
        payload: {
          command: { type: "canvas.create_shot", label },
          requestId: `test:reorder-create:000${index}`,
          expectedRevision: currentRevision,
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      created.push({ shotId: response.json().shotId, revision: response.json().revision });
      currentRevision = response.json().revision;
    }

    const command = { type: "shot.reorder" as const, shotId: created[2]?.shotId ?? "", toIndex: 0 };
    const preview = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands/preview`,
      payload: { command, expectedRevision: currentRevision },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().preview).toMatchObject({
      commandType: "shot.reorder",
      requiresConfirmation: false,
      undoable: true,
      warnings: [expect.stringContaining("画布节点位置")],
    });

    const reordered = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command,
        requestId: "test:reorder-shot:0001",
        expectedRevision: currentRevision,
      },
    });
    expect(reordered.statusCode, reordered.body).toBe(200);
    expect(
      [...reordered.json().snapshot.shots]
        .sort((left, right) => left.order - right.order)
        .map((shot) => shot.label),
    ).toEqual(["特写", "远景", "中景"]);

    const undone = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands/${reordered.json().commandId}/undo`,
    });
    expect(undone.statusCode, undone.body).toBe(200);
    expect(
      [...undone.json().snapshot.shots]
        .sort((left, right) => left.order - right.order)
        .map((shot) => shot.label),
    ).toEqual(["远景", "中景", "特写"]);
  });

  it("records and safely reverses text edits and canvas duplication", async () => {
    const { app, key, revision } = await fixture();
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command: {
          type: "canvas.create_text",
          title: "原始笔记",
          body: "第一版内容",
          x: 220,
          y: 180,
        },
        requestId: "test:create-text:0001",
        expectedRevision: revision,
      },
    });
    expect(created.statusCode, created.body).toBe(200);
    const itemId = created.json().itemId as string;

    const edited = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command: {
          type: "canvas.edit_item",
          itemId,
          title: "修改后的笔记",
          body: "第二版内容",
        },
        requestId: "test:edit-text:0001",
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json().snapshot.textItems[0]).toMatchObject({
      title: "修改后的笔记",
      body: "第二版内容",
    });

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command: { type: "canvas.duplicate_item", itemId, x: 560, y: 180 },
        requestId: "test:duplicate-item:0001",
      },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(duplicate.json().snapshot.canvasItems).toHaveLength(2);

    const duplicateUndo = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands/${duplicate.json().commandId}/undo`,
    });
    expect(duplicateUndo.statusCode, duplicateUndo.body).toBe(200);
    expect(duplicateUndo.json().snapshot.canvasItems).toHaveLength(1);

    const editUndo = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands/${edited.json().commandId}/undo`,
    });
    expect(editUndo.statusCode, editUndo.body).toBe(200);
    expect(editUndo.json().snapshot.textItems[0]).toMatchObject({
      title: "原始笔记",
      body: "第一版内容",
    });
  });

  it("duplicates a shot as an independent draft that can be deleted alone", async () => {
    const { app, key, revision } = await fixture();
    const created = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command: {
          type: "canvas.create_shot",
          label: "夜航",
          intent: "人物在雨中回头",
          durationSeconds: 7,
          aspectRatio: "16:9",
          x: 220,
          y: 180,
        },
        requestId: "test:create-shot-copy:0001",
        expectedRevision: revision,
      },
    });
    expect(created.statusCode, created.body).toBe(200);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command: {
          type: "canvas.duplicate_item",
          itemId: created.json().itemId,
          x: 620,
          y: 180,
        },
        requestId: "test:duplicate-shot:0001",
        expectedRevision: created.json().revision,
      },
    });
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(duplicate.json()).toMatchObject({ copyMode: "independent" });
    const duplicatedSnapshot = duplicate.json().snapshot;
    expect(duplicatedSnapshot.shots).toHaveLength(2);
    expect(duplicatedSnapshot.canvasItems).toHaveLength(2);
    const sourceShot = duplicatedSnapshot.shots.find(
      (shot: { id: string }) => shot.id === created.json().shotId,
    );
    const copiedShot = duplicatedSnapshot.shots.find(
      (shot: { id: string }) => shot.id === duplicate.json().shotId,
    );
    expect(copiedShot).toMatchObject({
      label: "夜航 副本",
      intent: sourceShot.intent,
      durationSeconds: 7,
      aspectRatio: "16:9",
      status: "draft",
      approvedTakeId: null,
    });
    expect(duplicatedSnapshot.canvasItems.map((item: { refId: string }) => item.refId)).toEqual(
      expect.arrayContaining([created.json().shotId, duplicate.json().shotId]),
    );

    const command = { type: "shot.delete", shotId: duplicate.json().shotId };
    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands/preview`,
      payload: { command, expectedRevision: duplicate.json().revision },
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const deleted = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command,
        requestId: "test:delete-shot-copy:0001",
        expectedRevision: duplicate.json().revision,
        confirmationToken: previewResponse.json().preview.confirmationToken,
      },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json().snapshot.shots).toHaveLength(1);
    expect(deleted.json().snapshot.shots[0].id).toBe(created.json().shotId);
    expect(deleted.json().snapshot.canvasItems).toHaveLength(1);
    expect(deleted.json().snapshot.canvasItems[0].refId).toBe(created.json().shotId);
  });

  it("previews, applies and safely undoes deterministic canvas arrangement", async () => {
    const { app, key, revision } = await fixture();
    let currentRevision = revision;
    const originalPositions: Array<{ id: string; x: number; y: number }> = [];
    for (const [index, position] of [
      { x: 720, y: 420 },
      { x: 140, y: 150 },
      { x: 430, y: 760 },
    ].entries()) {
      const created = await app.inject({
        method: "POST",
        url: `/api/projects/${key}/commands`,
        payload: {
          command: {
            type: "canvas.create_shot",
            label: `镜头 ${index + 1}`,
            ...position,
          },
          requestId: `test:arrange-create:000${index}`,
          expectedRevision: currentRevision,
        },
      });
      expect(created.statusCode, created.body).toBe(200);
      currentRevision = created.json().revision;
      originalPositions.push({ id: created.json().itemId, ...position });
    }
    const sceneId = (await app.inject({ method: "GET", url: `/api/projects/${key}` })).json()
      .snapshot.scenes[0].id as string;
    const command = { type: "canvas.arrange_scene" as const, sceneId };
    const previewResponse = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands/preview`,
      payload: { command, expectedRevision: currentRevision },
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const preview = previewResponse.json().preview;
    expect(preview).toMatchObject({
      requiresConfirmation: true,
      undoable: true,
      effects: expect.arrayContaining([
        expect.objectContaining({ action: "update", entityType: "canvas_item" }),
      ]),
    });
    const arranged = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands`,
      payload: {
        command,
        requestId: "test:arrange-scene:0001",
        expectedRevision: currentRevision,
        confirmationToken: preview.confirmationToken,
      },
    });
    expect(arranged.statusCode, arranged.body).toBe(200);
    const arrangedItems = arranged.json().snapshot.canvasItems as Array<{
      id: string;
      x: number;
      y: number;
    }>;
    expect(new Set(arrangedItems.map((item) => item.x))).toEqual(new Set([140]));
    expect(arrangedItems.map((item) => item.y).sort((left, right) => left - right)).toEqual([
      150, 404, 658,
    ]);

    const undone = await app.inject({
      method: "POST",
      url: `/api/projects/${key}/commands/${arranged.json().commandId}/undo`,
    });
    expect(undone.statusCode, undone.body).toBe(200);
    expect(
      undone
        .json()
        .snapshot.canvasItems.map((item: { id: string; x: number; y: number }) => ({
          id: item.id,
          x: item.x,
          y: item.y,
        }))
        .sort((left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id)),
    ).toEqual([...originalPositions].sort((left, right) => left.id.localeCompare(right.id)));
  });
});
