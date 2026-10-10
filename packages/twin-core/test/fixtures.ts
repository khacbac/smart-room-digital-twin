import type { CommandRecord, DeviceRecord, EventRecord, TelemetryRecord } from "@srdt/contracts";

export const T0 = Date.parse("2026-10-10T08:00:00.000Z");
export const iso = (ms: number) => new Date(ms).toISOString();

export function device(over: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    code: "room-01",
    name: "Room 01",
    presence: "online",
    edgeState: "NORMAL",
    fwVersion: "1.0.0",
    bootId: "a1b2c3d4",
    reported: null,
    lastSeenAt: iso(T0),
    createdAt: iso(T0 - 3600_000),
    updatedAt: iso(T0),
    ...over,
  };
}

export function telemetry(seq: number, at: number, over: Partial<TelemetryRecord> = {}): TelemetryRecord {
  return {
    id: `t-${seq}`,
    deviceCode: "room-01",
    bootId: "a1b2c3d4",
    seq,
    measuredAt: iso(at),
    receivedAt: iso(at),
    temperature: 27,
    humidity: 60,
    light: 300,
    airQuality: 200,
    presence: true,
    edgeState: "NORMAL",
    windowAngle: 0,
    buzzer: false,
    overrideActive: false,
    mlState: null,
    aiControl: false,
    ...over,
  };
}

export function event(id: string, at: number): EventRecord {
  return {
    id,
    deviceCode: "room-01",
    source: "device",
    bootId: "a1b2c3d4",
    seq: 1,
    type: "STATE_CHANGED",
    severity: "warning",
    message: "state changed",
    data: {},
    measuredAt: iso(at),
    createdAt: iso(at),
  };
}

export function command(id: string, at: number, over: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id,
    deviceCode: "room-01",
    action: "OPEN_WINDOW",
    value: 45,
    source: "dashboard",
    status: "pending",
    reason: null,
    ack: null,
    createdAt: iso(at),
    sentAt: null,
    ackedAt: null,
    ...over,
  };
}
