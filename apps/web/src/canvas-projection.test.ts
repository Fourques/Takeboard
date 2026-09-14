import type { ProjectSnapshot } from "@takeboard/contracts";
import { describe, expect, it } from "vitest";
import type { BoardNode } from "./board-nodes";
import { boardNodes, resolveSnapshotEdge, retainNodeMeasurements } from "./canvas-projection";

describe("canvas measurement reconciliation", () => {
  it("renders legacy resized items at stable widths without mutating stored dimensions", () => {
    const legacy = {
      canvasItems: [
        {
          id: "shot-node",
          refType: "shot",
          refId: "missing",
          x: 80,
          y: 90,
          width: 180,
          height: 100,
          sizeMode: "manual",
        },
        {
          id: "image-node",
          refType: "asset",
          refId: "missing",
          x: 700,
          y: 90,
          width: 4000,
          height: 3000,
          sizeMode: "manual",
        },
      ],
      shots: [],
      takes: [],
      runs: [],
      assets: [],
      entities: [],
      textItems: [],
      canvasEdges: [],
    } as unknown as ProjectSnapshot;
    const before = structuredClone(legacy);
    const nodes = boardNodes(legacy, null, null, [], null, null, null);
    expect(nodes.map((node) => node.style)).toEqual([{ width: 470 }, { width: 320 }]);
    expect(nodes[0]?.position).toEqual({ x: 80, y: 90 });
    expect(legacy).toEqual(before);
  });
  const node: BoardNode = {
    id: "shot",
    type: "shot",
    position: { x: 0, y: 0 },
    data: { kind: "shot", title: "SH-01", eyebrow: "SHOT", body: "" },
    measured: { width: 470, height: 650 },
  };
  it("keeps measurements without replacing new position, data or selection", () => {
    const next: BoardNode = {
      ...node,
      position: { x: 120, y: 80 },
      selected: true,
      data: { ...node.data, title: "New title" },
    };
    delete next.measured;
    expect(retainNodeMeasurements([node], [next])).toEqual([{ ...next, measured: node.measured }]);
    expect(next.measured).toBeUndefined();
  });
  it("does not retain removed nodes or reuse another node type's dimensions", () => {
    const replacement: BoardNode = { ...node, type: "asset" };
    delete replacement.measured;
    expect(retainNodeMeasurements([node], [replacement])).toEqual([replacement]);
    expect(retainNodeMeasurements([node], [])).toEqual([]);
    expect(retainNodeMeasurements([], [replacement])).toEqual([replacement]);
  });
});

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
