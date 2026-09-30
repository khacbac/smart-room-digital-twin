import { describe, expect, it } from "vitest";
import { CommandAck, CommandMessage, CommandRequest, DeviceEvent, Status, Telemetry } from "../src";

// Payloads shaped like the ones device/lib/protocol builds (spec §5.3–§5.7).
const telemetry = {
  v: 1,
  deviceId: "room-01",
  bootId: "a1b2c3d4",
  seq: 1532,
  ts: 1790591200123,
  temperature: 31.2,
  humidity: 75.4,
  light: 420.5,
  airQuality: 680,
  presence: true,
  edgeState: "WARNING",
  actuators: { windowAngle: 0, buzzer: false },
  override: { window: false, buzzer: false },
};

const status = {
  v: 1,
  deviceId: "room-01",
  online: true,
  bootId: "a1b2c3d4",
  ts: 1790591200123,
  fw: "0.1.0",
  uptimeSec: 3605,
  rssi: -55,
  edgeState: "WARNING",
  actuators: { windowAngle: 0, buzzer: false },
  override: { window: false, buzzer: false, expiresInSec: 0 },
  sensorFault: { dht: false },
};

const ack = {
  v: 1,
  deviceId: "room-01",
  commandId: "7f1c2a9e-4b1d-4a5e-9d7a-2b6c1f0e8a11",
  status: "executed",
  reason: null,
  ts: 1790591200350,
  actuators: { windowAngle: 90, buzzer: false },
  override: { window: true, buzzer: false, expiresInSec: 120 },
};

describe("Telemetry", () => {
  it("accepts the §5.3 example", () => {
    expect(Telemetry.safeParse(telemetry).success).toBe(true);
  });

  it("accepts null temperature/humidity (DHT fault) and null ts (no NTP yet)", () => {
    const r = Telemetry.safeParse({ ...telemetry, temperature: null, humidity: null, ts: null });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown contract version", () => {
    expect(Telemetry.safeParse({ ...telemetry, v: 2 }).success).toBe(false);
  });

  it.each([
    ["temperature", 80.1],
    ["humidity", -1],
    ["light", 100001],
    ["airQuality", 1001],
  ])("rejects %s out of range", (field, value) => {
    expect(Telemetry.safeParse({ ...telemetry, [field]: value }).success).toBe(false);
  });

  it("rejects a bad deviceId, bootId or edgeState", () => {
    expect(Telemetry.safeParse({ ...telemetry, deviceId: "Room 01" }).success).toBe(false);
    expect(Telemetry.safeParse({ ...telemetry, bootId: "a1b2c3" }).success).toBe(false);
    expect(Telemetry.safeParse({ ...telemetry, edgeState: "PANIC" }).success).toBe(false);
  });

  it("rejects missing light (always present, §5.3)", () => {
    const { light: _light, ...rest } = telemetry;
    expect(Telemetry.safeParse(rest).success).toBe(false);
  });
});

describe("Status (union on online, §5.4)", () => {
  it("accepts the online status", () => {
    const r = Status.safeParse(status);
    expect(r.success && r.data.online).toBe(true);
  });

  it("accepts the Last Will", () => {
    const r = Status.safeParse({ v: 1, deviceId: "room-01", online: false });
    expect(r.success && r.data.online).toBe(false);
  });

  it("allows extra fields on the offline variant", () => {
    expect(Status.safeParse({ v: 1, deviceId: "room-01", online: false, bootId: "x" }).success).toBe(true);
  });

  it("requires the full schema when online", () => {
    const { sensorFault: _sf, ...rest } = status;
    expect(Status.safeParse(rest).success).toBe(false);
  });
});

describe("DeviceEvent", () => {
  const event = {
    v: 1,
    deviceId: "room-01",
    bootId: "a1b2c3d4",
    seq: 1533,
    ts: 1790591200500,
    type: "STATE_CHANGED",
    severity: "critical",
    message: "WARNING -> DANGER",
    data: { from: "WARNING", to: "DANGER", reasons: ["airQuality>=900"] },
  };

  it("accepts the §5.5 example", () => {
    expect(DeviceEvent.safeParse(event).success).toBe(true);
  });

  it("accepts a button OVERRIDE_SET (source: button is only in data)", () => {
    const r = DeviceEvent.safeParse({
      ...event,
      type: "OVERRIDE_SET",
      severity: "info",
      data: { actuator: "buzzer", value: false, durationSec: 120, source: "button" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown type", () => {
    expect(DeviceEvent.safeParse({ ...event, type: "REBOOTED" }).success).toBe(false);
  });
});

describe("CommandAck", () => {
  it("accepts the §5.7 example", () => {
    expect(CommandAck.safeParse(ack).success).toBe(true);
  });

  it("accepts a rejected ack with a reason", () => {
    const r = CommandAck.safeParse({ ...ack, status: "rejected", reason: "VALUE_OUT_OF_RANGE" });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown ack status", () => {
    expect(CommandAck.safeParse({ ...ack, status: "timeout" }).success).toBe(false);
  });
});

describe("CommandMessage", () => {
  it("accepts the §5.6 example and requires a UUID commandId", () => {
    const msg = { v: 1, commandId: ack.commandId, action: "OPEN_WINDOW", value: 90, source: "dashboard", ts: 1 };
    expect(CommandMessage.safeParse(msg).success).toBe(true);
    expect(CommandMessage.safeParse({ ...msg, commandId: "t-1" }).success).toBe(false);
  });
});

describe("CommandRequest (§9.6)", () => {
  it("accepts OPEN_WINDOW with and without a value", () => {
    expect(CommandRequest.safeParse({ action: "OPEN_WINDOW", value: 45 }).success).toBe(true);
    expect(CommandRequest.safeParse({ action: "OPEN_WINDOW" }).success).toBe(true);
  });

  it.each([0, 91, 45.5])("rejects OPEN_WINDOW value %s", (value) => {
    expect(CommandRequest.safeParse({ action: "OPEN_WINDOW", value }).success).toBe(false);
  });

  it("ignores value for other actions", () => {
    expect(CommandRequest.safeParse({ action: "CLOSE_WINDOW", value: 500 }).success).toBe(true);
  });

  it("only allows dashboard or ai as source", () => {
    expect(CommandRequest.safeParse({ action: "PING", source: "ai" }).success).toBe(true);
    expect(CommandRequest.safeParse({ action: "PING", source: "api" }).success).toBe(false);
  });

  it("rejects an unknown action", () => {
    expect(CommandRequest.safeParse({ action: "REBOOT" }).success).toBe(false);
  });
});
