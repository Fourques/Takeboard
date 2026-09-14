import { describe, expect, it } from "vitest";
import type { WorkflowSummary } from "./api";
import { compareWorkflows, isLibraryWorkflow, workflowAvailability } from "./workflow-library";

const template = { name: "H3", origin: "built_in", execution: "native" } as WorkflowSummary;
describe("workflow library", () => {
  it("requires opting into templates and honors removing imported workflows", () => {
    expect(isLibraryWorkflow(template)).toBe(false);
    expect(isLibraryWorkflow({ ...template, library: { included: true, favorite: false } })).toBe(
      true,
    );
    expect(
      isLibraryWorkflow({
        ...template,
        origin: "imported",
        library: { included: false, favorite: false },
      }),
    ).toBe(false);
  });
  it("does not call native or bound execution verified without current checks", () => {
    expect(workflowAvailability(template).ready).toBe(false);
    expect(workflowAvailability({ ...template, execution: "bound" }).ready).toBe(false);
    expect(workflowAvailability({ ...template, modelStatus: "missing" }).label).toBe("不可用");
    const ready = {
      ...template,
      diagnostic: { health: "ready", executable: true },
    } as WorkflowSummary;
    expect(workflowAvailability(ready).ready).toBe(true);
    expect(compareWorkflows(ready, template)).toBeLessThan(0);
  });
  it("does not turn non-blocking source warnings into an unusable or ambiguous state", () => {
    const warned = {
      ...template,
      diagnostic: {
        health: "attention",
        executable: true,
        checks: [{ status: "warning", code: "SOURCE_WORKFLOW_INPUTS_DIFFER" }],
      },
    } as WorkflowSummary;
    expect(workflowAvailability(warned)).toMatchObject({ label: "可用", ready: true });
    expect(workflowAvailability({ ...warned, bindingStatus: "stale" })).toMatchObject({
      label: "需要更新",
      ready: false,
    });
    if (!warned.diagnostic) throw new Error("Missing diagnostic fixture");
    expect(
      workflowAvailability({ ...warned, diagnostic: { ...warned.diagnostic, executable: false } })
        .ready,
    ).toBe(false);
  });
  it("blocks real incompatibility and hides raw input names in the user-facing reason", () => {
    const workflow = {
      ...template,
      diagnostic: {
        health: "blocked",
        executable: false,
        checks: [
          {
            status: "blocked",
            code: "COMFY_REQUIRED_INPUTS_MISSING",
            detail: "92：缺少必需输入 codec",
          },
        ],
      },
    } as WorkflowSummary;
    expect(workflowAvailability(workflow)).toMatchObject({ label: "需要更新", ready: false });
    expect(workflowAvailability(workflow).reason).toContain("重新检查");
    expect(workflowAvailability(workflow).reason).not.toContain("codec");
  });
});
