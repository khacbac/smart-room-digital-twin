import { z } from "zod";
import { Actuators, BootId, DeviceId, EdgeState, OverrideState, Ts } from "./common";

// §5.4 `{prefix}/{deviceId}/status` (retained), union on `online`.
export const StatusOnline = z.object({
  v: z.literal(1),
  deviceId: DeviceId,
  online: z.literal(true),
  bootId: BootId,
  ts: Ts,
  fw: z.string().max(32),
  uptimeSec: z.number().int().nonnegative(),
  rssi: z.number().int(),
  edgeState: EdgeState,
  actuators: Actuators,
  override: OverrideState,
  sensorFault: z.object({ dht: z.boolean() }),
});
export type StatusOnline = z.infer<typeof StatusOnline>;

/** Last Will. Extra fields are allowed and ignored. */
export const StatusOffline = z
  .object({ v: z.literal(1), deviceId: DeviceId, online: z.literal(false) })
  .passthrough();
export type StatusOffline = z.infer<typeof StatusOffline>;

export const Status = z.discriminatedUnion("online", [StatusOnline, StatusOffline]);
export type Status = z.infer<typeof Status>;

