import { randomBytes } from "node:crypto";
import mqtt from "mqtt";
import { CommandMessage, type EdgeState } from "@srdt/contracts";

// A stand-in for the ESP32 when Wokwi is not running: same topics and payloads as the
// firmware (device/lib/protocol), telemetry every 2 s, status on change + every 30 s,
// commands executed and acked. Values follow a slow random walk; the edge state uses the
// ENTER thresholds only (no hysteresis/hold, the real rules are in device/lib/edge_rules).
//
//   pnpm --filter @srdt/server fake-device            (env: MQTT_URL, MQTT_TOPIC_PREFIX, DEVICE_ID)
//   stdin: "hot" | "smoke" | "calm" to push the values toward a state

const url = process.env.MQTT_URL ?? "mqtt://127.0.0.1:1883";
const prefix = process.env.MQTT_TOPIC_PREFIX ?? "srdt";
const deviceId = process.env.DEVICE_ID ?? "room-01";
const bootId = randomBytes(4).toString("hex");
const topic = (kind: string) => `${prefix}/${deviceId}/${kind}`;
const OVERRIDE_SEC = 120;

let seq = 0;
const startedAt = Date.now();
const sensors = { temperature: 26.5, humidity: 62, light: 450, airQuality: 300, presence: true };
let target = { temperature: 26.5, airQuality: 300 };
let edgeState: EdgeState = "NORMAL";
let autoWindow = 0;
let windowOverride: { angle: number; until: number } | null = null;
let buzzerOverride: { on: boolean; until: number } | null = null;
const seen = new Map<string, string>(); // commandId → ack status (dedup like the firmware)

function evaluate(): EdgeState {
  const { temperature: t, humidity: h, airQuality: aq } = sensors;
  if (t >= 34 || aq >= 900) return "DANGER";
  if (t >= 31 || aq >= 700) return "WARNING";
  if (t >= 29 || h >= 75 || aq >= 500) return "UNCOMFORTABLE";
  return "NORMAL";
}

const now = () => Date.now();
const windowAngle = () => (windowOverride ? windowOverride.angle : autoWindow);
const buzzer = () => (buzzerOverride ? buzzerOverride.on : edgeState === "DANGER");
const expiresInSec = () => {
  const until = Math.max(windowOverride?.until ?? 0, buzzerOverride?.until ?? 0);
  return until ? Math.max(0, Math.ceil((until - now()) / 1000)) : 0;
};
const actuators = () => ({ windowAngle: windowAngle(), buzzer: buzzer() });
const override = () => ({ window: windowOverride !== null, buzzer: buzzerOverride !== null });

const client = mqtt.connect(url, {
  clientId: `dev-${deviceId}-fake`,
  protocolVersion: 4,
  keepalive: 15,
  will: {
    topic: topic("status"),
    payload: Buffer.from(JSON.stringify({ v: 1, deviceId, online: false })),
    qos: 1,
    retain: true,
  },
});

function publish(kind: string, body: object, retain = false) {
  client.publish(topic(kind), JSON.stringify(body), { qos: kind === "status" ? 1 : 0, retain });
}

function status() {
  publish(
    "status",
    {
      v: 1,
      deviceId,
      online: true,
      bootId,
      ts: now(),
      fw: "fake-0.1.0",
      uptimeSec: Math.floor((now() - startedAt) / 1000),
      rssi: -55,
      edgeState,
      actuators: actuators(),
      override: { ...override(), expiresInSec: expiresInSec() },
      sensorFault: { dht: false },
    },
    true,
  );
}

function event(type: string, severity: "info" | "warning" | "critical", message: string, data: object = {}) {
  publish("event", { v: 1, deviceId, bootId, seq: seq++, ts: now(), type, severity, message, data });
}

function telemetry() {
  publish("telemetry", {
    v: 1,
    deviceId,
    bootId,
    seq: seq++,
    ts: now(),
    ...sensors,
    temperature: Math.round(sensors.temperature * 10) / 10,
    humidity: Math.round(sensors.humidity * 10) / 10,
    light: Math.round(sensors.light * 10) / 10,
    airQuality: Math.round(sensors.airQuality),
    edgeState,
    actuators: actuators(),
    override: override(),
  });
}

function tick() {
  const drift = (v: number, to: number, noise: number) => v + (to - v) * 0.15 + (Math.random() - 0.5) * noise;
  sensors.temperature = drift(sensors.temperature, target.temperature, 0.2);
  sensors.airQuality = Math.max(0, Math.min(1000, drift(sensors.airQuality, target.airQuality, 10)));
  sensors.humidity = Math.max(0, Math.min(100, drift(sensors.humidity, 62, 0.5)));
  sensors.light = Math.max(0, drift(sensors.light, 450, 20));
  if (Math.random() < 0.05) sensors.presence = !sensors.presence;

  for (const [name, ov] of [["window", windowOverride], ["buzzer", buzzerOverride]] as const) {
    if (ov && now() >= ov.until) {
      if (name === "window") windowOverride = null;
      else buzzerOverride = null;
      event("OVERRIDE_CLEARED", "info", `${name} override cleared`, { actuator: name, reason: "expired" });
      status();
    }
  }

  const next = evaluate();
  if (next !== edgeState) {
    const from = edgeState;
    edgeState = next;
    autoWindow = next === "DANGER" ? 90 : 0;
    const severity = next === "DANGER" ? "critical" : next === "NORMAL" ? "info" : "warning";
    event("STATE_CHANGED", severity, `${from} -> ${next}`, { from, to: next, reasons: [] });
    status();
  }
  telemetry();
}

function execute(cmd: CommandMessage) {
  const until = now() + OVERRIDE_SEC * 1000;
  switch (cmd.action) {
    case "OPEN_WINDOW":
      windowOverride = { angle: cmd.value ?? 90, until };
      break;
    case "CLOSE_WINDOW":
      windowOverride = { angle: 0, until };
      break;
    case "BUZZER_ON":
    case "BUZZER_OFF":
      buzzerOverride = { on: cmd.action === "BUZZER_ON", until };
      break;
    case "CLEAR_OVERRIDE":
      windowOverride = null;
      buzzerOverride = null;
      break;
    case "PING":
      break;
  }
}

client.on("connect", () => {
  console.log(`[fake] connected to ${url} as ${deviceId} (bootId ${bootId}), prefix ${prefix}`);
  client.subscribe(topic("command"), { qos: 1 });
  status();
  event("BOOT", "info", "device booted", { fw: "fake-0.1.0", resetReason: "POWERON" });
});

client.on("message", (_t, payload) => {
  const parsed = CommandMessage.safeParse(JSON.parse(payload.toString()));
  if (!parsed.success) {
    console.log("[fake] invalid command", payload.toString());
    return;
  }
  const cmd = parsed.data;
  const duplicate = seen.has(cmd.commandId);
  if (!duplicate) {
    execute(cmd);
    seen.set(cmd.commandId, "executed");
    status();
  }
  console.log(`[fake] ${cmd.action}${cmd.value ? ` ${cmd.value}` : ""} -> executed${duplicate ? " (duplicate)" : ""}`);
  publish("command/ack", {
    v: 1,
    deviceId,
    commandId: cmd.commandId,
    status: "executed",
    reason: null,
    ts: now(),
    actuators: actuators(),
    override: { ...override(), expiresInSec: expiresInSec() },
  });
});

client.on("error", (err) => console.error("[fake] mqtt error", err.message));

setInterval(tick, 2000);
setInterval(status, 30_000);

process.stdin.setEncoding("utf8");
process.stdin.on("data", (line: string) => {
  const cmd = line.trim();
  if (cmd === "hot") target = { temperature: 35, airQuality: 400 };
  else if (cmd === "smoke") target = { temperature: 27, airQuality: 950 };
  else if (cmd === "calm") target = { temperature: 26.5, airQuality: 300 };
  else console.log("[fake] stdin commands: hot | smoke | calm");
});
console.log("[fake] type hot | smoke | calm + Enter to steer the values");
