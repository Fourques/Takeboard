import type { ProjectCommand, ProjectCommandPreview } from "@takeboard/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectApi } from "./api";

const command: ProjectCommand = {
  type: "canvas.connect_items",
  sourceItemId: "source",
  targetItemId: "target",
  targetSlot: "first_frame",
};
const preview: ProjectCommandPreview = {
  commandType: command.type,
  summary: "替换首帧",
  currentRevision: 7,
  effects: [],
  warnings: [],
  requiresConfirmation: true,
  confirmationToken: "a".repeat(64),
  undoable: true,
};
afterEach(() => vi.unstubAllGlobals());

describe("command confirmation boundary", () => {
  it("does not turn a fetched replacement preview into user approval", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ preview }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      projectApi.connect("confirmation-test", "source", "target", "first_frame"),
    ).rejects.toThrow("先查看影响并确认");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toMatch(/commands\/preview$/);
  });
  it("submits the explicitly approved revision and token without generating a fresh preview", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ result: {} }));
    vi.stubGlobal("fetch", fetch);
    await projectApi.executeCommand("confirmation-test", command, preview);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0]?.[1].body);
    expect(body).toMatchObject({
      command,
      expectedRevision: 7,
      confirmationToken: preview.confirmationToken,
    });
  });
  it("allows a non-replacing connection while preserving the preview revision", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          preview: { ...preview, requiresConfirmation: false, confirmationToken: null },
        }),
      )
      .mockResolvedValueOnce(Response.json({ result: {} }));
    vi.stubGlobal("fetch", fetch);
    await projectApi.connect("confirmation-test", "source", "target", "first_frame");
    expect(fetch).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetch.mock.calls[1]?.[1].body);
    expect(body.expectedRevision).toBe(7);
    expect(body.confirmationToken).toBeUndefined();
  });
});
