import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { getDefaultStore, useAtomValue } from "jotai";
import { applyMessage, initialTwinData, type TwinData } from "@srdt/twin-core";
import { createSseSource } from "@/lib/datasource/rn-sse";
import { haptics } from "@/lib/haptics";
import { apiBaseUrlAtom, deviceCodeAtom } from "@/features/settings/_atoms/settings";
import { watchAwaitedCommands } from "@/features/controls/_atoms/mutations";
import {
  commandsAtom,
  connectionAtom,
  deviceAtom,
  eventsAtom,
  lastTelemetryAtAtom,
  reconnectTokenAtom,
  telemetryAtom,
  twinErrorAtom,
  twinStatusAtom,
} from "./_atoms/state";

/** Leaving the app for longer than this closes the stream (battery); coming back reopens it. */
const BACKGROUND_CLOSE_MS = 30_000;

const store = getDefaultStore();

/** Writes only the atoms whose part of the twin changed. */
function publish(prev: TwinData, next: TwinData) {
  if (next.device !== prev.device) store.set(deviceAtom, next.device);
  if (next.telemetry !== prev.telemetry) store.set(telemetryAtom, next.telemetry);
  if (next.events !== prev.events) store.set(eventsAtom, next.events);
  if (next.commands !== prev.commands) store.set(commandsAtom, next.commands);
  if (next.lastTelemetryAt !== prev.lastTelemetryAt) store.set(lastTelemetryAtAtom, next.lastTelemetryAt);
}

function current(): TwinData {
  return {
    device: store.get(deviceAtom),
    telemetry: store.get(telemetryAtom),
    events: store.get(eventsAtom),
    commands: store.get(commandsAtom),
    lastTelemetryAt: store.get(lastTelemetryAtAtom),
  };
}

function edgeStateOf(t: TwinData) {
  return t.telemetry[t.telemetry.length - 1]?.edgeState ?? t.device?.edgeState ?? null;
}

/**
 * No UI. Keeps one live stream for the device chosen in Settings while the app is in use,
 * and mirrors it into the twin atoms.
 */
export function TwinStream() {
  const baseUrl = useAtomValue(apiBaseUrlAtom);
  const deviceCode = useAtomValue(deviceCodeAtom);
  const reconnectToken = useAtomValue(reconnectTokenAtom);

  const target = useRef<string | null>(null);

  useEffect(() => watchAwaitedCommands(store), []);

  useEffect(() => {
    // A new device or URL starts from nothing, so the gate shows instead of the old room.
    // A plain reconnect keeps what is on screen until the new snapshot replaces it.
    const key = `${baseUrl}|${deviceCode}`;
    if (target.current !== key) {
      target.current = key;
      publish(current(), initialTwinData);
      store.set(twinStatusAtom, "loading");
      store.set(twinErrorAtom, null);
    }
    let twin: TwinData = current();
    let unsubscribe: (() => void) | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;

    const start = () => {
      if (unsubscribe) return;
      unsubscribe = createSseSource(baseUrl).subscribe(deviceCode, {
        onMessage: (msg) => {
          const next = applyMessage(twin, msg, Date.now());
          if (next === twin) return;
          const wasDanger = edgeStateOf(twin) === "DANGER";
          const prev = twin;
          twin = next;
          publish(prev, next);
          if (msg.type === "snapshot") {
            store.set(twinStatusAtom, "ready");
            store.set(twinErrorAtom, null);
          }
          if (prev.device && !wasDanger && edgeStateOf(next) === "DANGER") haptics.warning();
        },
        onConnection: (state) => store.set(connectionAtom, state),
        onError: (message) => {
          store.set(twinErrorAtom, message);
          // keep showing the last data if we had some; the banner shows the connection state
          if (!twin.device) store.set(twinStatusAtom, "error");
        },
      });
    };
    const stop = () => {
      unsubscribe?.();
      unsubscribe = null;
    };

    if (AppState.currentState !== "background") start();
    const sub = AppState.addEventListener("change", (state) => {
      clearTimeout(closeTimer);
      if (state === "active") start();
      else if (state === "background") closeTimer = setTimeout(stop, BACKGROUND_CLOSE_MS);
    });

    return () => {
      sub.remove();
      clearTimeout(closeTimer);
      stop();
    };
  }, [baseUrl, deviceCode, reconnectToken]);

  return null;
}
