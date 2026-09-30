import { z } from "zod";
import { Actuators, BootId, DeviceId, EdgeState, Seq, Ts } from "./common";

// §5.3 `{prefix}/{deviceId}/telemetry`
export const Telemetry = z.object({
  v: z.literal(1),
  deviceId: DeviceId,
  bootId: BootId,
  seq: Seq,
  ts: Ts,
  temperature: z.number().min(-40).max(80).nullable(),
  humidity: z.number().min(0).max(100).nullable(),
  light: z.number().min(0).max(100000),
  airQuality: z.number().min(0).max(1000),
  presence: z.boolean(),
  edgeState: EdgeState,
  actuators: Actuators,
  override: z.object({ window: z.boolean(), buzzer: z.boolean() }),
});
export type Telemetry = z.infer<typeof Telemetry>;

/** Live broadcast payload (D10): the validated message plus the backend's `measuredAt`. */
export type TelemetryBroadcast = Telemetry & { measuredAt: string };
