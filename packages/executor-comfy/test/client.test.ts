import { afterEach, describe, expect, it, vi } from "vitest";
import { ComfyClient } from "../src/index.js";

afterEach(() => vi.unstubAllGlobals());

describe("ComfyUI task ownership", () => {
  it.each([true, false])(
    "does not confuse acknowledgement with stopped execution (modern=%s)",
    async (modern) => {
      const calls: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) => {
          const url = String(input);
          calls.push(url);
          if (url.endsWith("/cancel"))
            return modern
              ? Response.json({ cancelled: true })
              : new Response(null, { status: 404 });
          if (url.endsWith("/queue"))
            return Response.json({ queue_running: [[1, "target"]], queue_pending: [] });
          if (url.endsWith("/interrupt")) return new Response(null, { status: 200 });
          throw new Error(url);
        }),
      );
      expect(
        await new ComfyClient("http://comfy.test", {
          liveProgress: false,
          cancelConfirmationTimeoutMs: 0,
        }).cancel("target"),
      ).toBe(false);
      expect(calls.some((url) => url.endsWith("/queue"))).toBe(true);
    },
  );

  it("waits for the target to leave the queue before confirming cancellation", async () => {
    let checks = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/cancel")) return Response.json({ cancelled: true });
        if (url.endsWith("/queue"))
          return Response.json({
            queue_running: ++checks < 2 ? [[1, "target"]] : [],
            queue_pending: [],
          });
        throw new Error(url);
      }),
    );
    expect(
      await new ComfyClient("http://comfy.test", { liveProgress: false }).cancel("target"),
    ).toBe(true);
    expect(checks).toBe(2);
  });

  it("rejects a malformed queue rather than inferring that all jobs stopped", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({})),
    );
    await expect(
      new ComfyClient("http://comfy.test", { liveProgress: false }).queueState("target"),
    ).rejects.toThrow("invalid queue");
  });
  it("releases live-progress ownership when prompt submission is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "invalid prompt" }, { status: 400 })),
    );
    const client = new ComfyClient("http://comfy.test", { liveProgress: false });

    await expect(
      client.submit({ sample: { class_type: "KSampler", inputs: {} } }, "client-rejected"),
    ).rejects.toThrow("ComfyUI rejected prompt");

    client.watchProgress("prompt-rejected", "client-rejected");
    expect(client.progress("prompt-rejected")).toMatchObject({ percent: null });
  });

  it("deletes only the requested queued prompt without interrupting another running job", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let deleted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/api/jobs/queued-target/cancel"))
          return new Response(null, { status: 404 });
        if (url.endsWith("/queue") && !init?.method) {
          return Response.json({
            queue_running: [[1, "someone-elses-job"]],
            queue_pending: deleted ? [] : [[2, "queued-target"]],
          });
        }
        if (url.endsWith("/queue") && init?.method === "POST") {
          deleted = true;
          return Response.json({});
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    expect(await new ComfyClient("http://comfy.test").cancel("queued-target")).toBe(true);
    expect(requests.some((request) => request.url.endsWith("/interrupt"))).toBe(false);
    const deletion = requests.find(
      (request) => request.url.endsWith("/queue") && request.init?.method === "POST",
    );
    expect(JSON.parse(String(deletion?.init?.body))).toEqual({ delete: ["queued-target"] });
  });

  it("treats a prompt absent from the authoritative queue as already stopped", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/api/jobs/finished/cancel")) {
          return Response.json({ cancelled: false });
        }
        if (url.endsWith("/queue")) {
          return Response.json({ queue_running: [], queue_pending: [] });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    expect(await new ComfyClient("http://comfy.test").cancel("finished")).toBe(true);
  });
});
