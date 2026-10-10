import type { DevicePresence, EdgeState } from "@srdt/contracts";

export const STATE_LABEL: Record<EdgeState, string> = {
  NORMAL: "Normal",
  UNCOMFORTABLE: "Uncomfortable",
  WARNING: "Warning",
  DANGER: "Danger",
};

export const PRESENCE_LABEL: Record<DevicePresence, string> = {
  online: "Online",
  offline: "Offline",
  unknown: "Unknown",
};

export function fmt(value: number | null | undefined, digits = 1): string {
  return value == null || Number.isNaN(value) ? "—" : value.toFixed(digits);
}

/** "3 s ago", "4 min ago", "2 h ago". */
export function ago(ms: number | null, now: number): string {
  if (ms === null) return "never";
  const sec = Math.max(0, Math.round((now - ms) / 1000));
  if (sec < 60) return `${sec} s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** 125 → "2:05". */
export function countdown(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 24-hour "14:03:27" in the local time zone. */
export function clockTime(iso: string | number): string {
  const d = new Date(iso);
  // Built by hand: Hermes' toLocaleTimeString ignores most options on Android.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function windowLabel(angle: number | null | undefined): string {
  if (angle == null) return "—";
  if (angle === 0) return "0° (closed)";
  if (angle >= 90) return "90° (open)";
  return `${angle}° (partly open)`;
}
