import { describe, expect, it } from "vitest";
import type { DemoPayload } from "./api";
import { nextProjectDocument } from "./project-document";

const payload = (id: string, revision: number) =>
  ({ revision, snapshot: { project: { id } } }) as DemoPayload;

describe("project document ownership", () => {
  it("requires explicit activation, not a late response, to open a document", () => {
    const a = payload("A", 3);
    expect(nextProjectDocument(null, a)).toBeNull();
    expect(nextProjectDocument(null, a, true)).toBe(a);
  });
  it("commits snapshot and revision together, rejecting duplicate and older responses", () => {
    const a = payload("A", 3);
    const newer = payload("A", 4);
    expect(nextProjectDocument(a, payload("A", 2))).toBe(a);
    expect(nextProjectDocument(a, payload("A", 3))).toBe(a);
    expect(nextProjectDocument(a, newer)).toBe(newer);
  });
  it("cannot replace B with a late edit or generation response from A", () => {
    const b = payload("B", 1);
    expect(nextProjectDocument(b, payload("A", 100))).toBe(b);
  });
  it("allows explicitly opening a different project without comparing unrelated revisions", () => {
    const b = payload("B", 1);
    expect(nextProjectDocument(payload("A", 100), b, true)).toBe(b);
  });
});
