import type { StreamMessage, StreamType } from "@srdt/contracts";
import { config } from "../config";
import type { TwinHandlers, TwinSource } from "./types";

const TYPES: StreamType[] = ["snapshot", "device", "telemetry", "event", "command"];
const RETRY_MS = 3000;

/**
 * `GET /api/devices/:code/stream` (Server-Sent Events). The backend sends a full snapshot
 * first, then one message per change. EventSource reconnects on its own after a network
 * error; an HTTP error (404, backend down at start) closes it, so that case retries here.
 */
export const backendSource: TwinSource = {
  name: "backend",
  subscribe(deviceCode: string, h: TwinHandlers) {
    const url = `${config.apiBaseUrl}/api/devices/${encodeURIComponent(deviceCode)}/stream`;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let everLive = false;
    let stopped = false;

    const open = () => {
      h.onConnection(everLive ? "reconnecting" : "connecting");
      es = new EventSource(url);
      for (const type of TYPES) {
        es.addEventListener(type, (e) => {
          const data: unknown = JSON.parse((e as MessageEvent<string>).data);
          if (type === "snapshot") {
            everLive = true;
            h.onConnection("live");
          }
          h.onMessage({ type, data } as StreamMessage);
        });
      }
      es.onerror = () => {
        if (stopped || !es) return;
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          h.onError(`cannot open ${url} (backend down, wrong NEXT_PUBLIC_API_BASE_URL, or unknown device)`);
          retry = setTimeout(open, RETRY_MS);
        }
        h.onConnection(everLive ? "reconnecting" : "connecting");
      };
    };

    open();
    return () => {
      stopped = true;
      clearTimeout(retry);
      es?.close();
    };
  },
};
