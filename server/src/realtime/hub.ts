import type { ServerResponse } from "node:http";
import type { StreamMessage } from "@srdt/contracts";
import type { Logger } from "../logger";

// Live fan-out to dashboards over Server-Sent Events, one channel per device code.
// This replaces a database realtime feature for now: every service publishes the record
// it just wrote, and the hub forwards it to the dashboards watching that device.

export interface Publisher {
  publish(deviceCode: string, msg: StreamMessage): void;
}

/** SSE comment line sent this often so proxies (and Firebase Hosting rewrites) keep the stream open. */
const HEARTBEAT_MS = 15_000;

export class RealtimeHub implements Publisher {
  private readonly clients = new Map<string, Set<ServerResponse>>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(private readonly log: Logger) {
    this.heartbeat = setInterval(() => {
      for (const set of this.clients.values()) for (const res of set) res.write(": ping\n\n");
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /** Registers a response that already has its SSE headers written; removed on close. */
  add(deviceCode: string, res: ServerResponse): void {
    let set = this.clients.get(deviceCode);
    if (!set) {
      set = new Set();
      this.clients.set(deviceCode, set);
    }
    set.add(res);
    this.log.debug({ device: deviceCode, clients: set.size }, "stream client connected");
    res.on("close", () => {
      set.delete(res);
      this.log.debug({ device: deviceCode, clients: set.size }, "stream client disconnected");
    });
  }

  publish(deviceCode: string, msg: StreamMessage): void {
    const set = this.clients.get(deviceCode);
    if (!set || set.size === 0) return;
    const frame = formatSse(msg);
    for (const res of set) res.write(frame);
  }

  count(): number {
    let n = 0;
    for (const set of this.clients.values()) n += set.size;
    return n;
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const set of this.clients.values()) for (const res of set) res.end();
    this.clients.clear();
  }
}

export function formatSse(msg: StreamMessage): string {
  return `event: ${msg.type}\ndata: ${JSON.stringify(msg.data)}\n\n`;
}
