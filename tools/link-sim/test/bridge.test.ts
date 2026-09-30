import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { CommandAck, DeviceEvent, Status, Telemetry } from "@srdt/contracts";
import { type Broker, GatewayBridge } from "../src/gateway";
import { NodeSim } from "../src/node";
import { memoryPair } from "../src/transport";

// fake-node ⇄ (stream codec in memory) ⇄ fake-gateway ⇄ recording broker, on a fake
// clock. Every published payload must pass the backend's contracts.

interface Published {
  topic: string;
  body: Record<string, unknown>;
  qos: number;
  retain: boolean;
}

const SCHEMAS: Record<string, { safeParse: (v: unknown) => { success: boolean } }> = {
  telemetry: Telemetry,
  status: Status,
  event: DeviceEvent,
  "command/ack": CommandAck,
};

let clock: number;
let published: Published[];
let node: NodeSim;
let gw: GatewayBridge;
let line: ReturnType<typeof memoryPair>;

const kind = (p: Published) => p.topic.split("/").slice(2).join("/");
const ofKind = (k: string) => published.filter((p) => kind(p) === k);
const last = (k: string) => ofKind(k).at(-1);

function makeGateway() {
  const broker: Broker = {
    publish(topic, payload, o) {
      published.push({ topic, body: JSON.parse(payload.toString()), qos: o.qos, retain: o.retain });
    },
  };
  gw = new GatewayBridge({ nodeId: "room-01", prefix: "srdt", link: line.b, broker, now: () => clock });
  line.b.onFrame((f) => gw.onFrame(f));
}

/** Advances the fake clock like the scripts' timers: tick every 1 s, step every 2 s. */
function run(ms: number) {
  for (let t = 0; t < ms; t += 1000) {
    clock += 1000;
    node.tick();
    gw.tick();
    if ((clock / 1000) % 2 === 0) node.step();
  }
}

beforeEach(() => {
  clock = 1_000_000;
  published = [];
  line = memoryPair();
  makeGateway();
  node = new NodeSim({ deviceId: "room-01", link: line.a, now: () => clock });
  line.a.onFrame((f) => node.onFrame(f));
  gw.onBrokerUp();
  gw.start();
  node.start();
});

describe("node ⇄ gateway bridge", () => {
  it("boot: offline first, then HELLO → status online (retained) + BOOT, then telemetry", () => {
    expect(published[0]).toMatchObject({ topic: "srdt/room-01/status", body: { online: false }, retain: true });
    const status = ofKind("status")[1]!;
    expect(status).toMatchObject({ qos: 1, retain: true, body: { online: true, deviceId: "room-01" } });
    expect(typeof status.body.ts).toBe("number"); // TIME arrived before LINK_STATE
    expect(ofKind("event")[0]?.body).toMatchObject({ type: "BOOT" });

    run(10_000);
    expect(ofKind("telemetry").length).toBe(5);
    expect(gw.registered?.bootId).toBe(node.bootId);
  });

  it("every published payload passes the backend contracts", () => {
    node.room.steer("smoke");
    run(60_000);
    expect(ofKind("event").some((p) => p.body.type === "STATE_CHANGED")).toBe(true);
    for (const p of published) {
      const schema = SCHEMAS[kind(p)];
      expect(schema, p.topic).toBeDefined();
      expect(schema!.safeParse(p.body).success, `${p.topic} ${JSON.stringify(p.body)}`).toBe(true);
    }
  });

  it("command: forwarded untouched, status before ack, duplicate re-acked", () => {
    run(4000);
    const commandId = randomUUID();
    const cmd = Buffer.from(JSON.stringify({ v: 1, commandId, action: "OPEN_WINDOW", value: 45, source: "dashboard", ts: clock }));
    const before = published.length;
    gw.onCommand(cmd);
    const after = published.slice(before).map(kind);
    expect(after).toEqual(["status", "command/ack"]);
    expect(last("command/ack")?.body).toMatchObject({ commandId, status: "executed", actuators: { windowAngle: 45 } });

    gw.onCommand(cmd); // QoS 1 redelivery
    expect(published.slice(before + 2).map(kind)).toEqual(["command/ack"]);

    gw.onCommand(Buffer.from(JSON.stringify({ v: 1, commandId: "x-1", action: "FLY" })));
    expect(last("command/ack")?.body).toMatchObject({ commandId: "x-1", status: "rejected", reason: "INVALID_PAYLOAD" });
  });

  it("node goes quiet → offline status after 15 s; back → online again", () => {
    run(4000);
    line.cut(true);
    run(14_000);
    expect(last("status")?.body.online).toBe(true);
    run(2000);
    expect(last("status")).toMatchObject({ body: { online: false }, retain: true });

    // Both sides saw the other go quiet; when the line is back the node re-sends its status.
    line.cut(false);
    run(6000);
    expect(last("status")?.body.online).toBe(true);
    expect(gw.node.up && node.mqttUp).toBe(true);
  });

  it("commands for a node that is down are dropped", () => {
    line.cut(true);
    run(16_000);
    const before = published.length;
    gw.onCommand(Buffer.from(JSON.stringify({ v: 1, commandId: randomUUID(), action: "PING", source: "api", ts: clock })));
    expect(published.length).toBe(before);
    expect(gw.counters.commands).toBe(0);
  });

  it("broker down: node stops sending telemetry; broker up: status re-sent", () => {
    run(4000);
    gw.setForcedDown(true);
    const n = ofKind("telemetry").length;
    run(10_000);
    expect(ofKind("telemetry").length).toBe(n);
    expect(node.mqttUp).toBe(false);

    const statuses = ofKind("status").length;
    gw.setForcedDown(false);
    expect(ofKind("status").length).toBe(statuses + 1);
    run(4000);
    expect(ofKind("telemetry").length).toBeGreaterThan(n);
  });

  it("gateway restart: HELLO_REQUEST → HELLO → status, no second BOOT", () => {
    run(4000);
    makeGateway(); // fresh bridge on the same line, node keeps running
    gw.onBrokerUp();
    gw.start();
    expect(gw.registered?.bootId).toBe(node.bootId);
    expect(last("status")?.body.online).toBe(true);
    expect(ofKind("event").filter((p) => p.body.type === "BOOT").length).toBe(1);
  });

  it("node reboot: new bootId registered, BOOT again", () => {
    run(4000);
    const old = node.bootId;
    node.reboot();
    run(2000);
    expect(gw.registered?.bootId).not.toBe(old);
    expect(ofKind("event").filter((p) => p.body.type === "BOOT").length).toBe(2);
  });

  it("lost HELLO: nothing is published before registration, BOOT is not lost", () => {
    // The first HELLO goes out before the line is up (TCP still connecting).
    published = [];
    line = memoryPair();
    makeGateway();
    node = new NodeSim({ deviceId: "room-01", link: line.a, now: () => clock });
    line.a.onFrame((f) => node.onFrame(f));
    line.cut(true);
    gw.onBrokerUp();
    gw.start();
    node.start();
    line.cut(false);
    expect(ofKind("status").filter((p) => p.body.online).length).toBe(0);

    run(6000); // next LINK_STATE heartbeat has no bootId → node sends HELLO again
    expect(gw.registered?.bootId).toBe(node.bootId);
    expect(ofKind("status").some((p) => p.body.online)).toBe(true);
    expect(ofKind("event").filter((p) => p.body.type === "BOOT").length).toBe(1);
    // Only a HEARTBEAT may arrive before HELLO; every data frame was published.
    expect(gw.counters.published).toBe(gw.counters.uplink);
  });

  it("HELLO for another node id is refused", () => {
    const other = new NodeSim({ deviceId: "room-99", link: line.a, now: () => clock });
    line.a.onFrame((f) => other.onFrame(f));
    makeGateway();
    gw.onBrokerUp();
    gw.start();
    expect(gw.registered).toBeNull();
  });
});
