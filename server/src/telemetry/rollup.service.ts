import type { MetricStat, TelemetryRecord, TelemetryRollup } from "@srdt/contracts";
import type { Logger } from "../logger";
import type { RollupStore } from "../storage/types";

// Hourly counters over every telemetry message, so questions about the last weeks never
// read the raw samples (a month is ~500k of them, ~720 rollups).

/** `2026-10-11T08:12:30.000Z` → `2026-10-11T08` (UTC hour). */
export const hourOf = (iso: string) => iso.slice(0, 13);

export function emptyRollup(deviceCode: string, hour: string): TelemetryRollup {
  return {
    hour,
    deviceCode,
    samples: 0,
    temperature: null,
    humidity: null,
    light: null,
    airQuality: null,
    states: { NORMAL: 0, UNCOMFORTABLE: 0, WARNING: 0, DANGER: 0 },
    presence: 0,
    windowOpen: 0,
    buzzer: 0,
    override: 0,
    updatedAt: "",
  };
}

function addValue(stat: MetricStat | null, v: number | null): MetricStat | null {
  if (v === null || !Number.isFinite(v)) return stat;
  if (!stat) return { min: v, max: v, sum: v, count: 1 };
  return { min: Math.min(stat.min, v), max: Math.max(stat.max, v), sum: stat.sum + v, count: stat.count + 1 };
}

/** Folds one sample into `r` (mutates it). */
export function addSample(r: TelemetryRollup, t: TelemetryRecord): void {
  r.samples++;
  r.temperature = addValue(r.temperature, t.temperature);
  r.humidity = addValue(r.humidity, t.humidity);
  r.light = addValue(r.light, t.light);
  r.airQuality = addValue(r.airQuality, t.airQuality);
  r.states[t.edgeState]++;
  if (t.presence) r.presence++;
  if (t.windowAngle > 0) r.windowOpen++;
  if (t.buzzer) r.buzzer++;
  if (t.overrideActive) r.override++;
}

interface OpenHour {
  rollup: TelemetryRollup;
  savedAtMs: number;
  dirty: boolean;
}

export class RollupService {
  /**
   * The hour each device is filling now; written every `flushEveryMs` and when the hour
   * ends. Reads merge it in, so the interval only bounds what a crash loses; 10 min keeps
   * it at ~170 Firestore writes a day per device (docs/cloud.md §2).
   */
  private readonly open = new Map<string, OpenHour>();
  /** Per-device chain, so a store read at an hour change never races the next sample. */
  private readonly queue = new Map<string, Promise<void>>();

  constructor(
    private readonly store: RollupStore,
    private readonly log: Logger,
    private readonly flushEveryMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  add(record: TelemetryRecord): void {
    const code = record.deviceCode;
    const next = (this.queue.get(code) ?? Promise.resolve())
      .then(() => this.apply(record))
      .catch((err) => this.log.error({ err, device: code }, "telemetry rollup not stored"));
    this.queue.set(code, next);
  }

  /** Stored hours from `sinceHour` on, with the hour still being filled merged in. */
  async since(deviceCode: string, sinceHour: string): Promise<TelemetryRollup[]> {
    await this.queue.get(deviceCode);
    const stored = await this.store.since(deviceCode, sinceHour);
    const live = this.open.get(deviceCode)?.rollup;
    if (!live || live.hour < sinceHour) return stored;
    return [...stored.filter((r) => r.hour !== live.hour), structuredClone(live)].sort((a, b) =>
      a.hour.localeCompare(b.hour),
    );
  }

  /** Writes every unsaved hour (shutdown). */
  async flushAll(): Promise<void> {
    await Promise.allSettled([...this.queue.values()]);
    await Promise.allSettled([...this.open.values()].filter((o) => o.dirty).map((o) => this.save(o)));
  }

  private async apply(record: TelemetryRecord): Promise<void> {
    const code = record.deviceCode;
    const hour = hourOf(record.measuredAt);
    let current = this.open.get(code);

    if (current && hour < current.rollup.hour) {
      // a late sample (buffered across a reconnect): fold it into its stored hour
      const past = (await this.store.get(code, hour)) ?? emptyRollup(code, hour);
      addSample(past, record);
      past.updatedAt = new Date(this.now()).toISOString();
      await this.store.put(past);
      return;
    }
    if (!current || hour > current.rollup.hour) {
      if (current?.dirty) await this.save(current);
      // after a restart the hour may already be partly stored: continue it
      const rollup = (await this.store.get(code, hour)) ?? emptyRollup(code, hour);
      current = { rollup, savedAtMs: this.now(), dirty: false };
      this.open.set(code, current);
    }

    addSample(current.rollup, record);
    current.dirty = true;
    if (this.now() - current.savedAtMs >= this.flushEveryMs) await this.save(current);
  }

  private async save(o: OpenHour): Promise<void> {
    o.rollup.updatedAt = new Date(this.now()).toISOString();
    o.savedAtMs = this.now();
    o.dirty = false;
    await this.store.put(structuredClone(o.rollup));
  }
}
