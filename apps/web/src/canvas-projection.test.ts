import type { ProjectSnapshot } from "@takeboard/contracts";
import { describe, expect, it } from "vitest";
import { resolveSnapshotEdge } from "./canvas-projection";

const edge = {
  id: "actual",
  sourceItemId: "source",
  targetItemId: "shot",
  targetSlot: "first_frame",
};
const snapshot = { canvasEdges: [edge] } as ProjectSnapshot;
describe("canvas edge resolution", () => {
  it("resolves a persisted ID and an exact source/target/slot tuple", () => {
    expect(resolveSnapshotEdge(snapshot, { id: "actual", source: "source", target: "shot" })).toBe(
      edge,
    );
    expect(
      resolveSnapshotEdge(snapshot, {
        id: "stale",
        source: "source",
        target: "shot",
        targetHandle: "first_frame",
      }),
    ).toBe(edge);
  });
  it("never guesses a different source or slot just because the target has one edge", () => {
    expect(
      resolveSnapshotEdge(snapshot, {
        id: "stale",
        source: "other",
        target: "shot",
        targetHandle: "first_frame",
      }),
    ).toBeUndefined();
    expect(
      resolveSnapshotEdge(snapshot, {
        id: "stale",
        source: "source",
        target: "shot",
        targetHandle: "last_frame",
      }),
    ).toBeUndefined();
  });
});
