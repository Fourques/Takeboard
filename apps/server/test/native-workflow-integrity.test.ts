import { describe, expect, it } from "vitest";
import { assertNativeWorkflowIntegrity } from "../src/native-workflow-integrity.js";
import { WorkflowExecutionError } from "../src/workflow-errors.js";
import { recommendedArtifacts } from "../src/workflow-templates.js";

describe("maintained native workflow integrity", () => {
  it("checks every catalog artifact against the execution builder", () => {
    for (const artifact of recommendedArtifacts())
      expect(() => assertNativeWorkflowIntegrity(artifact.path, artifact.prompt)).not.toThrow();
  });
  it("blocks edited, misaddressed, and malformed artifacts instead of ignoring edits", () => {
    const artifact = recommendedArtifacts()[0];
    if (!artifact) throw new Error("No maintained template");
    for (const [path, source] of [
      [artifact.path, { ...artifact.prompt, added: { class_type: "SaveImage", inputs: {} } }],
      [artifact.path.replace(/\/[a-f0-9]{16}\//, `/${"0".repeat(16)}/`), artifact.prompt],
      [artifact.path.replace(/\/[a-f0-9]{16}\//, "/invalid/"), artifact.prompt],
    ] as const) {
      expect(() => assertNativeWorkflowIntegrity(path, source)).toThrow(WorkflowExecutionError);
      try {
        assertNativeWorkflowIntegrity(path, source);
      } catch (error) {
        expect((error as WorkflowExecutionError).response()).toMatchObject({
          code: "WORKFLOW_TEMPLATE_CHANGED",
          retryable: false,
          workflowPath: path,
        });
      }
    }
  });
  it("preserves legacy adapter and custom workflow compatibility", () => {
    expect(() => assertNativeWorkflowIntegrity("Kino/Kino_MinimaxH3_T2V.json", {})).not.toThrow();
    expect(() => assertNativeWorkflowIntegrity("TakeBoard/custom.json", {})).not.toThrow();
  });
});
