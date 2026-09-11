import type { ProjectSnapshot, Run, Shot } from "@takeboard/contracts";
import { describe, expect, it } from "vitest";
import { compileMiniMaxH3Mentions } from "./canvas-projection";
import { initialGenerationDraft } from "./generation-draft";
import type { PromptMention } from "./generation-model";
import { findWorkflow } from "./generation-model";
import { generationProblem } from "./generation-readiness";
import { cancellableRunIds } from "./generation-session";
import { modelProfile } from "./model-profiles";

const workflow = findWorkflow("Kino/Kino_Wan22_FLF2V.json", []);
const shot = {
  id: "shot",
  workflowPath: workflow?.path,
  intent: "original",
  durationSeconds: 5,
  aspectRatio: "16:9",
} as Shot;
const snapshot = { runs: [], assets: [], shots: [shot] } as unknown as ProjectSnapshot;
describe("generation input and ownership boundaries", () => {
  it("restores an imported workflow's literal defaults before falling back to generic values", () => {
    if (!workflow) throw new Error("missing fixture");
    expect(
      initialGenerationDraft(snapshot, shot, {
        ...workflow,
        execution: "bound",
        parameterDefaults: {
          width: 1280,
          height: 720,
          steps: 25,
          fps: 24,
          durationSeconds: 6,
          seed: 456,
        },
      }),
    ).toMatchObject({
      width: 1280,
      height: 720,
      steps: 25,
      fps: 24,
      durationSeconds: 6,
      seed: 456,
    });
  });
  it("keeps native constraints stable across renames and treats imported graphs by their bindings", () => {
    if (!workflow) throw new Error("missing fixture");
    expect(modelProfile({ ...workflow, name: "Qwen portrait" }, "16:9").family).toBe("wan22");
    expect(modelProfile({ ...workflow, execution: "bound" }, "16:9").family).toBe("custom");
  });
  it("compiles exact names only and rejects stale or disconnected references", () => {
    const mentions = [
      { alias: "猫", canonicalToken: "<Picture 1>" },
      { alias: "猫_2", canonicalToken: "<Video 1>" },
    ] as PromptMention[];
    expect(compileMiniMaxH3Mentions("@猫 抱着 @猫_2。", mentions)).toBe(
      "<Picture 1> 抱着 <Video 1>。",
    );
    expect(compileMiniMaxH3Mentions("使用 @猫、@猫_2。", mentions)).toBe(
      "使用 <Picture 1>、<Video 1>。",
    );
    expect(() => compileMiniMaxH3Mentions("@猫_20", mentions)).toThrow("没有对应");
    expect(() => compileMiniMaxH3Mentions("@之前的照片", mentions)).toThrow("没有对应");
    expect(compileMiniMaxH3Mentions("<Picture 1> 抱着猫", mentions)).toBe("<Picture 1> 抱着猫");
  });
  it("restores run provenance before defaults without borrowing another draft", () => {
    const saved = {
      ...snapshot,
      runs: [
        { shotId: "other", parameters: { steps: 99 } },
        {
          shotId: "shot",
          parameters: { promptSource: "@original", width: 1024, steps: 25, seed: 123 },
        },
      ] as unknown as Run[],
    };
    const result = initialGenerationDraft(saved, shot, workflow, { width: 832, steps: 20 });
    expect(result).toMatchObject({ prompt: "@original", width: 1024, steps: 25, seed: 123 });
    expect(initialGenerationDraft(snapshot, shot, workflow, { steps: 18 }).steps).toBe(18);
  });
  it("uses the requested workflow's validation for retry as well as first submission", () => {
    const settings = { ...initialGenerationDraft(snapshot, shot, workflow), prompt: "frame" };
    const problem = (first: string | null, last: string | null) =>
      generationProblem({
        projectMode: "project",
        selectedWorkflow: workflow,
        generationSettings: { ...settings, firstFrameAssetId: first, lastFrameAssetId: last },
        selectedModelProfile: modelProfile(workflow, "16:9"),
        selectedInputCounts: { reference: 0, reference_video: 0, reference_audio: 0 },
        assets: [{ id: "image", mediaType: "image" }] as ProjectSnapshot["assets"],
      });
    expect(problem(null, null)).toContain("起始帧");
    expect(problem("image", null)).toContain("结束帧");
    expect(problem("image", "image")).toBeNull();
  });
  it("cancels only nonterminal runs of the captured shot, not a previous submission", () => {
    const runs = [
      { id: "a-running", shotId: "a", status: "running" },
      { id: "b-running", shotId: "b", status: "running" },
      { id: "b-done", shotId: "b", status: "completed" },
      { id: "b-collect", shotId: "b", status: "collecting_outputs" },
      { id: "b-unknown", shotId: "b", status: "orphaned" },
    ] as Run[];
    expect(cancellableRunIds(runs, "b")).toEqual(["b-running", "b-collect", "b-unknown"]);
  });
});
