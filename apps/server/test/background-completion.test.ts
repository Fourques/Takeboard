import { expect, it, vi } from "vitest";
import { BackgroundCompletion } from "../src/background-completion.js";

it("ends cleanup instead of keeping a daemon on unknown task state", async () => {
  const controller = new BackgroundCompletion();
  const close = vi.fn(async () => {});
  await controller.drain(async () => {
    throw new Error("unreadable");
  }, close);
  expect(controller.interrupted).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});
it("bounds unfinished work and does not retry generation", async () => {
  const controller = new BackgroundCompletion();
  const close = vi.fn(async () => {});
  const pending = vi.fn(async () => true);
  await controller.drain(pending, close, async () => {}, 0);
  expect(pending).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(controller.interrupted).toBe(true);
});
