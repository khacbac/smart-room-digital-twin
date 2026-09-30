import { z } from "zod";
import { BootId, DeviceId, Severity, Seq, Ts } from "./common";

// §5.5 `{prefix}/{deviceId}/event`
export const DeviceEventType = z.enum([
  "BOOT",
  "STATE_CHANGED",
  "SENSOR_FAULT",
  "SENSOR_RECOVERED",
  "BUTTON_PRESSED",
  "OVERRIDE_SET",
  "OVERRIDE_CLEARED",
  "COMMAND_REJECTED",
]);
export type DeviceEventType = z.infer<typeof DeviceEventType>;

export const DeviceEvent = z.object({
  v: z.literal(1),
  deviceId: DeviceId,
  bootId: BootId,
  seq: Seq,
  ts: Ts,
  type: DeviceEventType,
  severity: Severity,
  message: z.string().max(256),
  // The shape depends on `type` (§5.5), so it stays open. OVERRIDE_SET from the button
  // carries `source: "button"`, which is not a CommandSource.
  data: z.record(z.string(), z.unknown()).default({}),
});
export type DeviceEvent = z.infer<typeof DeviceEvent>;

// Events written by the backend itself (`EventRecord.source = "server"`).
export const ServerEventType = z.enum(["DEVICE_ONLINE", "DEVICE_OFFLINE", "COMMAND_TIMEOUT"]);
export type ServerEventType = z.infer<typeof ServerEventType>;
