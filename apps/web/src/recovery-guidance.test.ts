import { describe, expect, it } from "vitest";
import { recoveryGuidance } from "./recovery-guidance";

describe("user-facing recovery guidance", () => {
  it("never suggests a blind retry for unknown submission or failed collection", () => {
    expect(recoveryGuidance("", "SUBMISSION_OUTCOME_UNKNOWN").action).toBe("tasks");
    expect(recoveryGuidance("", "OUTPUT_TRANSFER_FAILED").next).toContain("不必重新生成");
    expect(recoveryGuidance("TakeBoard 请求超时").action).toBe("tasks");
  });
  it("routes actionable known failures without inventing a diagnosis", () => {
    expect(recoveryGuidance("CUDA out of memory").action).toBe("parameters");
    expect(recoveryGuidance("当前电脑缺少模型：a.safetensors").action).toBe("workflows");
    expect(recoveryGuidance("无法连接 TakeBoard 服务").action).toBe("connections");
    expect(recoveryGuidance("请先输入镜头提示词").action).toBe("prompt");
    expect(recoveryGuidance("首尾帧模式还需要一张结束帧").action).toBe("assets");
    expect(recoveryGuidance("unknown plugin exception").action).toBe("diagnostics");
  });
  it("keeps version-conflict instructions visible rather than hiding them as technical details", () => {
    const message = "项目刚刚在其他设备发生变化；已载入最新版本，请确认后再次执行刚才的操作。";
    expect(recoveryGuidance(message)).toMatchObject({ next: message, action: "review" });
    expect(recoveryGuidance("ENOSPC").action).toBe("storage");
  });
});
