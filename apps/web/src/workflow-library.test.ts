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
    expect(workflowAvailability({ ...template, modelStatus: "missing" }).label).toBe("缺少模型");
    const ready = {
      ...template,
      diagnostic: { health: "ready", executable: true },
    } as WorkflowSummary;
    expect(workflowAvailability(ready).ready).toBe(true);
    expect(compareWorkflows(ready, template)).toBeLessThan(0);
  });
});
