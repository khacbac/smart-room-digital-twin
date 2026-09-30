import { randomBytes } from "node:crypto";
import { CommandMessage } from "@srdt/contracts";
import { type Frame, Type, fromNode, typeName } from "./frame";
import { LinkState, TimeSync, buildHello, parseJson } from "./messages";
import { PeerMonitor, TxTracker } from "./peer";
import { RoomSim } from "./room";
import type { FrameSink } from "./transport";

// What the node firmware does on the link (docs/link-protocol.md §4.3, §5), with a
// simulated room instead of sensors. The payloads are the same §5 JSON the firmware
// builds with lib/protocol. Drive it with tick() every second and step() every 2 s.

export const TELEMETRY_INTERVAL_MS = 2000;
export const STATUS_INTERVAL_MS = 30_000;
const DEDUP_SIZE = 16; // COMMAND_DEDUP_SIZE
const HELLO_MIN_MS = 1000;

export interface NodeOptions {
  deviceId: string;
  link: FrameSink;
  now?: () => number;
  log?: (msg: string) => void;
  fw?: string;
}

export class NodeSim {
  readonly deviceId: string;
  readonly room: RoomSim;
  bootId = randomBytes(4).toString("hex");
  /** Gateway presence (every gateway frame counts, LINK_STATE doubles as its heartbeat). */
  readonly gateway = new PeerMonitor();
  linkState: LinkState = { mqtt: false };
  /** Simulated outage: send nothing, ignore everything (the "die" stdin command). */
  silentUntil = 0;

  private tx = new TxTracker();
  private link: FrameSink;
  private now: () => number;
  private log: (msg: string) => void;
  private fw: string;
  private startedAt: number;
  private seq = 0; // §5.1 seq of telemetry and events (not the link seq)
  private timeOffset: number | null = null; // epoch ms − local clock, from TIME
  private statusPending = true; // send a status as soon as the path to MQTT is up (§5.2)
  private bootPending = true;
  private lastStatusAt = 0;
  private lastHelloAt = -Infinity;
  private lastMqttUp = false;
  private seen: { id: string; ack: object }[] = [];

  constructor(opts: NodeOptions) {
    this.deviceId = opts.deviceId;
    this.link = opts.link;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.fw = opts.fw ?? "fake-node-0.1.0";
    this.room = new RoomSim(this.now);
    this.startedAt = this.now();
  }

  /** The gateway is reachable, has registered this boot, and is connected to the broker. */
  get mqttUp() {
    return this.gateway.up && this.linkState.mqtt && this.linkState.bootId === this.bootId;
  }

  start() {
    this.sendHello();
  }

  /** Simulated reboot: new bootId, seq and time sync lost, BOOT event again. */
  reboot() {
    this.bootId = randomBytes(4).toString("hex");
    this.seq = 0;
    this.timeOffset = null;
    this.startedAt = this.now();
    this.bootPending = true;
    this.seen = [];
    this.sendHello(); // the gateway still has the old bootId, so mqttUp is false until it answers
  }

  /** Every ~1 s: gateway timeout, heartbeat, periodic status. */
  tick() {
    const now = this.now();
    if (this.silent()) return;
    if (this.gateway.tick(now) === "down") this.log("[node] gateway lost (no frame for 15 s)");
    this.updateMqtt();
    if (this.mqttUp && now - this.lastStatusAt >= STATUS_INTERVAL_MS) this.sendStatus();
    if (this.tx.heartbeatDue(now)) this.send(Type.Heartbeat);
  }

  /** Every TELEMETRY_INTERVAL_MS: room step, events, telemetry. */
  step() {
    const { events, statusChanged } = this.room.step();
    if (this.silent()) return;
    for (const e of events) this.sendEvent(e.type, e.severity, e.message, e.data);
    if (statusChanged) this.sendStatus();
    this.sendTelemetry();
  }

  onFrame(f: Frame) {
    if (this.silent()) return;
    if (fromNode(f.type)) {
      this.log(`[node] ignored ${typeName(f.type)}: wrong direction`);
      return;
    }
    if (this.gateway.onFrame(f.seq, this.now()) === "up") this.log("[node] gateway up");
    switch (f.type) {
      case Type.Command:
        this.handleCommand(f.payload);
        break;
      case Type.Time: {
        const t = parseJson(TimeSync, f.payload);
        if (!t) return this.log("[node] bad TIME payload");
        const first = this.timeOffset === null;
        this.timeOffset = t.ts - this.now();
        if (first) this.log(`[node] time synced ${new Date(t.ts).toISOString()}`);
        break;
      }
      case Type.LinkState: {
        const s = parseJson(LinkState, f.payload);
        if (!s) return this.log("[node] bad LINK_STATE payload");
        this.linkState = s;
        // Our HELLO was lost, or the gateway restarted: register again (§5.2).
        if (s.bootId !== this.bootId) this.sendHello(true);
        break;
      }
      case Type.HelloRequest:
        this.log("[node] HELLO_REQUEST");
        this.sendHello();
        break;
    }
    this.updateMqtt();
  }

  // ---- Uplink ----------------------------------------------------------------------

  /** Logs changes of mqttUp; a status is owed every time the path comes back. */
  private updateMqtt() {
    const up = this.mqttUp;
    if (up !== this.lastMqttUp) {
      this.lastMqttUp = up;
      this.log(`[node] mqtt path ${up ? "up" : "down"}`);
      if (!up) this.statusPending = true;
    }
    this.flushPending();
  }

  private flushPending() {
    if (!this.mqttUp) return;
    if (this.statusPending) this.sendStatus();
    if (this.bootPending) {
      this.bootPending = false;
      this.sendEvent("BOOT", "info", "device booted", { fw: this.fw, resetReason: "POWERON" });
    }
  }

  /** `throttled`: at most one HELLO per second when answering a LINK_STATE. */
  private sendHello(throttled = false) {
    const now = this.now();
    if (throttled && now - this.lastHelloAt < HELLO_MIN_MS) return;
    this.lastHelloAt = now;
    this.statusPending = true;
    this.send(Type.Hello, buildHello({ deviceId: this.deviceId, bootId: this.bootId, fw: this.fw }));
  }

  private ts() {
    return this.timeOffset === null ? null : Math.round(this.now() + this.timeOffset);
  }

  private sendTelemetry() {
    if (!this.mqttUp) return;
    this.sendJson(Type.Telemetry, {
      v: 1,
      deviceId: this.deviceId,
      bootId: this.bootId,
      seq: this.seq++,
      ts: this.ts(),
      ...this.room.readings(),
      edgeState: this.room.edgeState,
      actuators: this.room.actuators(),
      override: this.room.override(),
    });
  }

  private sendStatus() {
    if (!this.mqttUp) {
      this.statusPending = true;
      return;
    }
    this.statusPending = false;
    this.lastStatusAt = this.now();
    this.sendJson(Type.Status, {
      v: 1,
      deviceId: this.deviceId,
      online: true,
      bootId: this.bootId,
      ts: this.ts(),
      fw: this.fw,
      uptimeSec: Math.floor((this.now() - this.startedAt) / 1000),
      rssi: this.linkState.rssi ?? 0,
      edgeState: this.room.edgeState,
      actuators: this.room.actuators(),
      override: this.room.overrideWithExpiry(),
      sensorFault: { dht: false },
    });
  }

  private sendEvent(type: string, severity: string, message: string, data: object) {
    if (!this.mqttUp) return; // like the firmware: events are not queued while offline
    this.sendJson(Type.Event, {
      v: 1,
      deviceId: this.deviceId,
      bootId: this.bootId,
      seq: this.seq++,
      ts: this.ts(),
      type,
      severity,
      message,
      data,
    });
  }

  // ---- Commands (§5.4 of the link doc: validate, dedup, execute, status, ack) --------

  private handleCommand(payload: Buffer) {
    let raw: unknown;
    try {
      raw = JSON.parse(payload.toString("utf8"));
    } catch {
      raw = null;
    }
    const commandId = (raw as { commandId?: unknown } | null)?.commandId;
    if (typeof commandId !== "string" || commandId.length === 0 || commandId.length > 64) {
      this.log("[node] COMMAND without a usable commandId → COMMAND_REJECTED");
      this.sendEvent("COMMAND_REJECTED", "warning", "command rejected", { raw: payload.toString("utf8").slice(0, 128) });
      return;
    }

    const known = this.seen.find((s) => s.id === commandId);
    if (known) {
      this.log(`[node] duplicate command ${commandId.slice(0, 8)}, re-acked`);
      this.sendJson(Type.Ack, known.ack);
      return;
    }

    const parsed = CommandMessage.safeParse(raw);
    const status = parsed.success ? "executed" : "rejected";
    if (parsed.success) {
      this.room.execute(parsed.data);
      this.sendStatus();
    }
    const cmd = parsed.success ? parsed.data : null;
    this.log(`[node] ${cmd ? `${cmd.action}${cmd.value ? ` ${cmd.value}` : ""}` : "invalid command"} -> ${status}`);

    const ack = {
      v: 1,
      deviceId: this.deviceId,
      commandId,
      status,
      reason: parsed.success ? null : "INVALID_PAYLOAD",
      ts: this.ts(),
      actuators: this.room.actuators(),
      override: this.room.overrideWithExpiry(),
    };
    this.seen.push({ id: commandId, ack });
    if (this.seen.length > DEDUP_SIZE) this.seen.shift();
    this.sendJson(Type.Ack, ack);
  }

  // ---- Link ------------------------------------------------------------------------

  private silent() {
    return this.now() < this.silentUntil;
  }

  private sendJson(type: Type, body: object) {
    this.send(type, Buffer.from(JSON.stringify(body)));
  }

  private send(type: Type, payload: Buffer = Buffer.alloc(0)) {
    if (this.silent()) return;
    this.link.send(type, this.tx.take(this.now()), payload);
  }
}
