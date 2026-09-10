import { describe, expect, it } from "vitest";
import { batchGenerationProgress, submitCandidates } from "./generation-session";

describe("candidate submission lifecycle", () => {
  it("counts saved candidates instead of averaging unrelated sampler percentages", () => {
    const runs = (["completed", "running", "collecting_outputs"] as const).map((status, index) => ({
      id: String(index),
      shotId: "shot",
      status,
      parameters: { candidateBatchId: "batch", candidateIndex: index + 1 },
      createdAt: new Date().toISOString(),
    }));
    expect(batchGenerationProgress(runs, "shot")).toMatchObject({
      percent: 33,
      label: "候选结果 · 1/3 已保存",
      detail: "1 生成中 · 1 保存中",
    });
    expect(batchGenerationProgress(runs, "other")).toBeNull();
    if (!runs[1]) throw new Error("Missing retry fixture");
    const retry = { ...runs[1], id: "retry", status: "completed" as const };
    expect(batchGenerationProgress([...runs, retry], "shot")).toMatchObject({
      percent: 67,
      label: "候选结果 · 2/3 已保存",
    });
  });
  it("lets an explicit stop await an in-flight identity without submitting the remaining batch", async () => {
    let current = true;
    let acknowledge: (id: string) => void = () => undefined;
    const inFlight = new Promise<string>((resolve) => {
      acknowledge = resolve;
    });
    const order: string[] = [];
    const pending = submitCandidates(
      [1, 2],
      async () => {
        order.push("submit");
        return await inFlight;
      },
      () => current,
    );
    current = false;
    const stop = pending.then(async (results) => {
      const ids = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      await submitCandidates(ids, async (id) => {
        order.push(`cancel:${id}`);
      });
    });
    await Promise.resolve();
    expect(order).toEqual(["submit"]);
    acknowledge("accepted-task");
    await stop;
    expect(order).toEqual(["submit", "cancel:accepted-task"]);
  });
  it("uses the latest acknowledged revision for every candidate", async () => {
    let revision = 1;
    const received: number[] = [];
    const results = await submitCandidates([11, 22, 33], async () => {
      const sent = revision;
      await Promise.resolve();
      expect(sent).toBe(revision);
      received.push(sent);
      return ++revision;
    });
    expect(received).toEqual([1, 2, 3]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
  });

  it("does not retry or continue after an ambiguous submission failure", async () => {
    const attempts: number[] = [];
    const results = await submitCandidates([1, 2, 3], async (candidate) => {
      attempts.push(candidate);
      if (candidate === 2) throw new Error("connection lost after submission");
      return candidate;
    });
    expect(attempts).toEqual([1, 2]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  });

  it("stops submitting on navigation without cancelling accepted work", async () => {
    let current = true;
    const results = await submitCandidates(
      [1, 2],
      async (candidate) => {
        current = false;
        return candidate;
      },
      () => current,
    );
    expect(results).toEqual([{ status: "fulfilled", value: 1 }]);
  });
});
