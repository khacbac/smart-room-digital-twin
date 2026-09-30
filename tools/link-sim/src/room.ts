import type { CommandMessage, DeviceEventType, EdgeState, Severity } from "@srdt/contracts";

// The simulated room behind fake-node: same model as server/scripts/fake-device.ts
// (slow random walk, ENTER thresholds only, 120 s manual override), as a class so the
// node logic can be tested with a fake clock. The real rules are in device/lib/edge_rules.

export const OVERRIDE_SEC = 120;

export type Preset = "hot" | "smoke" | "calm";

export interface RoomEvent {
  type: DeviceEventType;
  severity: Severity;
  message: string;
  data: Record<string, unknown>;
}

const PRESETS: Record<Preset, { temperature: number; airQuality: number }> = {
  hot: { temperature: 35, airQuality: 400 },
  smoke: { temperature: 27, airQuality: 950 },
  calm: { temperature: 26.5, airQuality: 300 },
};

export class RoomSim {
  sensors = { temperature: 26.5, humidity: 62, light: 450, airQuality: 300, presence: true };
  edgeState: EdgeState = "NORMAL";
  private target = PRESETS.calm;
  private autoWindow = 0;
  private windowOverride: { angle: number; until: number } | null = null;
  private buzzerOverride: { on: boolean; until: number } | null = null;

  constructor(
    private now: () => number,
    private random: () => number = Math.random,
  ) {}

  steer(preset: Preset) {
    this.target = PRESETS[preset];
  }

  /** One 2 s step. `statusChanged` → the node publishes a status right away (§5.4). */
  step(): { events: RoomEvent[]; statusChanged: boolean } {
    const events: RoomEvent[] = [];
    let statusChanged = false;
    const drift = (v: number, to: number, noise: number) => v + (to - v) * 0.15 + (this.random() - 0.5) * noise;
    const s = this.sensors;
    s.temperature = drift(s.temperature, this.target.temperature, 0.2);
    s.airQuality = Math.max(0, Math.min(1000, drift(s.airQuality, this.target.airQuality, 10)));
    s.humidity = Math.max(0, Math.min(100, drift(s.humidity, 62, 0.5)));
    s.light = Math.max(0, drift(s.light, 450, 20));
    if (this.random() < 0.05) s.presence = !s.presence;

    const t = this.now();
    if (this.windowOverride && t >= this.windowOverride.until) {
      this.windowOverride = null;
      events.push(cleared("window"));
      statusChanged = true;
    }
    if (this.buzzerOverride && t >= this.buzzerOverride.until) {
      this.buzzerOverride = null;
      events.push(cleared("buzzer"));
      statusChanged = true;
    }

    const next = this.evaluate();
    if (next !== this.edgeState) {
      const from = this.edgeState;
      this.edgeState = next;
      this.autoWindow = next === "DANGER" ? 90 : 0;
      const severity = next === "DANGER" ? "critical" : next === "NORMAL" ? "info" : "warning";
      events.push({ type: "STATE_CHANGED", severity, message: `${from} -> ${next}`, data: { from, to: next, reasons: [] } });
      statusChanged = true;
    }
    return { events, statusChanged };
  }

  execute(cmd: CommandMessage) {
    const until = this.now() + OVERRIDE_SEC * 1000;
    switch (cmd.action) {
      case "OPEN_WINDOW":
        this.windowOverride = { angle: cmd.value ?? 90, until };
        break;
      case "CLOSE_WINDOW":
        this.windowOverride = { angle: 0, until };
        break;
      case "BUZZER_ON":
      case "BUZZER_OFF":
        this.buzzerOverride = { on: cmd.action === "BUZZER_ON", until };
        break;
      case "CLEAR_OVERRIDE":
        this.windowOverride = null;
        this.buzzerOverride = null;
        break;
      case "PING":
        break;
    }
  }

  actuators() {
    return {
      windowAngle: this.windowOverride ? this.windowOverride.angle : this.autoWindow,
      buzzer: this.buzzerOverride ? this.buzzerOverride.on : this.edgeState === "DANGER",
    };
  }

  override() {
    return { window: this.windowOverride !== null, buzzer: this.buzzerOverride !== null };
  }

  overrideWithExpiry() {
    const until = Math.max(this.windowOverride?.until ?? 0, this.buzzerOverride?.until ?? 0);
    const expiresInSec = until ? Math.max(0, Math.ceil((until - this.now()) / 1000)) : 0;
    return { ...this.override(), expiresInSec };
  }

  /** Rounded like the firmware (1 decimal, air quality as an integer). */
  readings() {
    const s = this.sensors;
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return {
      temperature: r1(s.temperature),
      humidity: r1(s.humidity),
      light: r1(s.light),
      airQuality: Math.round(s.airQuality),
      presence: s.presence,
    };
  }

  private evaluate(): EdgeState {
    const { temperature: t, humidity: h, airQuality: aq } = this.sensors;
    if (t >= 34 || aq >= 900) return "DANGER";
    if (t >= 31 || aq >= 700) return "WARNING";
    if (t >= 29 || h >= 75 || aq >= 500) return "UNCOMFORTABLE";
    return "NORMAL";
  }
}

const cleared = (actuator: string): RoomEvent => ({
  type: "OVERRIDE_CLEARED",
  severity: "info",
  message: `${actuator} override cleared`,
  data: { actuator, reason: "expired" },
});
