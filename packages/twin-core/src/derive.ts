import type { DeviceRecord, EdgeState, ReportedState, TelemetryRecord } from "@srdt/contracts";
import { STATE_LABEL, countdown, toMs } from "./format";

/** Online, but the newest telemetry is older than this → "Stale data". */
export const STALE_AFTER_MS = 15_000;

export interface RoomView {
  online: boolean;
  /** Newest of the last telemetry and the device's lastSeenAt, by receive time. */
  lastSeenAt: number | null;
  stale: boolean;
  edgeState: EdgeState | null;
  windowAngle: number | null;
  buzzer: boolean | null;
  override: ReportedState["override"] | undefined;
  /** undefined: no telemetry yet; null: the device has no model or no valid input. */
  mlState: EdgeState | null | undefined;
  aiControl: boolean;
}

export function deriveRoomView(
  device: DeviceRecord,
  live: TelemetryRecord | null,
  lastTelemetryAt: number | null,
  now: number,
): RoomView {
  const reported = device.reported;
  const online = device.presence === "online";
  return {
    online,
    // Receive times, not the device's measuredAt: a slow simulator makes the device clock lag.
    lastSeenAt: Math.max(lastTelemetryAt ?? 0, toMs(device.lastSeenAt) ?? 0) || null,
    stale: online && lastTelemetryAt !== null && now - lastTelemetryAt > STALE_AFTER_MS,
    edgeState: live?.edgeState ?? device.edgeState,
    // The reported status is sent right after every change, telemetry every 2 s.
    windowAngle: reported?.actuators.windowAngle ?? live?.windowAngle ?? null,
    buzzer: reported?.actuators.buzzer ?? live?.buzzer ?? null,
    override: reported?.override,
    mlState: live ? live.mlState : undefined,
    aiControl: live?.aiControl ?? false,
  };
}

/** "Automatic", "Window + alarm (1:42)", "Window (ending…)"; "Awaiting state" before the first status. */
export function overrideText(override: ReportedState["override"] | undefined, now: number): string {
  if (!override) return "Awaiting state";
  if (!override.window && !override.buzzer) return "Automatic";
  const which = [override.window && "Window", override.buzzer && "alarm"].filter(Boolean).join(" + ");
  const expires = toMs(override.expiresAt);
  // expiresAt is null for a retained status without a valid ts (§9.3): no countdown then
  if (expires === null) return which;
  const left = (expires - now) / 1000;
  return left > 0 ? `${which} (${countdown(left)})` : `${which} (ending…)`;
}

/** "Warning · active", "no input", or null when the device sends no model state. */
export function mlText(mlState: EdgeState | null | undefined, aiControl: boolean): string | null {
  if (mlState === undefined) return null;
  if (mlState === null) return "no input";
  return `${STATE_LABEL[mlState]} · ${aiControl ? "active" : "advisory"}`;
}
