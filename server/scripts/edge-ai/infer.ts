import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EdgeState } from "@srdt/contracts";

// TypeScript twin of device/lib/edge_ai: same int8 weights (model.json, exported by
// ml/train.py), same feature normalisation, same decode. Lets fake-device (and any backend
// policy later) make exactly the decisions the firmware makes.

interface Layer {
  in: number;
  out: number;
  scale: number;
  weights_int8: number[];
  bias: number[];
}

interface Norm {
  offset: number;
  scale: number;
}

export interface ModelJson {
  version: string;
  layers: Layer[];
  states: EdgeState[];
  features: { temperature: Norm; humidity: Norm; airQuality: Norm; lightLog: Norm };
  outputs: { state: [number, number]; windowAngle: [number, number]; angles: number[]; buzzer: number };
}

export interface Features {
  temperature: number | null;
  humidity: number | null;
  airQuality: number;
  light: number;
  presence: boolean;
}

export interface Inference {
  valid: boolean;
  state: EdgeState;
  windowAngle: number;
  buzzer: boolean;
  stateMargin: number;
}

const here = dirname(fileURLToPath(import.meta.url));

export function loadModel(path = join(here, "model.json")): ModelJson {
  return JSON.parse(readFileSync(path, "utf8")) as ModelJson;
}

function dense(x: number[], l: Layer, relu: boolean): number[] {
  const y = new Array<number>(l.out);
  for (let o = 0; o < l.out; o++) {
    let acc = 0;
    const base = o * l.in;
    for (let i = 0; i < l.in; i++) acc += (l.weights_int8[base + i] ?? 0) * (x[i] ?? 0);
    const v = acc * l.scale + (l.bias[o] ?? 0);
    y[o] = relu && v < 0 ? 0 : v;
  }
  return y;
}

function argmax(v: number[], from: number, to: number): { index: number; margin: number } {
  const at = (i: number) => v[i] ?? -Infinity;
  let best = from;
  for (let i = from + 1; i < to; i++) if (at(i) > at(best)) best = i;
  let second = -Infinity;
  for (let i = from; i < to; i++) if (i !== best && at(i) > second) second = at(i);
  return { index: best - from, margin: at(best) - second };
}

export function normalise(m: ModelJson, f: Features): number[] | null {
  if (f.temperature == null || f.humidity == null) return null;
  const n = m.features;
  return [
    (f.temperature - n.temperature.offset) / n.temperature.scale,
    (f.humidity - n.humidity.offset) / n.humidity.scale,
    (f.airQuality - n.airQuality.offset) / n.airQuality.scale,
    (Math.log10(1 + Math.max(0, f.light)) - n.lightLog.offset) / n.lightLog.scale,
    f.presence ? 1 : 0,
  ];
}

export function classify(m: ModelJson, f: Features): Inference {
  const x = normalise(m, f);
  if (!x) return { valid: false, state: "NORMAL", windowAngle: 0, buzzer: false, stateMargin: 0 };
  let a = x;
  m.layers.forEach((l, i) => {
    a = dense(a, l, i < m.layers.length - 1);
  });
  const st = argmax(a, m.outputs.state[0], m.outputs.state[1]);
  const an = argmax(a, m.outputs.windowAngle[0], m.outputs.windowAngle[1]);
  return {
    valid: true,
    state: m.states[st.index] ?? "NORMAL",
    windowAngle: m.outputs.angles[an.index] ?? 0,
    buzzer: (a[m.outputs.buzzer] ?? 0) > 0,
    stateMargin: st.margin,
  };
}

const ORDER: Record<EdgeState, number> = { NORMAL: 0, UNCOMFORTABLE: 1, WARNING: 2, DANGER: 3 };

/** Same debounce as edge_ai::Controller: escalations apply at once, relaxations after 2 samples. */
export class Controller {
  static readonly confirmSamples = 2;
  private current: Inference = { valid: false, state: "NORMAL", windowAngle: 0, buzzer: false, stateMargin: 0 };
  private pending: Inference = this.current;
  private pendingCount = 0;

  constructor(private readonly model: ModelJson) {}

  get decision(): Inference {
    return this.current;
  }

  step(f: Features): Inference {
    const now = classify(this.model, f);
    const same = (a: Inference, b: Inference) =>
      a.valid === b.valid && a.state === b.state && a.windowAngle === b.windowAngle && a.buzzer === b.buzzer;
    if (same(now, this.current)) {
      this.pendingCount = 0;
      this.current = { ...this.current, stateMargin: now.stateMargin };
      return this.current;
    }
    const escalation =
      now.valid &&
      (!this.current.valid ||
        ORDER[now.state] > ORDER[this.current.state] ||
        (now.buzzer && !this.current.buzzer) ||
        now.windowAngle > this.current.windowAngle);
    if (escalation) {
      this.current = now;
      this.pendingCount = 0;
      return this.current;
    }
    if (same(now, this.pending)) {
      if (++this.pendingCount >= Controller.confirmSamples) {
        this.current = now;
        this.pendingCount = 0;
      }
    } else {
      this.pending = now;
      this.pendingCount = 1;
    }
    return this.current;
  }
}
