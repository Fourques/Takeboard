import { describe, expect, it } from "vitest";
import { operationFailure } from "./operation-failure";

describe("operation failure identity", () => {
  it("preserves structured error codes and resets them for a new plain message", () => {
    expect(
      operationFailure(
        Object.assign(new Error("模板需要检查"), { code: "WORKFLOW_INPUTS_INCOMPATIBLE" }),
      ),
    ).toEqual({ message: "模板需要检查", code: "WORKFLOW_INPUTS_INCOMPATIBLE" });
    expect(operationFailure("新的错误")).toEqual({ message: "新的错误", code: null });
    expect(operationFailure(null)).toBeNull();
  });
});
