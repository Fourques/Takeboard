import { describe, expect, it } from "vitest";
import { seekPreviewFrame } from "./video-preview";

function media(overrides: Partial<HTMLVideoElement> = {}) {
  return {
    paused: true,
    seeking: false,
    currentTime: 0,
    duration: 5,
    seekable: { length: 1, start: () => 0, end: () => 5 },
    ...overrides,
  } as HTMLVideoElement;
}

describe("video poster frame readiness", () => {
  it("seeks a real frame without seeking beyond short clips", () => {
    const regular = media();
    seekPreviewFrame(regular);
    expect(regular.currentTime).toBe(0.2);
    const short = media({ duration: 0.1 });
    seekPreviewFrame(short);
    expect(short.currentTime).toBe(0.05);
  });

  it("waits for seekable metadata and never resets playback or a chosen frame", () => {
    for (const state of [
      { duration: Number.NaN },
      { duration: Number.POSITIVE_INFINITY },
      { duration: 0 },
      { seeking: true },
      { paused: false },
      { currentTime: 3 },
      { seekable: { length: 0, start: () => 0, end: () => 0 } },
    ]) {
      const video = media(state);
      const before = video.currentTime;
      seekPreviewFrame(video);
      expect(video.currentTime).toBe(before);
    }
    const late = media({ seekable: { length: 1, start: () => 0, end: () => 0 } });
    seekPreviewFrame(late);
    expect(late.currentTime).toBe(0);
    Object.defineProperty(late, "seekable", { value: { length: 1, end: () => 5 } });
    seekPreviewFrame(late);
    expect(late.currentTime).toBe(0.2);
  });
});
