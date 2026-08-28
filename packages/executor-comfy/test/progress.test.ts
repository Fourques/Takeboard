import { describe, expect, it } from "vitest";
import { ComfyProgressTracker } from "../src/progress.js";

describe("ComfyUI live progress", () => {
  it("uses real sampler value/max and never invents a percentage for opaque nodes", () => {
    const tracker = new ComfyProgressTracker("http://comfy.test", false);
    tracker.connect("client-1", {
      load: { class_type: "LoadImage", inputs: {}, _meta: { title: "读取首帧" } },
      sample: { class_type: "KSampler", inputs: {}, _meta: { title: "高质量采样" } },
    });
    tracker.register("prompt-1", "client-1", 2);
    expect(tracker.get("prompt-1")).toMatchObject({ phase: "queued", percent: null });

    tracker.ingest("client-1", {
      type: "executing",
      data: { prompt_id: "prompt-1", node: "load" },
    });
    expect(tracker.get("prompt-1")).toMatchObject({
      label: "正在执行：读取首帧",
      percent: null,
    });

    tracker.ingest("client-1", {
      type: "progress",
      data: { prompt_id: "prompt-1", node: "sample", value: 7, max: 20 },
    });
    expect(tracker.get("prompt-1")).toMatchObject({
      label: "正在生成：高质量采样",
      detail: "真实步进 7 / 20",
      percent: 35,
    });
  });

  it("switches to output collection only after ComfyUI reports success", () => {
    const tracker = new ComfyProgressTracker("http://comfy.test", false);
    tracker.register("prompt-2", "client-2");
    tracker.ingest("client-2", {
      type: "execution_success",
      data: { prompt_id: "prompt-2" },
    });
    expect(tracker.get("prompt-2")).toMatchObject({
      phase: "collecting",
      percent: 100,
      detail: "正在将结果保存到项目",
    });
  });

  it("keeps early websocket events that arrive before the prompt response", () => {
    const tracker = new ComfyProgressTracker("http://comfy.test", false);
    tracker.connect("client-fast", {
      sample: { class_type: "KSampler", inputs: {}, _meta: { title: "采样" } },
    });
    tracker.ingest("client-fast", {
      type: "progress",
      data: { prompt_id: "prompt-fast", node: "sample", value: 3, max: 12 },
    });
    tracker.register("prompt-fast", "client-fast");
    expect(tracker.get("prompt-fast")).toMatchObject({ percent: 25, detail: "真实步进 3 / 12" });
  });

  it("applies queue status messages that do not include a prompt id", () => {
    const tracker = new ComfyProgressTracker("http://comfy.test", false);
    tracker.register("prompt-queue", "client-queue");
    tracker.ingest("client-queue", {
      type: "status",
      data: { status: { exec_info: { queue_remaining: 4 } } },
    });
    expect(tracker.get("prompt-queue")?.queueRemaining).toBe(4);
  });
});
