import type { CommandRecord, DeviceRecord, EventRecord, StreamMessage, TelemetryRecord } from "@srdt/contracts";

// A client's copy of the twin: a snapshot, then every change from the data source.
// Pure, so the dashboard's reducer and the app's atoms apply messages the same way.

export const LIST_SIZE = 20;
/** Chart window; telemetry older than this (by receive time) is dropped. */
export const HISTORY_MS = 15 * 60_000;
export const HISTORY_MAX = 1000;

export interface TwinData {
  device: DeviceRecord | null;
  /** Oldest first, within HISTORY_MS. */
  telemetry: TelemetryRecord[];
  /** Newest first, at most LIST_SIZE. */
  events: EventRecord[];
  /** Newest first, at most LIST_SIZE. */
  commands: CommandRecord[];
  /** Local arrival time of the newest telemetry message, for "stale" (receive time, not device time). */
  lastTelemetryAt: number | null;
}

export const initialTwinData: TwinData = {
  device: null,
  telemetry: [],
  events: [],
  commands: [],
  lastTelemetryAt: null,
};

function trimHistory(list: TelemetryRecord[], now: number): TelemetryRecord[] {
  const from = now - HISTORY_MS;
  const kept = list.filter((t) => Date.parse(t.receivedAt) >= from);
  return kept.length > HISTORY_MAX ? kept.slice(-HISTORY_MAX) : kept;
}

function upsert<T extends { id: string; createdAt: string }>(list: T[], item: T): T[] {
  return [item, ...list.filter((x) => x.id !== item.id)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, LIST_SIZE);
}

/**
 * Applies one stream message received at `at` (local ms). Returns `state` itself when
 * nothing changed, and keeps every untouched field's reference, so callers can tell which
 * parts changed with `!==`.
 */
export function applyMessage<S extends TwinData>(state: S, msg: StreamMessage, at: number): S {
  switch (msg.type) {
    case "snapshot": {
      const newest = msg.data.telemetry[msg.data.telemetry.length - 1];
      return {
        ...state,
        device: msg.data.device,
        telemetry: trimHistory(msg.data.telemetry, at),
        events: msg.data.events,
        commands: msg.data.commands,
        lastTelemetryAt: newest ? Date.parse(newest.receivedAt) : state.lastTelemetryAt,
      };
    }
    case "device":
      return { ...state, device: msg.data };
    case "telemetry": {
      if (state.telemetry.some((t) => t.id === msg.data.id)) return state;
      return { ...state, telemetry: trimHistory([...state.telemetry, msg.data], at), lastTelemetryAt: at };
    }
    case "event":
      return { ...state, events: upsert(state.events, msg.data) };
    case "command":
      return { ...state, commands: upsert(state.commands, msg.data) };
  }
}

/** Newest telemetry sample, or null before the first one. */
export function latest(telemetry: readonly TelemetryRecord[]): TelemetryRecord | null {
  return telemetry[telemetry.length - 1] ?? null;
}
