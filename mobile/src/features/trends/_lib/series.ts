import type { TelemetryRecord } from "@srdt/contracts";
import { AQ_LINES, HUMIDITY_LINES, TEMP_LINES, type ThresholdLine } from "@srdt/twin-core";
import type { ColorName } from "@/lib/theme/colors";
import type { Series } from "@/features/settings/_atoms/settings";

export interface SeriesDef {
  key: Series;
  title: string;
  short: string;
  unit: string;
  digits: number;
  color: ColorName;
  lines: readonly ThresholdLine[];
  /** null → fit the data. */
  domain: [number, number] | null;
}

export const SERIES: Record<Series, SeriesDef> = {
  temperature: { key: "temperature", title: "Temperature", short: "Temp", unit: "°C", digits: 1, color: "series-temp", lines: TEMP_LINES, domain: null },
  humidity: { key: "humidity", title: "Humidity", short: "Humidity", unit: "%", digits: 0, color: "series-hum", lines: HUMIDITY_LINES, domain: [0, 100] },
  airQuality: { key: "airQuality", title: "Air quality", short: "Air", unit: "AQ", digits: 0, color: "series-aq", lines: AQ_LINES, domain: [0, 1000] },
};

export interface Point {
  t: number;
  v: number | null;
}

/** Two samples further apart than this are not joined (the dashboard's GAP_MS). */
export const GAP_MS = 20_000;

/** Points by receive time; a null point is inserted at each gap so the line breaks. */
export function toPoints(telemetry: readonly TelemetryRecord[], key: Series): Point[] {
  const out: Point[] = [];
  for (const r of telemetry) {
    const t = Date.parse(r.receivedAt); // receive time: the simulator's clock can lag
    const prev = out[out.length - 1];
    if (prev && t - prev.t > GAP_MS) out.push({ t: prev.t + 1, v: null });
    out.push({ t, v: r[key] });
  }
  return out;
}

/** At most ~`max` points, keeping gaps (null points always survive). */
export function downsample(points: Point[], max: number): Point[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: Point[] = [];
  let next = 0;
  points.forEach((p, i) => {
    if (p.v === null || i >= next || i === points.length - 1) {
      out.push(p);
      if (i >= next) next += step;
    }
  });
  return out;
}

export function summary(points: Point[]) {
  const vals = points.map((p) => p.v).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return {
    now: vals[vals.length - 1]!,
    min: Math.min(...vals),
    max: Math.max(...vals),
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
  };
}

/** Index of the point nearest to time t (points sorted by t). */
export function nearest(points: Point[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(points[lo - 1]!.t - t) < Math.abs(points[lo]!.t - t)) lo -= 1;
  return lo;
}
