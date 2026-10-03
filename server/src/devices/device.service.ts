import type { DevicePresence, DeviceRecord, EdgeState, ReportedState, StatusOnline } from "@srdt/contracts";
import type { ServerEventSink } from "../events/event.service";
import type { Logger } from "../logger";
import type { Publisher } from "../realtime/hub";
import type { DeviceStore } from "../storage/types";
import { isTsValid } from "../telemetry/time";

// Presence + the twin's reported state (§9.3 "Presence", §9.4 rule 1). This is the only
// place that changes `DeviceRecord.presence`. The in-memory map is authoritative; the
// store gets a copy (with `lastSeenAt` throttled, so a cloud DB is not written every 2 s).

export interface DeviceServiceOptions {
  autoRegister: boolean;
  offlineAfterMs: number;
  /** Devices created at startup when the store does not have them (like a DB seed). */
  seed: readonly string[];
  /** `lastSeenAt` is stored/pushed at most this often unless something else changes. */
  seenWriteIntervalMs?: number;
  /** The device document is written at most this often unless a durable field changed. */
  persistIntervalMs?: number;
}

export interface PacketInfo {
  /** MQTT retain flag: a retained message can be stale and never counts as presence. */
  retain: boolean;
  bootId?: string;
  edgeState?: EdgeState;
}

export type OfflineReason = "lwt" | "no_data";

export const SEEN_WRITE_INTERVAL_MS = 15_000;
/**
 * `reported` carries `uptimeSec`, `rssi` and `ts`, so it differs on every status message.
 * Without this the document would be rewritten roughly every 10 s — measured at
 * ~8 600 writes/day/device, more than the downsampled telemetry costs (docs/cloud.md §2).
 */
export const DEVICE_PERSIST_INTERVAL_MS = 60_000;

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * `override.expiresAt` for the reported state. A retained status was published at an
 * unknown time, so it only gets an expiry when its `ts` is valid.
 */
export function overrideExpiresAt(status: StatusOnline, receivedAtMs: number, retain: boolean): string | null {
  const sec = status.override.expiresInSec;
  if (sec === 0) return null;
  if (!retain) return iso(receivedAtMs + sec * 1000);
  return isTsValid(status.ts, receivedAtMs) ? iso(status.ts + sec * 1000) : null;
}

interface Tracked {
  record: DeviceRecord;
  /** Epoch ms of the last live message (the record's copy is throttled). */
  lastSeenAt: number | null;
  writtenSeenAt: number | null;
  /** Epoch ms of the last `store.put`, `null` when the next commit must write. */
  storedAt: number | null;
}

export class DeviceService {
  private readonly devices = new Map<string, Tracked>();
  private readonly registering = new Map<string, Promise<Tracked | null>>();
  private readonly seenWriteIntervalMs: number;
  private readonly persistIntervalMs: number;

  constructor(
    private readonly store: DeviceStore,
    private readonly events: ServerEventSink,
    private readonly hub: Publisher,
    private readonly opts: DeviceServiceOptions,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {
    this.seenWriteIntervalMs = opts.seenWriteIntervalMs ?? SEEN_WRITE_INTERVAL_MS;
    this.persistIntervalMs = opts.persistIntervalMs ?? DEVICE_PERSIST_INTERVAL_MS;
  }

  /** Loads the devices from the store and creates the seed ones. Call before consuming MQTT. */
  async load(): Promise<void> {
    for (const record of await this.store.list()) this.track(record);
    for (const code of this.opts.seed) {
      if (!this.devices.has(code)) await this.create(code);
    }
    this.log.info(
      { devices: [...this.devices.values()].map((d) => `${d.record.code}:${d.record.presence}`) },
      "devices loaded",
    );
  }

  get(code: string): DeviceRecord | undefined {
    return this.devices.get(code)?.record;
  }

  list(): DeviceRecord[] {
    return [...this.devices.values()].map((d) => d.record);
  }

  /** Ingestion: an unknown device is registered when AUTO_REGISTER_DEVICES is on. */
  async resolve(code: string): Promise<DeviceRecord | null> {
    const known = this.devices.get(code);
    if (known) return known.record;
    let pending = this.registering.get(code);
    if (!pending) {
      pending = this.register(code).finally(() => this.registering.delete(code));
      this.registering.set(code, pending);
    }
    return (await pending)?.record ?? null;
  }

  /** Every valid live message from a device proves it is online. */
  async touch(code: string, packet: PacketInfo): Promise<void> {
    const d = this.devices.get(code);
    if (!d || packet.retain) return;
    const now = this.now();
    const r = d.record;
    d.lastSeenAt = now;
    if (packet.bootId) r.bootId = packet.bootId;
    const edgeChanged = packet.edgeState !== undefined && packet.edgeState !== r.edgeState;
    if (packet.edgeState) r.edgeState = packet.edgeState;

    if (r.presence !== "online") {
      // Flip before the first await, so a concurrent message can't raise a second DEVICE_ONLINE.
      r.presence = "online";
      await this.commit(d, true, true);
      this.log.info({ device: code, bootId: r.bootId }, "device online");
      await this.events.server(code, "DEVICE_ONLINE", "info", "device online", { bootId: r.bootId });
      return;
    }
    const due = d.writtenSeenAt === null || now - d.writtenSeenAt >= this.seenWriteIntervalMs;
    if (due || edgeChanged) await this.commit(d, true, edgeChanged);
  }

  async markOffline(code: string, reason: OfflineReason): Promise<void> {
    const d = this.devices.get(code);
    if (!d || d.record.presence === "offline") return;
    d.record.presence = "offline";
    await this.commit(d, d.lastSeenAt !== null, true);
    this.log.info({ device: code, reason }, "device offline");
    await this.events.server(code, "DEVICE_OFFLINE", "warning", `device offline (${reason})`, { reason });
  }

  /**
   * Online status → reported state, fw, bootId, edgeState. Runs for retained messages
   * too, because they carry the actuator/override state (§9.3).
   */
  async saveStatus(code: string, status: StatusOnline, receivedAtMs: number, retain: boolean): Promise<void> {
    const d = this.devices.get(code);
    if (!d) return;
    const r = d.record;
    // A reboot, a firmware change or an edge-state change has to survive a backend
    // restart, so it is written now; the rest of `reported` can wait for the throttle.
    const durable = status.bootId !== r.bootId || status.fw !== r.fwVersion || status.edgeState !== r.edgeState;
    const reported: ReportedState = {
      ...status,
      override: { ...status.override, expiresAt: overrideExpiresAt(status, receivedAtMs, retain) },
    };
    Object.assign(r, {
      reported,
      fwVersion: status.fw,
      bootId: status.bootId,
      edgeState: status.edgeState,
    });
    await this.commit(d, false, durable);
  }

  /** §9.4 rule 1, every 10 s: online devices silent for DEVICE_OFFLINE_AFTER_SEC. */
  async sweep(): Promise<void> {
    const now = this.now();
    for (const d of this.devices.values()) {
      if (d.record.presence === "online" && d.lastSeenAt !== null && now - d.lastSeenAt > this.opts.offlineAfterMs) {
        await this.markOffline(d.record.code, "no_data");
      }
    }
  }

  /**
   * Pushes the record to dashboards and, at most every `persistIntervalMs`, to the store.
   * `withSeen` copies the live `lastSeenAt` in; `durable` forces the write for a change
   * that must survive a restart (presence, reboot, firmware, edge state).
   */
  private async commit(d: Tracked, withSeen: boolean, durable = false): Promise<void> {
    const now = this.now();
    if (withSeen && d.lastSeenAt !== null) {
      d.record.lastSeenAt = iso(d.lastSeenAt);
      d.writtenSeenAt = d.lastSeenAt;
    }
    d.record.updatedAt = iso(now);
    // The dashboard is live either way: only the store write is throttled.
    this.hub.publish(d.record.code, { type: "device", data: d.record });
    if (!durable && d.storedAt !== null && now - d.storedAt < this.persistIntervalMs) return;
    d.storedAt = now;
    try {
      await this.store.put(d.record);
    } catch (err) {
      // the in-memory state stays authoritative; retry on the next commit
      d.storedAt = null;
      this.log.error({ err, device: d.record.code }, "device not stored");
    }
  }

  private async register(code: string): Promise<Tracked | null> {
    const existing = await this.store.get(code);
    if (existing) return this.track(existing);
    if (!this.opts.autoRegister) {
      this.log.warn({ device: code }, "unknown device dropped (AUTO_REGISTER_DEVICES=false)");
      return null;
    }
    const d = await this.create(code);
    this.log.info({ device: code }, "device registered");
    return d;
  }

  private async create(code: string): Promise<Tracked> {
    const at = iso(this.now());
    const d = this.track({
      code,
      name: code,
      presence: "unknown",
      edgeState: null,
      fwVersion: null,
      bootId: null,
      reported: null,
      lastSeenAt: null,
      createdAt: at,
      updatedAt: at,
    });
    await this.store.put(d.record);
    d.storedAt = this.now();
    return d;
  }

  private track(record: DeviceRecord): Tracked {
    const seen = record.lastSeenAt ? Date.parse(record.lastSeenAt) : null;
    const d: Tracked = {
      record,
      // A record left `online` without a timestamp still gets swept if nothing arrives.
      lastSeenAt: seen ?? (record.presence === "online" ? this.now() : null),
      writtenSeenAt: seen,
      storedAt: null,
    };
    this.devices.set(record.code, d);
    return d;
  }
}
