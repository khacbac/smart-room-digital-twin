import type { CommandAck, CommandAction, CommandSource, CommandStatus } from "./command";
import type { EdgeState, OverrideState, Severity } from "./common";
import type { StatusOnline } from "./status";

// Backend ↔ dashboard records. They are storage-agnostic on purpose: the backend keeps
// them in memory today, and the cloud team can store the same shapes as Firestore
// documents later (see docs/cloud.md). Timestamps are ISO strings, ids are strings.

export type DevicePresence = "online" | "offline" | "unknown";

/**
 * The twin's "reported" side: the device's last online status plus `override.expiresAt`
 * (ISO), which the backend computes so the dashboard can count down. `null` when there
 * is no expiry to show.
 */
export type ReportedState = Omit<StatusOnline, "override"> & {
  override: OverrideState & { expiresAt: string | null };
};

export interface DeviceRecord {
  code: string;
  name: string;
  presence: DevicePresence;
  edgeState: EdgeState | null;
  fwVersion: string | null;
  bootId: string | null;
  reported: ReportedState | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One telemetry sample, flattened so it can be queried/charted directly. */
export interface TelemetryRecord {
  id: string;
  deviceCode: string;
  bootId: string;
  seq: number;
  /** Device `ts` if it is within ±5 min of server time, else the receive time. */
  measuredAt: string;
  receivedAt: string;
  temperature: number | null;
  humidity: number | null;
  light: number;
  airQuality: number;
  presence: boolean;
  edgeState: EdgeState;
  windowAngle: number;
  buzzer: boolean;
  overrideActive: boolean;
}

export interface EventRecord {
  id: string;
  deviceCode: string;
  source: "device" | "server";
  bootId: string | null;
  seq: number | null;
  type: string;
  severity: Severity;
  message: string;
  data: Record<string, unknown>;
  measuredAt: string;
  createdAt: string;
}

export interface CommandRecord {
  id: string;
  deviceCode: string;
  action: CommandAction;
  value: number | null;
  source: CommandSource;
  status: CommandStatus;
  reason: string | null;
  ack: CommandAck | null;
  createdAt: string;
  sentAt: string | null;
  ackedAt: string | null;
}

/** `GET /api/devices/:code`: everything the dashboard needs to render the twin. */
export interface TwinSnapshot {
  device: DeviceRecord;
  /** Oldest first. */
  telemetry: TelemetryRecord[];
  /** Newest first. */
  events: EventRecord[];
  /** Newest first. */
  commands: CommandRecord[];
}

/**
 * Server-Sent Events on `GET /api/devices/:code/stream`. The SSE `event:` name is the
 * `type`, the `data:` line is the JSON of `data`.
 */
export type StreamMessage =
  | { type: "snapshot"; data: TwinSnapshot }
  | { type: "device"; data: DeviceRecord }
  | { type: "telemetry"; data: TelemetryRecord }
  | { type: "event"; data: EventRecord }
  | { type: "command"; data: CommandRecord };

export type StreamType = StreamMessage["type"];
