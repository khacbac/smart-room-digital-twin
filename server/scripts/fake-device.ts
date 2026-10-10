import { randomBytes } from "node:crypto";
import mqtt from "mqtt";
import { CommandMessage, type EdgeState } from "@srdt/contracts";
import { Controller, loadModel } from "./edge-ai/infer";

// A stand-in for the ESP32 when Wokwi is not running: same topics and payloads as the
// firmware (device/lib/protocol), telemetry every 2 s, status on change + every 30 s,
// commands executed and acked. Values follow a slow random walk; the edge state uses the
// ENTER thresholds only (no hysteresis/hold, the real rules are in device/lib/edge_rules).
// The TinyML controller (server/scripts/edge-ai, same int8 weights as device/lib/edge_ai)
// drives window/buzzer like the firmware does; the rule state stays the safety floor.
//
//   pnpm --filter @srdt/server fake-device            (env: MQTT_URL, MQTT_TOPIC_PREFIX, DEVICE_ID, AI_CONTROL=0)
//   FAKE_ROAM=1 pnpm --filter @srdt/server fake-device   start roaming right away
//   stdin: hot | smoke | calm | humid | stuffy | cold | night | day | people | empty
//          | roam [off] | set <°C> <aq> [rh] | ai [on|off]

const url = process.env.MQTT_URL ?? "mqtt://127.0.0.1:1883";
const prefix = process.env.MQTT_TOPIC_PREFIX ?? "srdt";
const deviceId = process.env.DEVICE_ID ?? "room-01";
const bootId = randomBytes(4).toString("hex");
const topic = (kind: string) => `${prefix}/${deviceId}/${kind}`;
const OVERRIDE_SEC = 120;

let seq = 0;
const startedAt = Date.now();
const sensors = { temperature: 26.5, humidity: 62, light: 450, airQuality: 300, presence: true };
type Target = { temperature: number; humidity: number; light: number; airQuality: number };
// The first three match the original presets; the rest exercise the model's extra context
// (humidity, early ventilation, cold, night) that the rule engine ignores. Partial presets
// only move the named values.
const PRESETS: Record<string, Partial<Target>> = {
  hot: { temperature: 35, humidity: 62, light: 450, airQuality: 400 },
  smoke: { temperature: 27, humidity: 62, light: 450, airQuality: 950 },
  calm: { temperature: 26.5, humidity: 62, light: 450, airQuality: 300 },
  humid: { temperature: 28.5, humidity: 80 },
  stuffy: { airQuality: 680 }, // people: WARNING 90°, empty: UNCOMFORTABLE 60°
  cold: { temperature: 15, humidity: 50 },
  night: { light: 3 },
  day: { light: 450 },
};
let target: Target = { temperature: 26.5, humidity: 62, light: 450, airQuality: 300 };
let presenceFlips = true; // random 5 % presence flips (off after `people` / `empty`)
let edgeState: EdgeState = "NORMAL";
let autoWindow = 0;
let windowOverride: { angle: number; until: number } | null = null;
let buzzerOverride: { on: boolean; until: number } | null = null;
const seen = new Map<string, string>(); // commandId → ack status (dedup like the firmware)

const model = loadModel();
const ai = new Controller(model);
let aiControl = process.env.AI_CONTROL !== "0";

function evaluate(): EdgeState {
  const { temperature: t, humidity: h, airQuality: aq } = sensors;
  if (t >= 34 || aq >= 900) return "DANGER";
  if (t >= 31 || aq >= 700) return "WARNING";
  if (t >= 29 || h >= 75 || aq >= 500) return "UNCOMFORTABLE";
  return "NORMAL";
}

// Roaming: a fresh random target every ROAM_INTERVAL_SEC, spanning every edge threshold
// (29/31/34 °C, 500/700/900 aq, 75 %RH). Left alone the values converge on one point and
// the state never changes, so an unattended run would be a flat NORMAL line.
const ROAM_INTERVAL_SEC = Number(process.env.FAKE_ROAM_INTERVAL_SEC ?? 45);
let roaming = process.env.FAKE_ROAM === "1";
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

function roam() {
  target = {
    temperature: between(25, 36),
    humidity: between(45, 85),
    light: between(5, 900),
    airQuality: between(280, 980),
  };
  const t = target;
  console.log(
    `[fake] roam -> ${t.temperature.toFixed(1)}°C ${t.humidity.toFixed(0)}% ` +
      `light ${t.light.toFixed(0)} aq ${t.airQuality.toFixed(0)}`,
  );
}

const now = () => Date.now();
// Automatic actuators: the model while `ai on` (DANGER still forces 90 / buzzer), else the rules.
const aiActive = () => aiControl && ai.decision.valid;
const windowAngle = () => {
  if (windowOverride) return windowOverride.angle;
  if (edgeState === "DANGER") return 90;
  return aiActive() ? ai.decision.windowAngle : autoWindow;
};
const buzzer = () => {
  if (buzzerOverride) return buzzerOverride.on;
  if (edgeState === "DANGER") return true;
  return aiActive() && ai.decision.buzzer;
};
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
    mlState: ai.decision.valid ? ai.decision.state : null,
    aiControl,
  });
}

function tick() {
  const drift = (v: number, to: number, noise: number) => v + (to - v) * 0.15 + (Math.random() - 0.5) * noise;
  sensors.temperature = drift(sensors.temperature, target.temperature, 0.2);
  sensors.airQuality = Math.max(0, Math.min(1000, drift(sensors.airQuality, target.airQuality, 10)));
  sensors.humidity = Math.max(0, Math.min(100, drift(sensors.humidity, target.humidity, 0.5)));
  sensors.light = Math.max(0, drift(sensors.light, target.light, target.light < 50 ? 2 : 20));
  if (presenceFlips && Math.random() < 0.05) sensors.presence = !sensors.presence;

  // TinyML step on the rounded values the telemetry carries (same inputs as the firmware's smoothed ones)
  const beforeAi = { ...ai.decision };
  const decision = ai.step({
    temperature: Math.round(sensors.temperature * 10) / 10,
    humidity: Math.round(sensors.humidity * 10) / 10,
    airQuality: Math.round(sensors.airQuality),
    light: Math.round(sensors.light * 10) / 10,
    presence: sensors.presence,
  });
  const aiChanged =
    decision.valid !== beforeAi.valid ||
    decision.state !== beforeAi.state ||
    decision.windowAngle !== beforeAi.windowAngle ||
    decision.buzzer !== beforeAi.buzzer;
  if (aiChanged) {
    console.log(
      `[fake] ml -> ${decision.state} window ${decision.windowAngle}° buzzer ${decision.buzzer ? "on" : "off"}` +
        ` (margin ${decision.stateMargin.toFixed(1)})${aiControl ? "" : " [advisory]"}`,
    );
    if (aiControl) status();
  }

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
    case "IDENTIFY":
      console.log(`[fake] *** IDENTIFY: ${deviceId} blinks its LEDs and beeps ***`);
      break;
    case "SHOW_MESSAGE":
      console.log(`[fake] *** display: "${cmd.text}" ***`);
      break;
  }
}

client.on("connect", () => {
  console.log(`[fake] connected to ${url} as ${deviceId} (bootId ${bootId}), prefix ${prefix}`);
  console.log(`[fake] TinyML model ${model.version}, control ${aiControl ? "on" : "off"} (stdin: ai on|off)`);
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
setInterval(() => roaming && roam(), ROAM_INTERVAL_SEC * 1000);
if (roaming) roam();

const HELP =
  "[fake] stdin: hot | smoke | calm | humid | stuffy | cold | night | day | people | empty" +
  " | roam [off] | set <°C> <aq> [rh] | ai [on|off]";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (text: string) => {
  for (const raw of text.split(/\r?\n/)) {
    const [cmd, ...args] = raw.trim().split(/\s+/);
    if (!cmd) continue;
    const preset = PRESETS[cmd];
    if (preset) {
      roaming = false;
      target = { ...target, ...preset };
      console.log(`[fake] steering toward ${cmd}`);
    } else if (cmd === "people" || cmd === "empty") {
      sensors.presence = cmd === "people";
      presenceFlips = false;
      console.log(`[fake] presence ${sensors.presence} (random flips off)`);
    } else if (cmd === "roam") {
      roaming = args[0] !== "off";
      if (roaming) roam();
      else console.log(`[fake] roam off, holding ${target.temperature.toFixed(1)}°C`);
    } else if (cmd === "set") {
      // `Number(undefined)` is NaN, so a missing argument fails the guard below.
      const t = Number(args[0]);
      const aq = Number(args[1]);
      const rh = Number(args[2]);
      if (!Number.isFinite(t) || !Number.isFinite(aq)) {
        console.log(HELP);
        continue;
      }
      roaming = false;
      target = { ...target, temperature: t, airQuality: aq, humidity: Number.isFinite(rh) ? rh : target.humidity };
      console.log(`[fake] target ${t}°C aq ${aq} rh ${target.humidity.toFixed(0)}`);
    } else if (cmd === "ai") {
      if (args[0] === "on" || args[0] === "off") {
        aiControl = args[0] === "on";
        status();
      }
      const d = ai.decision;
      console.log(
        `[fake] ai control ${aiControl ? "on" : "off"}; model ${model.version} -> ` +
          (d.valid ? `${d.state} window ${d.windowAngle}° buzzer ${d.buzzer ? "on" : "off"}` : "no input"),
      );
    } else console.log(HELP);
  }
});
console.log(HELP);
