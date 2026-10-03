import { randomUUID } from "node:crypto";
import type { CommandRecord, CommandStatus, DeviceRecord, EventRecord, TelemetryRecord } from "@srdt/contracts";
import type { CommandStore, DeviceStore, EventStore, NewCommand, Storage, TelemetryStore } from "../types";

// In-memory driver: the default until the cloud storage exists. Everything is lost on
// restart, and each list is capped per device so a long demo does not grow forever.

export interface MemoryLimits {
  telemetryPerDevice: number;
  eventsPerDevice: number;
  commandsPerDevice: number;
}

export const DEFAULT_MEMORY_LIMITS: MemoryLimits = {
  telemetryPerDevice: 2000, // ≈ 3 h at one stored sample every 5 s
  eventsPerDevice: 200,
  commandsPerDevice: 200,
};

const clone = <T>(v: T): T => structuredClone(v);

/** Appends and drops the oldest entries above `max`; returns the dropped ones. */
function push<T>(map: Map<string, T[]>, key: string, item: T, max: number): T[] {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  list.push(item);
  return list.length > max ? list.splice(0, list.length - max) : [];
}

/**
 * Per-device append-only log keyed by record id, capped at `max`. Re-appending a known id
 * replaces that record in place instead of duplicating it, which is what MQTT QoS 1
 * redelivery needs (§6.5) and what the Firestore driver gets for free from a derived
 * document id. A `Map` iterates in insertion order, so the log stays chronological.
 */
class Log<T extends { id: string; deviceCode: string }> {
  private readonly byDevice = new Map<string, Map<string, T>>();
  constructor(private readonly max: number) {}

  set(record: T) {
    let byId = this.byDevice.get(record.deviceCode);
    if (!byId) {
      byId = new Map();
      this.byDevice.set(record.deviceCode, byId);
    }
    byId.set(record.id, clone(record));
    while (byId.size > this.max) {
      const oldest = byId.keys().next().value;
      if (oldest === undefined) break;
      byId.delete(oldest);
    }
  }

  /** Oldest first. */
  list(deviceCode: string): T[] {
    return [...(this.byDevice.get(deviceCode)?.values() ?? [])];
  }
}

class MemoryDevices implements DeviceStore {
  private readonly rows = new Map<string, DeviceRecord>();

  async list() {
    return [...this.rows.values()].map(clone).sort((a, b) => a.code.localeCompare(b.code));
  }
  async get(code: string) {
    const row = this.rows.get(code);
    return row ? clone(row) : null;
  }
  async put(device: DeviceRecord) {
    this.rows.set(device.code, clone(device));
  }
}

class MemoryTelemetry implements TelemetryStore {
  private readonly log: Log<TelemetryRecord>;
  constructor(max: number) {
    this.log = new Log(max);
  }

  async append(record: TelemetryRecord) {
    this.log.set(record);
  }
  async recent(deviceCode: string, since: Date, limit: number) {
    const from = since.toISOString();
    const list = this.log.list(deviceCode).filter((r) => r.measuredAt >= from);
    return list.slice(-limit).map(clone);
  }
}

class MemoryEvents implements EventStore {
  private readonly log: Log<EventRecord>;
  constructor(max: number) {
    this.log = new Log(max);
  }

  async append(record: EventRecord) {
    this.log.set(record);
  }
  async recent(deviceCode: string, limit: number) {
    return this.log.list(deviceCode).slice(-limit).reverse().map(clone);
  }
}

class MemoryCommands implements CommandStore {
  private readonly byId = new Map<string, CommandRecord>();
  private readonly byDevice = new Map<string, CommandRecord[]>();
  constructor(
    private readonly max: number,
    private readonly now: () => number,
  ) {}

  async insert(cmd: NewCommand) {
    const row: CommandRecord = {
      id: randomUUID(),
      ...cmd,
      status: "pending",
      reason: null,
      ack: null,
      createdAt: new Date(this.now()).toISOString(),
      sentAt: null,
      ackedAt: null,
    };
    this.byId.set(row.id, row);
    for (const dropped of push(this.byDevice, row.deviceCode, row, this.max)) this.byId.delete(dropped.id);
    return clone(row);
  }

  async transition(id: string, from: readonly CommandStatus[], patch: Partial<CommandRecord>) {
    const row = this.byId.get(id);
    if (!row || !from.includes(row.status)) return null;
    Object.assign(row, patch, { id: row.id, deviceCode: row.deviceCode, createdAt: row.createdAt });
    return clone(row);
  }

  async get(id: string) {
    const row = this.byId.get(id);
    return row ? clone(row) : null;
  }

  async listOpenBefore(before: Date) {
    const cutoff = before.toISOString();
    return [...this.byId.values()]
      .filter((c) => (c.status === "pending" || c.status === "sent") && c.createdAt < cutoff)
      .map(clone);
  }

  async recent(deviceCode: string, limit: number) {
    return (this.byDevice.get(deviceCode) ?? []).slice(-limit).reverse().map(clone);
  }
}

export function createMemoryStorage(
  limits: MemoryLimits = DEFAULT_MEMORY_LIMITS,
  now: () => number = Date.now,
): Storage {
  return {
    driver: "memory",
    devices: new MemoryDevices(),
    telemetry: new MemoryTelemetry(limits.telemetryPerDevice),
    events: new MemoryEvents(limits.eventsPerDevice),
    commands: new MemoryCommands(limits.commandsPerDevice, now),
    ping: async () => true,
    close: async () => undefined,
  };
}
