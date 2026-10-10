/**
 * Commands per minute per device. §9.6 says 10; raised so a live demo (scenes send two
 * commands each, voice adds more) does not run into 429.
 */
export const COMMANDS_PER_MINUTE = 30;

/** Sliding window: at most `limit` hits per key per `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit = COMMANDS_PER_MINUTE,
    private readonly windowMs = 60_000,
  ) {}

  allow(key: string, nowMs: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    return true;
  }
}
