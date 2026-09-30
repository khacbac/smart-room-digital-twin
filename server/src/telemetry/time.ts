/** §5.1: a device `ts` is used only when it is within ±5 min of server time. */
export const TS_MAX_SKEW_MS = 5 * 60 * 1000;

export function isTsValid(ts: number | null, nowMs: number): ts is number {
  return ts !== null && Math.abs(ts - nowMs) <= TS_MAX_SKEW_MS;
}

/** `measured_at` (epoch ms): the device `ts` if valid, otherwise the server receive time. */
export function measuredAtMs(ts: number | null, receivedAtMs: number): number {
  return isTsValid(ts, receivedAtMs) ? ts : receivedAtMs;
}
