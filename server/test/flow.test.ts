import { describe, expect, it, vi } from "vitest";
import type { CommandAck, StreamMessage } from "@srdt/contracts";
import { pino } from "pino";
import { CommandService, type CommandPublisher } from "../src/commands/command.service";
import { RateLimiter } from "../src/commands/rate-limit";
import { DeviceService } from "../src/devices/device.service";
import { EventService } from "../src/events/event.service";
import { RecentMessages } from "../src/mqtt/dedup";
import { createMessageHandler } from "../src/mqtt/handlers";
import type { Publisher } from "../src/realtime/hub";
import { createMemoryStorage } from "../src/storage/memory/memory.storage";
import { Downsampler, TelemetryService } from "../src/telemetry/telemetry.service";

// End-to-end through the backend with the in-memory storage: MQTT message → twin state →
// stream, and dashboard command → MQTT → ack → stream.

const log = pino({ level: "silent" });

class Clock {
  ms = Date.parse("2026-09-30T10:00:00.000Z");
  now = () => this.ms;
  advance(ms: number) {
    this.ms += ms;
  }
}

class FakeHub implements Publisher {
  readonly sent: { device: string; msg: StreamMessage }[] = [];
  publish(device: string, msg: StreamMessage) {
    this.sent.push({ device, msg: structuredClone(msg) });
  }
  types() {
    return this.sent.map((s) => s.msg.type);
  }
}

/** PUBACK is under the test's control, so the ack can be made to win the race. */
class FakeMqtt implements CommandPublisher {
  connected = true;
  autoPuback = true;
  readonly published: { topic: string; payload: Record<string, unknown> }[] = [];
  private pending: (() => void)[] = [];
  isConnected() {
    return this.connected;
  }
  publishCommand(topic: string, payload: string) {
    this.published.push({ topic, payload: JSON.parse(payload) });
    if (this.autoPuback) return Promise.resolve();
    return new Promise<void>((resolve) => this.pending.push(resolve));
  }
  puback() {
    this.pending.shift()?.();
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup() {
  const clock = new Clock();
  const storage = createMemoryStorage(undefined, clock.now);
  const hub = new FakeHub();
  const mqtt = new FakeMqtt();
  const events = new EventService(storage.events, hub, log, clock.now);
  const devices = new DeviceService(
    storage.devices,
    events,
    hub,
    { autoRegister: true, offlineAfterMs: 45_000, seed: ["room-01"] },
    log,
    clock.now,
  );
  await devices.load();
  const telemetry = new TelemetryService(storage.telemetry, hub, new Downsampler(5000), log);
  const commands = new CommandService(
    storage.commands,
    mqtt,
    events,
    hub,
    { prefix: "srdt", ackTimeoutMs: 10_000, respondWithinMs: 50 },
    log,
    new RateLimiter(),
    clock.now,
  );
  const handle = createMessageHandler({
    prefix: "srdt",
    devices,
    dedup: new RecentMessages(),
    telemetry,
    events,
    commands,
    log,
    now: clock.now,
  });
  const receive = (kind: string, body: object, retain = false) =>
    handle(`srdt/room-01/${kind}`, Buffer.from(JSON.stringify(body)), retain);
  return { clock, storage, hub, mqtt, devices, commands, handle, receive };
}

let seq = 0;
function telemetryMsg(patch: object = {}) {
  return {
    v: 1,
    deviceId: "room-01",
    bootId: "a1b2c3d4",
    seq: seq++,
    ts: null,
    temperature: 26.5,
    humidity: 65,
    light: 420,
    airQuality: 300,
    presence: true,
    edgeState: "NORMAL",
    actuators: { windowAngle: 0, buzzer: false },
    override: { window: false, buzzer: false },
    ...patch,
  };
}

function statusMsg(patch: object = {}) {
  return {
    v: 1,
    deviceId: "room-01",
    online: true,
    bootId: "a1b2c3d4",
    ts: null,
    fw: "0.1.0",
    uptimeSec: 10,
    rssi: -50,
    edgeState: "NORMAL",
    actuators: { windowAngle: 0, buzzer: false },
    override: { window: false, buzzer: false, expiresInSec: 0 },
    sensorFault: { dht: false },
    ...patch,
  };
}

function ack(commandId: string, status: CommandAck["status"] = "executed"): CommandAck {
  return {
    v: 1,
    deviceId: "room-01",
    commandId,
    status,
    reason: null,
    ts: null,
    actuators: { windowAngle: 0, buzzer: false },
    override: { window: true, buzzer: false, expiresInSec: 120 },
  };
}

describe("uplink", () => {
  it("telemetry marks the device online, streams every message and stores a downsampled copy", async () => {
    const t = await setup();
    await t.receive("telemetry", telemetryMsg());
    t.clock.advance(2000);
    await t.receive("telemetry", telemetryMsg());

    expect(t.devices.get("room-01")?.presence).toBe("online");
    expect(t.hub.types().filter((x) => x === "telemetry")).toHaveLength(2);
    expect(t.hub.types()).toContain("event"); // DEVICE_ONLINE
    const stored = await t.storage.telemetry.recent("room-01", new Date(0), 100);
    expect(stored).toHaveLength(1); // second one is within the 5 s persist interval
    expect(stored[0]).toMatchObject({ deviceCode: "room-01", airQuality: 300, windowAngle: 0 });
  });

  it("drops duplicates, invalid JSON and schema errors", async () => {
    const t = await setup();
    const msg = telemetryMsg();
    await t.receive("telemetry", msg);
    await t.receive("telemetry", msg);
    await t.handle("srdt/room-01/telemetry", Buffer.from("not json"), false);
    await t.receive("telemetry", { ...telemetryMsg(), airQuality: 5000 });
    expect(t.hub.types().filter((x) => x === "telemetry")).toHaveLength(1);
  });

  it("status fills the reported state; LWT marks the device offline", async () => {
    const t = await setup();
    await t.receive("status", {
      v: 1,
      deviceId: "room-01",
      online: true,
      bootId: "a1b2c3d4",
      ts: null,
      fw: "0.1.0",
      uptimeSec: 10,
      rssi: -50,
      edgeState: "WARNING",
      actuators: { windowAngle: 90, buzzer: false },
      override: { window: true, buzzer: false, expiresInSec: 100 },
      sensorFault: { dht: false },
    });
    const d = t.devices.get("room-01");
    expect(d?.presence).toBe("online");
    expect(d?.reported?.actuators.windowAngle).toBe(90);
    expect(d?.reported?.override.expiresAt).toBe(new Date(t.clock.ms + 100_000).toISOString());

    await t.receive("status", { v: 1, deviceId: "room-01", online: false }, true);
    expect(t.devices.get("room-01")?.presence).toBe("offline");
  });

  it("streams every device change but writes the document on a throttle", async () => {
    const t = await setup();
    const put = vi.spyOn(t.storage.devices, "put");

    await t.receive("telemetry", telemetryMsg());
    expect(put).toHaveBeenCalledTimes(1); // DEVICE_ONLINE must survive a restart

    // Two minutes of status: `reported` differs every time (uptimeSec, rssi), which used
    // to mean one write per message — the dominant Firestore cost (docs/cloud.md §2).
    for (let i = 0; i < 8; i += 1) {
      t.clock.advance(15_000);
      await t.receive("status", statusMsg({ uptimeSec: 10 + i, rssi: -50 - i }));
    }
    expect(put.mock.calls.length).toBeLessThanOrEqual(3); // ~1 per DEVICE_PERSIST_INTERVAL_MS
    expect(t.hub.types().filter((x) => x === "device").length).toBeGreaterThanOrEqual(8);

    // A durable change does not wait for the throttle.
    const before = put.mock.calls.length;
    t.clock.advance(1000);
    await t.receive("status", statusMsg({ edgeState: "WARNING" }));
    expect(put.mock.calls.length).toBe(before + 1);
  });

  it("a retained online status updates the reported state but never counts as presence", async () => {
    const t = await setup();
    await t.receive(
      "status",
      {
        v: 1,
        deviceId: "room-01",
        online: true,
        bootId: "a1b2c3d4",
        ts: null,
        fw: "0.1.0",
        uptimeSec: 10,
        rssi: -50,
        edgeState: "NORMAL",
        actuators: { windowAngle: 0, buzzer: false },
        override: { window: false, buzzer: false, expiresInSec: 0 },
        sensorFault: { dht: false },
      },
      true,
    );
    expect(t.devices.get("room-01")?.presence).toBe("unknown");
    expect(t.devices.get("room-01")?.reported?.fw).toBe("0.1.0");
  });
});

describe("downlink (command round trip)", () => {
  it("pending → sent → executed, every step streamed", async () => {
    const t = await setup();
    await t.receive("telemetry", telemetryMsg());
    const device = t.devices.get("room-01")!;
    const res = await t.commands.create(device, { action: "OPEN_WINDOW", value: 45, source: "dashboard" });
    expect(res).toMatchObject({ kind: "accepted", status: "sent" });
    if (res.kind !== "accepted") return;
    expect(t.mqtt.published[0]).toMatchObject({
      topic: "srdt/room-01/command",
      payload: { v: 1, commandId: res.commandId, action: "OPEN_WINDOW", value: 45, source: "dashboard" },
    });

    await t.receive("command/ack", ack(res.commandId));
    const statuses = t.hub.sent
      .filter((s) => s.msg.type === "command")
      .map((s) => (s.msg.type === "command" ? s.msg.data.status : null));
    expect(statuses).toEqual(["pending", "sent", "executed"]);
  });

  it("an ack before the PUBACK is kept", async () => {
    const t = await setup();
    await t.receive("telemetry", telemetryMsg());
    t.mqtt.autoPuback = false;
    const res = await t.commands.create(t.devices.get("room-01")!, { action: "PING" });
    if (res.kind !== "accepted") throw new Error("not accepted");
    expect(res.status).toBe("pending");
    await t.receive("command/ack", ack(res.commandId));
    t.mqtt.puback();
    await flush();
    const row = await t.storage.commands.get(res.commandId);
    expect(row?.status).toBe("executed");
    expect(row?.sentAt).not.toBeNull();
  });

  it("offline device → device_offline; broker down → broker_disconnected", async () => {
    const t = await setup();
    const device = t.devices.get("room-01")!;
    expect(await t.commands.create(device, { action: "CLOSE_WINDOW" })).toMatchObject({ kind: "device_offline" });
    await t.receive("telemetry", telemetryMsg());
    t.mqtt.connected = false;
    expect(await t.commands.create(device, { action: "CLOSE_WINDOW" })).toMatchObject({
      kind: "broker_disconnected",
    });
  });

  it("no ack → timeout + COMMAND_TIMEOUT event; a late ack does not change it", async () => {
    const t = await setup();
    await t.receive("telemetry", telemetryMsg());
    const res = await t.commands.create(t.devices.get("room-01")!, { action: "BUZZER_OFF" });
    if (res.kind !== "accepted") throw new Error("not accepted");
    t.clock.advance(11_000);
    await t.commands.sweepTimeouts();
    expect((await t.storage.commands.get(res.commandId))?.status).toBe("timeout");
    const events = await t.storage.events.recent("room-01", 10);
    expect(events.map((e) => e.type)).toContain("COMMAND_TIMEOUT");

    await t.receive("command/ack", ack(res.commandId));
    expect((await t.storage.commands.get(res.commandId))?.status).toBe("timeout");
  });
});
