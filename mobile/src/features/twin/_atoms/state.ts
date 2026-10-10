import { atom } from "jotai";
import type { CommandRecord, DeviceRecord, EventRecord, TelemetryRecord } from "@srdt/contracts";
import type { ConnectionState } from "@srdt/twin-core";

// The twin, one atom per part, written by twin-stream.tsx only when that part changed:
// a telemetry sample every 2 s re-renders the readings, not the event list.

export const twinStatusAtom = atom<"loading" | "ready" | "error">("loading");
export const twinErrorAtom = atom<string | null>(null);
export const connectionAtom = atom<ConnectionState>("connecting");

export const deviceAtom = atom<DeviceRecord | null>(null);
/** Oldest first, last 15 minutes by receive time. */
export const telemetryAtom = atom<TelemetryRecord[]>([]);
/** Newest first. */
export const eventsAtom = atom<EventRecord[]>([]);
/** Newest first. */
export const commandsAtom = atom<CommandRecord[]>([]);
/** Local receive time of the newest telemetry message. */
export const lastTelemetryAtAtom = atom<number | null>(null);

/** Bumped to drop the stream and reconnect right away (pull-to-refresh, "Try again"). */
export const reconnectTokenAtom = atom(0);
export const reconnectAtom = atom(null, (get, set) => set(reconnectTokenAtom, get(reconnectTokenAtom) + 1));
