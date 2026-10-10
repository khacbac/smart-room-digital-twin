import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS, deriveRoomView, mlText, overrideText } from "../src";
import { T0, device, iso, telemetry } from "./fixtures";

const reported = (over: { window: boolean; buzzer: boolean; expiresAt: string | null }) => ({
  v: 1 as const,
  deviceId: "room-01",
  online: true as const,
  bootId: "a1b2c3d4",
  ts: T0,
  fw: "1.0.0",
  uptimeSec: 100,
  rssi: -60,
  edgeState: "WARNING" as const,
  actuators: { windowAngle: 45, buzzer: true },
  override: { expiresInSec: 120, ...over },
  sensorFault: { dht: false },
});

describe("deriveRoomView", () => {
  it("prefers the reported actuators over telemetry", () => {
    const v = deriveRoomView(
      device({ reported: reported({ window: true, buzzer: false, expiresAt: null }) }),
      telemetry(1, T0, { windowAngle: 0, buzzer: false, edgeState: "DANGER" }),
      T0,
      T0,
    );
    expect(v.windowAngle).toBe(45);
    expect(v.buzzer).toBe(true);
    expect(v.edgeState).toBe("DANGER");
    expect(v.override?.window).toBe(true);
  });

  it("falls back to telemetry, then null", () => {
    expect(deriveRoomView(device(), telemetry(1, T0, { windowAngle: 30 }), T0, T0).windowAngle).toBe(30);
    const empty = deriveRoomView(device({ edgeState: null }), null, null, T0);
    expect(empty.windowAngle).toBeNull();
    expect(empty.edgeState).toBeNull();
    expect(empty.mlState).toBeUndefined();
  });

  it("is stale only when online and telemetry is older than the limit", () => {
    expect(deriveRoomView(device(), null, T0, T0 + STALE_AFTER_MS + 1).stale).toBe(true);
    expect(deriveRoomView(device(), null, T0, T0 + STALE_AFTER_MS).stale).toBe(false);
    expect(deriveRoomView(device({ presence: "offline" }), null, T0, T0 + 60_000).stale).toBe(false);
    expect(deriveRoomView(device(), null, null, T0).stale).toBe(false);
  });

  it("takes the newest of telemetry receive time and lastSeenAt", () => {
    expect(deriveRoomView(device({ lastSeenAt: iso(T0 - 1000) }), null, T0, T0).lastSeenAt).toBe(T0);
    expect(deriveRoomView(device({ lastSeenAt: iso(T0) }), null, T0 - 1000, T0).lastSeenAt).toBe(T0);
    expect(deriveRoomView(device({ lastSeenAt: null }), null, null, T0).lastSeenAt).toBeNull();
  });
});

describe("overrideText / mlText", () => {
  it("describes the control mode", () => {
    expect(overrideText(undefined, T0)).toBe("Awaiting state");
    expect(overrideText({ window: false, buzzer: false, expiresInSec: 0, expiresAt: null }, T0)).toBe("Automatic");
    expect(overrideText({ window: true, buzzer: true, expiresInSec: 100, expiresAt: iso(T0 + 102_000) }, T0)).toBe(
      "Window + alarm (1:42)",
    );
    expect(overrideText({ window: true, buzzer: false, expiresInSec: 0, expiresAt: iso(T0 - 1) }, T0)).toBe(
      "Window (ending…)",
    );
    expect(overrideText({ window: false, buzzer: true, expiresInSec: 0, expiresAt: null }, T0)).toBe("alarm");
  });

  it("describes the model state", () => {
    expect(mlText(undefined, false)).toBeNull();
    expect(mlText(null, false)).toBe("no input");
    expect(mlText("WARNING", true)).toBe("Warning · active");
  });
});
