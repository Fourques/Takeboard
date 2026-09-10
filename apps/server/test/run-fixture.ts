import { setTimeout as delay } from "node:timers/promises";
import type { ProjectSnapshot } from "@takeboard/contracts";
import type { FastifyInstance } from "fastify";
import { expect } from "vitest";

type RunResult = { status: string; snapshot: ProjectSnapshot; progress?: { label: string } };

/** Result collection is asynchronous; require the real persisted milestone, not one fast GET. */
export async function waitForRun(
  app: FastifyInstance,
  key: string,
  runId: string,
  ready: (result: RunResult) => boolean = (result) => result.status === "completed",
): Promise<RunResult> {
  // Tests may freeze Date.now to advance retry eligibility; this deadline must remain monotonic.
  const deadline = performance.now() + 5000;
  for (;;) {
    const response = await app.inject({ method: "GET", url: `/api/projects/${key}/runs/${runId}` });
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json<RunResult>();
    if (ready(result)) return result;
    if (performance.now() >= deadline)
      throw new Error(`Run did not reach its milestone: ${response.body}`);
    await delay(25);
  }
}
