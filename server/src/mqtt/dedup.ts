/**
 * Dedup on `(deviceId, bootId, seq)` (§5.1) before a message reaches CSV, broadcast or
 * the DB. The DB unique keys (`on conflict do nothing`) stay as the backstop, e.g.
 * across a backend restart. Telemetry and events share `seq`, so one window covers both.
 */
export class RecentMessages {
  private readonly seen = new Map<string, Set<string>>();

  constructor(private readonly perDevice = 256) {}

  /** `true` the first time a key is seen; `false` for a duplicate. */
  firstSeen(deviceId: string, bootId: string, seq: number): boolean {
    let keys = this.seen.get(deviceId);
    if (!keys) {
      keys = new Set();
      this.seen.set(deviceId, keys);
    }
    const key = `${bootId}:${seq}`;
    if (keys.has(key)) return false;
    keys.add(key);
    if (keys.size > this.perDevice) {
      // Set iterates in insertion order: drop the oldest key
      const oldest = keys.values().next().value;
      if (oldest !== undefined) keys.delete(oldest);
    }
    return true;
  }
}
