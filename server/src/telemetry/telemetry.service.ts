import type { EdgeState, Telemetry, TelemetryRecord } from "@srdt/contracts";
import type { Logger } from "../logger";
import type { Publisher } from "../realtime/hub";
import type { TelemetryStore } from "../storage/types";

/**
 * §9.3 downsampling, per device: store when TELEMETRY_PERSIST_INTERVAL_SEC has passed
 * since the last stored sample, or when `edgeState` differs from it.
 */
export class Downsampler {
  private readonly last = new Map<string, { atMs: number; edgeState: EdgeState }>();

  constructor(private readonly intervalMs: number) {}

  shouldPersist(deviceCode: string, edgeState: EdgeState, nowMs: number): boolean {
    const last = this.last.get(deviceCode);
    if (last && nowMs - last.atMs < this.intervalMs && last.edgeState === edgeState) return false;
    this.last.set(deviceCode, { atMs: nowMs, edgeState });
    return true;
  }
}

export function toTelemetryRecord(
  deviceCode: string,
  msg: Telemetry,
  measuredAt: Date,
  receivedAtMs: number,
): TelemetryRecord {
  return {
    // bootId + seq is unique per device (§5.1), so a store can use it as an idempotent id
    id: `${msg.bootId}-${msg.seq}`,
    deviceCode,
    bootId: msg.bootId,
    seq: msg.seq,
    measuredAt: measuredAt.toISOString(),
    receivedAt: new Date(receivedAtMs).toISOString(),
    temperature: msg.temperature,
    humidity: msg.humidity,
    light: msg.light,
    airQuality: msg.airQuality,
    presence: msg.presence,
    edgeState: msg.edgeState,
    windowAngle: msg.actuators.windowAngle,
    buzzer: msg.actuators.buzzer,
    overrideActive: msg.override.window || msg.override.buzzer,
  };
}

/** Telemetry route: every message goes live to the dashboards, the store gets a downsampled copy. */
export class TelemetryService {
  constructor(
    private readonly store: TelemetryStore,
    private readonly hub: Publisher,
    private readonly downsampler: Downsampler,
    private readonly log: Logger,
  ) {}

  async handle(deviceCode: string, msg: Telemetry, measuredAt: Date, receivedAtMs: number): Promise<void> {
    const record = toTelemetryRecord(deviceCode, msg, measuredAt, receivedAtMs);
    this.hub.publish(deviceCode, { type: "telemetry", data: record });
    if (!this.downsampler.shouldPersist(deviceCode, msg.edgeState, receivedAtMs)) return;
    try {
      await this.store.append(record);
    } catch (err) {
      this.log.error({ err, device: deviceCode, seq: msg.seq }, "telemetry not stored");
    }
  }

  recent(deviceCode: string, since: Date, limit: number): Promise<TelemetryRecord[]> {
    return this.store.recent(deviceCode, since, limit);
  }
}
