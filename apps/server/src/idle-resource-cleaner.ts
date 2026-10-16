import type { ComfyClient } from "@takeboard/executor-comfy";

/** Only watch endpoints on which TakeBoard just finished work. Never stop processes. */
export class IdleResourceCleaner {
  private readonly pending = new Map<ComfyClient, { since: number; isCurrent: () => boolean }>();
  constructor(
    private readonly delayMs = 120_000,
    private readonly now = Date.now,
  ) {}
  track(client: ComfyClient, isCurrent: () => boolean = () => true) {
    this.pending.set(client, { since: this.now(), isCurrent });
  }
  async tick() {
    for (const [client, entry] of this.pending) {
      try {
        if (!entry.isCurrent()) {
          if (this.pending.get(client) === entry) this.pending.delete(client);
          continue;
        }
        if (!(await client.isIdle())) {
          if (this.pending.get(client) === entry) entry.since = this.now();
          continue;
        }
        if (this.pending.get(client) !== entry || !entry.isCurrent()) continue;
        if (this.now() - entry.since < this.delayMs) continue;
        if (
          await client.freeResourcesIfIdle(
            undefined,
            () => this.pending.get(client) === entry && entry.isCurrent(),
          )
        ) {
          if (this.pending.get(client) === entry) this.pending.delete(client);
        }
      } catch {
        // Offline is not idle. Require another full grace period after recovery.
        if (this.pending.get(client) === entry) entry.since = this.now();
      }
    }
  }
  clear() {
    this.pending.clear();
  }
  async releaseOnExit() {
    // No grace period when this server is exiting, but never bypass the queue check.
    await Promise.allSettled(
      [...this.pending.entries()].map(([client, entry]) =>
        entry.isCurrent()
          ? client.freeResourcesIfIdle(AbortSignal.timeout(2000), entry.isCurrent)
          : Promise.resolve(false),
      ),
    );
    this.clear();
  }
}
