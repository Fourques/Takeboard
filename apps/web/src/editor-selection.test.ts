import type { ProjectSnapshot } from "@takeboard/contracts";
import { describe, expect, it } from "vitest";
import { emptySelection, reconcileSelection, reduceEditorSelection } from "./editor-selection";

const snapshot = {
  project: { id: "project-a" },
  shots: [{ id: "shot-a" }, { id: "shot-b" }],
  canvasItems: [
    { id: "node-a", refType: "shot", refId: "shot-a" },
    { id: "node-b", refType: "shot", refId: "shot-b" },
    { id: "image", refType: "asset", refId: "asset" },
    { id: "note", refType: "text", refId: "text" },
  ],
  canvasEdges: [{ id: "edge" }],
} as ProjectSnapshot;
const activated = reduceEditorSelection(emptySelection, {
  type: "activate",
  snapshot,
  reveal: true,
});
describe("editor selection transitions", () => {
  it("keeps the context menu anchored to the single selected target and closes it on deletion", () => {
    const menu = { clientX: 100, clientY: 200, flowX: 300, flowY: 400 };
    const selected = reduceEditorSelection(activated, {
      type: "item",
      snapshot,
      itemId: "image",
      menu,
    });
    expect(selected).toMatchObject({ target: { kind: "item", id: "image" }, menu });
    expect(
      reduceEditorSelection(selected, { type: "item", snapshot, itemId: "note" }).menu,
    ).toBeNull();
    expect(
      reconcileSelection(selected, {
        ...snapshot,
        canvasItems: snapshot.canvasItems.filter((item) => item.id !== "image"),
      }).menu,
    ).toBeNull();
  });
  it("activates a project and its initial shot atomically", () => {
    expect(activated).toMatchObject({
      projectId: "project-a",
      target: { kind: "item", id: "node-a" },
      shotContextId: "shot-a",
      inspectorOpen: true,
    });
  });
  it("keeps shot context when inspecting an image or note", () => {
    for (const itemId of ["image", "note"])
      expect(reduceEditorSelection(activated, { type: "item", snapshot, itemId })).toMatchObject({
        target: { kind: "item", id: itemId },
        shotContextId: "shot-a",
        inspectorOpen: true,
      });
  });
  it("clears all targeting on the blank canvas and does not reselect on sync", () => {
    const cleared = reduceEditorSelection(activated, { type: "canvas" });
    expect(cleared).toMatchObject({
      target: { kind: "canvas" },
      shotContextId: null,
      inspectorOpen: false,
    });
    expect(reconcileSelection(cleared, snapshot)).toBe(cleared);
  });
  it("cannot retain edge identity after choosing a node", () => {
    const edge = reduceEditorSelection(activated, {
      type: "edge",
      id: "edge",
      identity: { sourceItemId: "image", targetItemId: "node-a", targetSlot: "first_frame" },
    });
    expect(edge).toMatchObject({ shotContextId: null, inspectorOpen: false });
    const node = reduceEditorSelection(edge, { type: "item", snapshot, itemId: "node-b" });
    expect(node.target).toEqual({ kind: "item", id: "node-b" });
    expect(node.shotContextId).toBe("shot-b");
  });
  it("clears removed targets and cross-project state, including the inspector", () => {
    expect(reconcileSelection(activated, { ...snapshot, shots: [], canvasItems: [] })).toEqual({
      ...emptySelection,
      projectId: "project-a",
    });
    expect(
      reconcileSelection(activated, {
        ...snapshot,
        project: { ...snapshot.project, id: "project-b" },
      }),
    ).toEqual({ ...emptySelection, projectId: "project-b" });
  });
  it("adopting a result hides inline controls without losing the shot inspector", () => {
    expect(reduceEditorSelection(activated, { type: "adopted" })).toMatchObject({
      target: { kind: "canvas" },
      shotContextId: "shot-a",
      inspectorOpen: true,
    });
  });
});
