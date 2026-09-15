import { describe, expect, it } from "vitest";
import { recordedInputLabel } from "./recorded-prompt";

describe("recorded input labels", () => {
  it("distinguishes source images from video first and last frames", () => {
    expect(recordedInputLabel("first_frame", "image")).toBe("源图");
    expect(recordedInputLabel("start_image", "image")).toBe("源图");
    expect(recordedInputLabel("first_frame", "video")).toBe("首帧");
    expect(recordedInputLabel("last_image", "video")).toBe("尾帧");
  });
  it("uses human reference numbering without changing unknown custom slots", () => {
    expect(recordedInputLabel("reference_image_0")).toBe("参考图 1");
    expect(recordedInputLabel("reference_video_2")).toBe("参考视频 3");
    expect(recordedInputLabel("reference_audio_0")).toBe("参考音频 1");
    expect(recordedInputLabel("reference_image")).toBe("参考图");
    expect(recordedInputLabel("custom_control")).toBe("custom_control");
  });
});
