import EventSource from "react-native-sse";
import type { StreamMessage, StreamType } from "@srdt/contracts";
import type { TwinHandlers, TwinSource } from "@srdt/twin-core";
import { connectionHint } from "../connection-hints";

const TYPES: StreamType[] = ["snapshot", "device", "telemetry", "event", "command"];
const BACKOFF_MS = [1000, 2000, 4000, 8000, 10_000];
/** No message for this long while live → the stream is dead even if the socket is not. */
const SILENCE_MS = 60_000;

/**
 * react-native-sse reconnects on its own only by polling, and says nothing when the server
 * ends the response normally (what a backend restart does). This subclass turns "the
 * response is over" into a callback so one retry loop (ours) owns reconnecting.
 */
class StreamSource extends EventSource<StreamType> {
  onEnded: (() => void) | null = null;

  // react-native-sse@1.2 internal: called with allowZero=false when a response finishes.
  _pollAgain(time: number, allowZero: boolean) {
    if (allowZero) (EventSource.prototype as unknown as { _pollAgain(t: number, a: boolean): void })._pollAgain.call(this, time, allowZero);
    else this.onEnded?.();
  }
}

/**
 * `GET {baseUrl}/api/devices/:code/stream`. The backend sends a full snapshot first, then
 * one message per change, so every reconnect starts from a complete twin.
 */
export function createSseSource(baseUrl: string): TwinSource {
  return {
    name: "backend",
    subscribe(deviceCode: string, h: TwinHandlers) {
      const url = `${baseUrl}/api/devices/${encodeURIComponent(deviceCode)}/stream`;
      let es: StreamSource | null = null;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      let attempt = 0;
      let everLive = false;
      let stopped = false;

      const close = () => {
        clearTimeout(watchdog);
        if (!es) return;
        es.onEnded = null;
        es.removeAllEventListeners();
        es.close();
        es = null;
      };

      const fail = (message: string | null) => {
        if (stopped || !es) return;
        close();
        if (message) h.onError(message);
        h.onConnection(everLive ? "reconnecting" : "connecting");
        const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
        attempt += 1;
        retry = setTimeout(open, delay);
      };

      const armWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => fail(null), SILENCE_MS);
      };

      const open = () => {
        if (stopped) return;
        h.onConnection(everLive ? "reconnecting" : "connecting");
        const source = new StreamSource(url, { pollingInterval: 0, timeoutBeforeConnection: 0 });
        es = source;
        source.onEnded = () => fail(null);
        armWatchdog();
        for (const type of TYPES) {
          source.addEventListener(type, (e) => {
            if (!e.data) return;
            let data: unknown;
            try {
              data = JSON.parse(e.data);
            } catch {
              console.warn(`[sse] dropped a ${type} message that is not JSON`);
              return;
            }
            armWatchdog();
            if (type === "snapshot") {
              everLive = true;
              attempt = 0;
              h.onConnection("live");
            }
            h.onMessage({ type, data } as StreamMessage);
          });
        }
        source.addEventListener("error", (e) => {
          if (e.type === "error" && e.xhrStatus === 404) fail(`Device ${deviceCode} not found on ${baseUrl}.`);
          else if (e.type === "error" && e.xhrStatus > 0) fail(`The backend answered HTTP ${e.xhrStatus} for ${url}.`);
          else fail(`Can't reach ${baseUrl}. ${connectionHint(baseUrl)}`);
        });
      };

      open();
      return () => {
        stopped = true;
        clearTimeout(retry);
        close();
      };
    },
  };
}
