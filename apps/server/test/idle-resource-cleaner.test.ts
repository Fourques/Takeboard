import { ComfyClient } from "@takeboard/executor-comfy";
import { describe, expect, it } from "vitest";
import { IdleResourceCleaner } from "../src/idle-resource-cleaner.js";

class Client extends ComfyClient {
  idle = true;
  offline = false;
  releases = 0;
  constructor() {
    super("http://unused.test", { liveProgress: false });
  }
  override async isIdle() {
    if (this.offline) throw new Error("offline");
    return this.idle;
  }
  override async freeResourcesIfIdle() {
    if (!this.idle) return false;
    this.releases++;
    return true;
  }
}
describe("idle model cache release", () => {
  it("releases tracked idle caches on exit but never interrupts a busy endpoint", async () => {
    const cleaner = new IdleResourceCleaner();
    const idle = new Client();
    const busy = new Client();
    busy.idle = false;
    cleaner.track(idle);
    cleaner.track(busy);
    await cleaner.releaseOnExit();
    expect(idle.releases).toBe(1);
    expect(busy.releases).toBe(0);
    busy.idle = true;
    await cleaner.releaseOnExit();
    expect(busy.releases).toBe(0);
  });
  it("keeps a grace period and releases once, without stopping a service", async () => {
    let now = 0;
    const cleaner = new IdleResourceCleaner(120, () => now);
    const client = new Client();
    cleaner.track(client);
    now = 119;
    await cleaner.tick();
    expect(client.releases).toBe(0);
    now = 120;
    await cleaner.tick();
    expect(client.releases).toBe(1);
    now = 999;
    await cleaner.tick();
    expect(client.releases).toBe(1);
  });
  it("restarts the grace period when another client has running or queued work", async () => {
    let now = 0;
    const cleaner = new IdleResourceCleaner(120, () => now);
    const client = new Client();
    cleaner.track(client);
    client.idle = false;
    now = 200;
    await cleaner.tick();
    client.idle = true;
    now = 300;
    await cleaner.tick();
    expect(client.releases).toBe(0);
    now = 320;
    await cleaner.tick();
    expect(client.releases).toBe(1);
  });
  it("does not treat unavailable telemetry as idle or touch untracked endpoints", async () => {
    let now = 0;
    const cleaner = new IdleResourceCleaner(120, () => now);
    const client = new Client();
    now = 200;
    await cleaner.tick();
    expect(client.releases).toBe(0);
    cleaner.track(client);
    client.offline = true;
    now = 500;
    await cleaner.tick();
    client.offline = false;
    now = 600;
    await cleaner.tick();
    expect(client.releases).toBe(0);
    now = 620;
    await cleaner.tick();
    expect(client.releases).toBe(1);
  });
});
