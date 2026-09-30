import { randomUUID } from "node:crypto";
import type { CommandAction } from "@srdt/contracts";
import { type Frame, LINK_PAYLOAD_MAX, Type, fromNode, typeName } from "./frame";
import { Hello, buildLinkState, buildTime, parseJson } from "./messages";
import { PeerMonitor, TxTracker } from "./peer";
import type { FrameSink } from "./transport";

// What the gateway firmware does (docs/link-protocol.md §5): bridge node frames to the
// srdt MQTT topics byte for byte, forward commands, keep the node's presence. The MQTT
// client is injected (`Broker`) so the bridge runs against a real broker, a logging
// stand-in, or a test double. Drive it with tick() every second.

export const TIME_RESYNC_MS = 10 * 60_000;
const HELLO_REQUEST_MIN_MS = 1000;

export interface Broker {
  publish(topic: string, payload: Buffer, opts: { qos: 0 | 1; retain: boolean }): void;
}

export interface GatewayOptions {
  nodeId: string; // configured, like DEVICE_ID in the firmware: the LWT needs it before any HELLO
  prefix: string;
  link: FrameSink;
  broker: Broker;
  now?: () => number;
  log?: (msg: string) => void;
  rssi?: number;
  /** Also log TELEMETRY / HEARTBEAT / LINK_STATE. */
  verbose?: boolean;
}

const UPLINK: Partial<Record<Type, { kind: string; qos: 0 | 1; retain: boolean }>> = {
  [Type.Telemetry]: { kind: "telemetry", qos: 0, retain: false },
  [Type.Status]: { kind: "status", qos: 1, retain: true },
  [Type.Event]: { kind: "event", qos: 0, retain: false },
  [Type.Ack]: { kind: "command/ack", qos: 0, retain: false },
};

export class GatewayBridge {
  readonly node = new PeerMonitor();
  /** HELLO received since the gateway started (§5.2). */
  registered: Hello | null = null;
  readonly counters = { uplink: 0, published: 0, dropped: 0, commands: 0 };
  /** Pretend the broker is gone (the "mqtt down" stdin command). */
  forcedDown = false;

  private tx = new TxTracker();
  private brokerUp = false;
  private lastSentMqtt: boolean | null = null;
  private lastHelloRequest = -Infinity;
  private lastTimeAt = -Infinity;
  private injected = new Set<string>(); // commandIds typed on stdin: their acks stay off MQTT

  constructor(private opts: GatewayOptions) {}

  get mqttUp() {
    return this.brokerUp && !this.forcedDown;
  }

  topic(kind: string) {
    return `${this.opts.prefix}/${this.opts.nodeId}/${kind}`;
  }

  /** The Last Will payload; also published when the node goes quiet (§5.3). */
  offlinePayload() {
    return Buffer.from(JSON.stringify({ v: 1, deviceId: this.opts.nodeId, online: false }));
  }

  start() {
    this.requestHello(true);
    this.sendLinkState();
  }

  // ---- Broker side -------------------------------------------------------------------

  onBrokerUp() {
    this.brokerUp = true;
    this.brokerChanged();
  }

  onBrokerDown() {
    if (!this.brokerUp) return;
    this.brokerUp = false;
    this.brokerChanged();
  }

  setForcedDown(down: boolean) {
    this.forcedDown = down;
    this.brokerChanged();
  }

  /** A message on `{prefix}/{nodeId}/command`, forwarded untouched (§5.4). */
  onCommand(payload: Buffer) {
    if (!this.mqttUp) return; // "mqtt down" also covers the downlink
    if (!this.registered || !this.node.up) {
      this.drop("COMMAND: node is not up");
      return;
    }
    if (payload.length > LINK_PAYLOAD_MAX) {
      this.drop(`COMMAND: ${payload.length} B > ${LINK_PAYLOAD_MAX}`);
      return;
    }
    this.counters.commands++;
    this.opts.log?.(`[gw] → COMMAND ${summarizeCommand(payload)}`);
    this.send(Type.Command, payload);
  }

  /** A command typed on stdin: sent to the node directly, its ack is not published. */
  inject(action: CommandAction, value?: number) {
    const commandId = randomUUID();
    this.injected.add(commandId);
    const body = { v: 1, commandId, action, ...(value === undefined ? {} : { value }), source: "api", ts: this.now() };
    const payload = Buffer.from(JSON.stringify(body));
    this.opts.log?.(`[gw] → COMMAND ${summarizeCommand(payload)} (from stdin)`);
    this.send(Type.Command, payload);
  }

  // ---- Link side ---------------------------------------------------------------------

  onFrame(f: Frame) {
    const now = this.now();
    if (!fromNode(f.type)) {
      this.drop(`${typeName(f.type)}: wrong direction`);
      return;
    }
    // A HELLO starts a new seq run (the node may have rebooted), so no false gap.
    if (f.type === Type.Hello) this.node.resetSeq();
    if (this.node.onFrame(f.seq, now) === "up") this.opts.log?.("[gw] node up");

    if (f.type === Type.Hello) {
      this.onHello(f.payload);
      return;
    }
    if (!this.registered) {
      this.drop(`${typeName(f.type)} before HELLO`);
      this.requestHello();
      return;
    }
    if (f.type === Type.Heartbeat) {
      if (this.opts.verbose) this.opts.log?.("[gw] ← HEARTBEAT");
      return;
    }

    const route = UPLINK[f.type];
    if (!route) return;
    this.counters.uplink++;
    if (f.type === Type.Ack && this.isInjectedAck(f.payload)) {
      this.opts.log?.(`[gw] ← ACK ${summarizeAck(f.payload)} (stdin command, not published)`);
      return;
    }
    if (this.opts.verbose || f.type !== Type.Telemetry) {
      this.opts.log?.(`[gw] ← ${typeName(f.type)} ${summarizeUplink(f.type, f.payload)}`);
    }
    if (!this.mqttUp) {
      this.counters.dropped++; // no buffering, like net_task (§5.1)
      return;
    }
    this.opts.broker.publish(this.topic(route.kind), f.payload, { qos: route.qos, retain: route.retain });
    this.counters.published++;
  }

  /** Every ~1 s. */
  tick() {
    const now = this.now();
    if (this.node.tick(now) === "down") {
      this.opts.log?.("[gw] node lost (no frame for 15 s) → offline status");
      this.publishOffline();
    }
    if (this.registered && now - this.lastTimeAt >= TIME_RESYNC_MS) this.sendTime();
    if (this.tx.heartbeatDue(now)) this.sendLinkState(); // LINK_STATE is the gateway heartbeat
  }

  // ---- Internals ---------------------------------------------------------------------

  private onHello(payload: Buffer) {
    const hello = parseJson(Hello, payload);
    if (!hello) {
      this.drop("HELLO: invalid payload");
      return;
    }
    if (hello.deviceId !== this.opts.nodeId) {
      this.drop(`HELLO from "${hello.deviceId}", this gateway is configured for "${this.opts.nodeId}"`);
      return;
    }
    const rebooted = this.registered !== null && this.registered.bootId !== hello.bootId;
    this.registered = hello;
    this.opts.log?.(`[gw] ← HELLO ${hello.deviceId} boot ${hello.bootId} fw ${hello.fw}${rebooted ? " (node rebooted)" : ""}`);
    // TIME first, so the status / BOOT the node sends on LINK_STATE already has a ts.
    this.sendTime();
    this.sendLinkState();
  }

  private brokerChanged() {
    this.opts.log?.(`[gw] mqtt ${this.mqttUp ? "up" : "down"}`);
    // Our LWT may have replaced the node's retained status while we were away.
    if (this.mqttUp && !this.node.up) this.publishOffline();
    this.sendLinkState();
  }

  private publishOffline() {
    if (!this.mqttUp) return;
    this.opts.broker.publish(this.topic("status"), this.offlinePayload(), { qos: 1, retain: true });
  }

  private sendLinkState() {
    const mqtt = this.mqttUp;
    if (this.opts.verbose || this.lastSentMqtt !== mqtt) this.opts.log?.(`[gw] → LINK_STATE mqtt=${mqtt}`);
    this.lastSentMqtt = mqtt;
    this.send(Type.LinkState, buildLinkState({ mqtt, rssi: this.opts.rssi ?? -55, bootId: this.registered?.bootId }));
  }

  private sendTime() {
    this.lastTimeAt = this.now();
    this.send(Type.Time, buildTime(Date.now()));
  }

  private requestHello(force = false) {
    const now = this.now();
    if (!force && now - this.lastHelloRequest < HELLO_REQUEST_MIN_MS) return;
    this.lastHelloRequest = now;
    this.send(Type.HelloRequest);
  }

  private isInjectedAck(payload: Buffer) {
    try {
      const id = JSON.parse(payload.toString("utf8")).commandId;
      return typeof id === "string" && this.injected.delete(id);
    } catch {
      return false;
    }
  }

  private drop(why: string) {
    this.counters.dropped++;
    this.opts.log?.(`[gw] dropped ${why}`);
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  private send(type: Type, payload: Buffer = Buffer.alloc(0)) {
    this.opts.link.send(type, this.tx.take(this.now()), payload);
  }
}

// ---- Log helpers ---------------------------------------------------------------------

function json(payload: Buffer): Record<string, unknown> | null {
  try {
    return JSON.parse(payload.toString("utf8"));
  } catch {
    return null;
  }
}

function summarizeCommand(payload: Buffer) {
  const c = json(payload);
  return c ? `${c.action}${c.value === undefined ? "" : ` ${c.value}`} ${String(c.commandId).slice(0, 8)}` : "(not JSON)";
}

function summarizeAck(payload: Buffer) {
  const a = json(payload);
  return a ? `${String(a.commandId).slice(0, 8)} ${a.status}${a.reason ? ` ${a.reason}` : ""}` : "(not JSON)";
}

function summarizeUplink(type: Type, payload: Buffer) {
  const b = json(payload);
  if (!b) return "(not JSON)";
  switch (type) {
    case Type.Telemetry:
      return `${b.temperature}°C ${b.humidity}% aq ${b.airQuality} ${b.edgeState}`;
    case Type.Status: {
      const a = b.actuators as { windowAngle?: number; buzzer?: boolean } | undefined;
      return `${b.edgeState} window ${a?.windowAngle}° buzzer ${a?.buzzer ? "on" : "off"}`;
    }
    case Type.Event:
      return `${b.type}: ${b.message}`;
    case Type.Ack:
      return summarizeAck(payload);
    default:
      return `${payload.length} B`;
  }
}
