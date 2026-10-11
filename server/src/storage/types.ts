import type {
  CommandRecord,
  CommandStatus,
  DeviceRecord,
  EventRecord,
  TelemetryRecord,
  TelemetryRollup,
} from "@srdt/contracts";

// Storage boundary of the backend. Services only talk to these interfaces, so the
// in-memory driver used today can be swapped for Firestore (or anything else) without
// touching MQTT, command or API code. See docs/cloud.md for the intended mapping.
//
// Rules every driver must keep:
// - `CommandStore.transition` is a conditional update (compare-and-set on `status`), so a
//   late `sent` never overwrites an ack and a late ack never overwrites `timeout` (§6.6).
//   In Firestore this is a transaction.
// - Writes may fail; callers log and keep going (the in-memory twin state stays the truth
//   for live presence).

export interface DeviceStore {
  list(): Promise<DeviceRecord[]>;
  get(code: string): Promise<DeviceRecord | null>;
  /** Creates or fully replaces the document. */
  put(device: DeviceRecord): Promise<void>;
}

export interface TelemetryStore {
  append(record: TelemetryRecord): Promise<void>;
  /** Oldest first, `measuredAt >= since`, at most `limit` (the newest ones). */
  recent(deviceCode: string, since: Date, limit: number): Promise<TelemetryRecord[]>;
}

/** Hourly telemetry rollups, one document per device and hour (`TelemetryRollup.hour`). */
export interface RollupStore {
  /** Creates or replaces the device's rollup for `rollup.hour`. */
  put(rollup: TelemetryRollup): Promise<void>;
  get(deviceCode: string, hour: string): Promise<TelemetryRollup | null>;
  /** Oldest first, `hour >= sinceHour`. */
  since(deviceCode: string, sinceHour: string): Promise<TelemetryRollup[]>;
}

export interface EventStore {
  append(record: EventRecord): Promise<void>;
  /** Newest first; only `createdAt >= since` when given. */
  recent(deviceCode: string, limit: number, since?: Date): Promise<EventRecord[]>;
}

export type NewCommand = Pick<CommandRecord, "deviceCode" | "action" | "value" | "text" | "source">;

export interface CommandStore {
  /** `status = pending`, `createdAt = now`, new id. */
  insert(cmd: NewCommand): Promise<CommandRecord>;
  /**
   * Applies `patch` only while the status is one of `from`. Returns the updated record,
   * or `null` if the command is missing or already in another status.
   */
  transition(
    id: string,
    from: readonly CommandStatus[],
    patch: Partial<Omit<CommandRecord, "id" | "deviceCode" | "createdAt">>,
  ): Promise<CommandRecord | null>;
  get(id: string): Promise<CommandRecord | null>;
  /** `pending | sent` created before `before` (timeout sweep). */
  listOpenBefore(before: Date): Promise<CommandRecord[]>;
  /** Newest first; only `createdAt >= since` when given. */
  recent(deviceCode: string, limit: number, since?: Date): Promise<CommandRecord[]>;
}

export interface Storage {
  readonly driver: string;
  devices: DeviceStore;
  telemetry: TelemetryStore;
  rollups: RollupStore;
  events: EventStore;
  commands: CommandStore;
  /** Health check for `/health`. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}
