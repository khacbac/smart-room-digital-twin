import type { CommandRecord, EdgeState, EventRecord, MetricStat, TelemetryRollup } from "@srdt/contracts";

// What the assistant knows about the past: hourly rollups, events and commands of up to
// HISTORY_MAX_DAYS, condensed into a few dozen rows so it fits a prompt.

export const HISTORY_MAX_DAYS = 30;
/** Events listed one by one; the rest are only counted. */
const EVENTS_LISTED = 40;

export interface PastData {
  rollups: TelemetryRollup[];
  events: EventRecord[];
  commands: CommandRecord[];
}

export interface Range {
  min: number;
  avg: number;
  max: number;
}

export interface HistoryRow {
  /** Local day `2026-10-03 Sat`, or local hour `10-03 14h` for windows of 2 days or less. */
  label: string;
  /** Hours with readings in this row. */
  hours: number;
  samples: number;
  temperature: Range | null;
  humidity: Range | null;
  light: Range | null;
  airQuality: Range | null;
  /** Share of samples per state, 0..1. */
  states: Record<EdgeState, number>;
  windowOpen: number;
  presence: number;
  buzzer: number;
}

export interface HistoryEvent {
  /** Local time `10-03 14:05`. */
  at: string;
  type: string;
  severity: string;
  message: string;
}

export interface OfflinePeriod {
  /** Local times; `to` is null while still offline. */
  from: string;
  to: string | null;
  minutes: number;
}

export interface RoomHistory {
  days: number;
  timeZone: string;
  /** Local `2026-09-11 15:00` → `2026-10-11 15:04`. */
  from: string;
  to: string;
  hoursInWindow: number;
  hoursWithData: number;
  overall: HistoryRow | null;
  rows: HistoryRow[];
  events: HistoryEvent[];
  /** DEVICE_OFFLINE → next DEVICE_ONLINE, oldest first. */
  offline: OfflinePeriod[];
  /** Every event in the window by type, including the ones not listed. */
  eventCounts: Record<string, number>;
  commands: { total: number; bySource: Record<string, number>; failed: number };
}

const STATES: EdgeState[] = ["NORMAL", "UNCOMFORTABLE", "WARNING", "DANGER"];
/** Events worth listing even when their severity is info. */
const NOTABLE = new Set(["SENSOR_FAULT", "SENSOR_RECOVERED", "DEVICE_OFFLINE", "DEVICE_ONLINE", "COMMAND_TIMEOUT", "COMMAND_REJECTED", "BOOT"]);

function localParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), wd: get("weekday") };
}

/** `Sat 2026-10-11 15:04`, in `timeZone`. */
export function localTime(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  return `${p.wd} ${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}`;
}

function merge(a: MetricStat | null, b: MetricStat | null): MetricStat | null {
  if (!a) return b;
  if (!b) return a;
  return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max), sum: a.sum + b.sum, count: a.count + b.count };
}

const range = (s: MetricStat | null): Range | null => (s && s.count > 0 ? { min: s.min, avg: s.sum / s.count, max: s.max } : null);

function row(label: string, list: TelemetryRollup[]): HistoryRow {
  let temperature: MetricStat | null = null;
  let humidity: MetricStat | null = null;
  let light: MetricStat | null = null;
  let airQuality: MetricStat | null = null;
  const states: Record<EdgeState, number> = { NORMAL: 0, UNCOMFORTABLE: 0, WARNING: 0, DANGER: 0 };
  let samples = 0;
  let windowOpen = 0;
  let presence = 0;
  let buzzer = 0;
  for (const r of list) {
    samples += r.samples;
    temperature = merge(temperature, r.temperature);
    humidity = merge(humidity, r.humidity);
    light = merge(light, r.light);
    airQuality = merge(airQuality, r.airQuality);
    for (const s of STATES) states[s] += r.states[s];
    windowOpen += r.windowOpen;
    presence += r.presence;
    buzzer += r.buzzer;
  }
  const share = (n: number) => (samples > 0 ? n / samples : 0);
  return {
    label,
    hours: list.length,
    samples,
    temperature: range(temperature),
    humidity: range(humidity),
    light: range(light),
    airQuality: range(airQuality),
    states: { NORMAL: share(states.NORMAL), UNCOMFORTABLE: share(states.UNCOMFORTABLE), WARNING: share(states.WARNING), DANGER: share(states.DANGER) },
    windowOpen: share(windowOpen),
    presence: share(presence),
    buzzer: share(buzzer),
  };
}

const hourMs = (hour: string) => Date.parse(`${hour}:00:00.000Z`);

const shortTime = (ms: number, timeZone: string) => {
  const p = localParts(ms, timeZone);
  return `${p.mo}-${p.d} ${p.h}:${p.mi}`;
};

/** Pairs each DEVICE_OFFLINE with the DEVICE_ONLINE after it. */
function offlinePeriods(events: EventRecord[], nowMs: number, timeZone: string): OfflinePeriod[] {
  const out: OfflinePeriod[] = [];
  let since: number | null = null;
  for (const e of [...events].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))) {
    const at = Date.parse(e.measuredAt);
    if (e.type === "DEVICE_OFFLINE" && since === null) since = at;
    if (e.type === "DEVICE_ONLINE" && since !== null) {
      out.push({ from: shortTime(since, timeZone), to: shortTime(at, timeZone), minutes: Math.round((at - since) / 60_000) });
      since = null;
    }
  }
  if (since !== null) out.push({ from: shortTime(since, timeZone), to: null, minutes: Math.round((nowMs - since) / 60_000) });
  return out;
}

export function buildHistory(data: PastData, days: number, nowMs: number, timeZone: string): RoomHistory {
  const fromMs = nowMs - days * 24 * 3_600_000;
  const rollups = data.rollups.filter((r) => r.samples > 0);
  const hourly = days <= 2;

  // group by local hour (short windows) or local day, in time order
  const groups = new Map<string, TelemetryRollup[]>();
  for (const r of rollups) {
    const p = localParts(hourMs(r.hour), timeZone);
    const label = hourly ? `${p.mo}-${p.d} ${p.h}h` : `${p.y}-${p.mo}-${p.d} ${p.wd}`;
    groups.set(label, [...(groups.get(label) ?? []), r]);
  }

  const eventCounts: Record<string, number> = {};
  for (const e of data.events) eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;
  const events = data.events
    .filter((e) => e.severity !== "info" || NOTABLE.has(e.type))
    .slice(0, EVENTS_LISTED)
    .map((e) => ({ at: shortTime(Date.parse(e.measuredAt), timeZone), type: e.type, severity: e.severity, message: e.message.slice(0, 120) }));

  const bySource: Record<string, number> = {};
  for (const c of data.commands) bySource[c.source] = (bySource[c.source] ?? 0) + 1;

  return {
    days,
    timeZone,
    from: localTime(fromMs, timeZone).slice(4),
    to: localTime(nowMs, timeZone).slice(4),
    hoursInWindow: days * 24,
    hoursWithData: rollups.length,
    overall: rollups.length > 0 ? row("all", rollups) : null,
    rows: [...groups.entries()].map(([label, list]) => row(label, list)),
    events,
    offline: offlinePeriods(data.events, nowMs, timeZone),
    eventCounts,
    commands: {
      total: data.commands.length,
      bySource,
      failed: data.commands.filter((c) => c.status === "failed" || c.status === "rejected" || c.status === "timeout").length,
    },
  };
}

const pct = (x: number) => (x > 0 && x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);
const num = (x: number, digits: number) => x.toFixed(digits);

function rangeText(name: string, r: Range | null, unit: string, digits: number): string | null {
  return r ? `${name} ${num(r.min, digits)}/${num(r.avg, digits)}/${num(r.max, digits)}${unit}` : null;
}

function rowText(r: HistoryRow, perDay: boolean): string {
  const states = STATES.filter((s) => s !== "NORMAL" && r.states[s] > 0)
    .map((s) => `${s} ${pct(r.states[s])}`)
    .join(" ");
  return [
    perDay && r.hours < 24 ? `${r.label} (readings in ${r.hours} of 24 h)` : r.label,
    rangeText("T", r.temperature, "°C", 1),
    rangeText("H", r.humidity, "%", 0),
    rangeText("AQ", r.airQuality, "", 0),
    rangeText("light", r.light, "lx", 0),
    states ? `not normal: ${states}` : "always NORMAL",
    `window open ${pct(r.windowOpen)}`,
    `motion ${pct(r.presence)}`,
    r.buzzer > 0 ? `alarm ${pct(r.buzzer)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");
}

/** The HISTORY section of the prompt. */
export function historyText(h: RoomHistory): string {
  const lines = [
    `HISTORY of the last ${h.days} day(s), ${h.from} → ${h.to} (${h.timeZone} local time)`,
    `data coverage: ${h.hoursWithData} of ${h.hoursInWindow} hours have readings${h.hoursWithData === 0 ? " (no readings at all)" : ""}`,
    "Values are min/avg/max. \"not normal\" = share of the time in that state. Hours without readings: the device was off or offline.",
  ];
  if (h.overall) lines.push(`whole period: ${rowText(h.overall, false).replace(/^all \| /, "")}`);
  const perDay = h.days > 2;
  if (h.rows.length > 0) lines.push(`per ${perDay ? "day" : "hour"}:`, ...h.rows.map((r) => rowText(r, perDay)));
  const counts = Object.entries(h.eventCounts)
    .map(([type, n]) => `${type} ${n}`)
    .join(", ");
  lines.push(`events: ${counts || "none"}`);
  const duration = (m: number) => (m < 120 ? `${m} min` : `${Math.round(m / 60)} h`);
  lines.push(
    `device offline: ${
      h.offline.map((o) => `${o.from} → ${o.to ?? "still offline"} (${duration(o.minutes)})`).join(", ") || "never"
    }`,
  );
  if (h.events.length > 0) lines.push("notable events, newest first:", ...h.events.map((e) => `${e.at} ${e.severity} ${e.type}: ${e.message}`));
  const sources = Object.entries(h.commands.bySource)
    .map(([s, n]) => `${s} ${n}`)
    .join(", ");
  lines.push(`commands sent: ${h.commands.total}${sources ? ` (${sources})` : ""}, failed, rejected or unanswered: ${h.commands.failed}`);
  lines.push(
    h.days >= HISTORY_MAX_DAYS
      ? "This is all the history there is: answer the question from it now, historyDays null."
      : `Answer the question from this HISTORY now, historyDays null (more than ${h.days} only if the question needs older data).`,
  );
  return lines.join("\n");
}
