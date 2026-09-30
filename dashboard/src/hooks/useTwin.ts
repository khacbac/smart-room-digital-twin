"use client";

import { useEffect, useReducer } from "react";
import type {
  CommandRecord,
  DeviceRecord,
  EventRecord,
  StreamMessage,
  TelemetryRecord,
} from "@srdt/contracts";
import { twinSource, type ConnectionState } from "@/lib/datasource";

// The dashboard's copy of the twin: a snapshot, then every change from the data source.

const LIST_SIZE = 20;
/** Chart window; telemetry older than this (by receive time) is dropped. */
export const HISTORY_MS = 15 * 60_000;
const HISTORY_MAX = 1000;

export interface TwinState {
  status: "loading" | "ready" | "error";
  error: string | null;
  connection: ConnectionState;
  device: DeviceRecord | null;
  /** Oldest first, within HISTORY_MS. */
  telemetry: TelemetryRecord[];
  events: EventRecord[];
  commands: CommandRecord[];
  /** Local arrival time of the newest telemetry message, for "stale" (receive time, not device time). */
  lastTelemetryAt: number | null;
}

const initial: TwinState = {
  status: "loading",
  error: null,
  connection: "connecting",
  device: null,
  telemetry: [],
  events: [],
  commands: [],
  lastTelemetryAt: null,
};

type Action =
  | { kind: "message"; msg: StreamMessage; at: number }
  | { kind: "connection"; state: ConnectionState }
  | { kind: "error"; message: string };

function trimHistory(list: TelemetryRecord[], now: number): TelemetryRecord[] {
  const from = now - HISTORY_MS;
  const kept = list.filter((t) => Date.parse(t.receivedAt) >= from);
  return kept.length > HISTORY_MAX ? kept.slice(-HISTORY_MAX) : kept;
}

function upsert<T extends { id: string }>(list: T[], item: T, newerFirst: (a: T, b: T) => number): T[] {
  return [item, ...list.filter((x) => x.id !== item.id)].sort(newerFirst).slice(0, LIST_SIZE);
}

function reduce(state: TwinState, action: Action): TwinState {
  switch (action.kind) {
    case "connection":
      return { ...state, connection: action.state };
    case "error":
      // keep showing the last data if we had some; the banner shows the connection state
      return state.device ? state : { ...state, status: "error", error: action.message };
    case "message": {
      const { msg, at } = action;
      switch (msg.type) {
        case "snapshot": {
          const newest = msg.data.telemetry[msg.data.telemetry.length - 1];
          return {
            ...state,
            status: "ready",
            error: null,
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
          return {
            ...state,
            telemetry: trimHistory([...state.telemetry, msg.data], at),
            lastTelemetryAt: at,
          };
        }
        case "event":
          return { ...state, events: upsert(state.events, msg.data, (a, b) => b.createdAt.localeCompare(a.createdAt)) };
        case "command":
          return {
            ...state,
            commands: upsert(state.commands, msg.data, (a, b) => b.createdAt.localeCompare(a.createdAt)),
          };
      }
    }
  }
}

export function useTwin(deviceCode: string): TwinState {
  const [state, dispatch] = useReducer(reduce, initial);

  useEffect(
    () =>
      twinSource.subscribe(deviceCode, {
        onMessage: (msg) => dispatch({ kind: "message", msg, at: Date.now() }),
        onConnection: (s) => dispatch({ kind: "connection", state: s }),
        onError: (message) => dispatch({ kind: "error", message }),
      }),
    [deviceCode],
  );

  return state;
}

/** Newest telemetry sample, or null before the first one. */
export function latest(state: TwinState): TelemetryRecord | null {
  return state.telemetry[state.telemetry.length - 1] ?? null;
}
