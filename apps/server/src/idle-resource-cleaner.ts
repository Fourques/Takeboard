import type { ComfyClient } from "@takeboard/executor-comfy";

/** Only watch endpoints on which TakeBoard just finished work. Never stop processes. */
export class IdleResourceCleaner {
  private readonly pending = new Map<ComfyClient, number>();
  constructor(
    private readonly delayMs = 120_000,
    private readonly now = Date.now,
  ) {}
  track(client: ComfyClient) {
    this.pending.set(client, this.now());
  }
  async tick() {
    for (const [client, since] of this.pending) {
      try {
        if (!(await client.isIdle())) {
          if (this.pending.get(client) === since) this.pending.set(client, this.now());
          continue;
        }
        if (this.now() - since < this.delayMs) continue;
        if (await client.freeResourcesIfIdle()) {
          if (this.pending.get(client) === since) this.pending.delete(client);
        }
      } catch {
        // Offline is not idle. Require another full grace period after recovery.
        if (this.pending.get(client) === since) this.pending.set(client, this.now());
      }
    }
  }
  clear() {
    this.pending.clear();
  }
  async releaseOnExit() {
    // No grace period when this server is exiting, but never bypass the queue check.
    await Promise.allSettled(
      [...this.pending.keys()].map((client) =>
        client.freeResourcesIfIdle(AbortSignal.timeout(2000)),
      ),
    );
    this.clear();
  }
}
