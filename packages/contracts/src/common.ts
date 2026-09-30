import { z } from "zod";

// §5.1 common fields and §5.2 enums shared by several payloads.

export const CONTRACT_VERSION = 1;

/** §6.5: larger MQTT payloads are dropped. */
export const MAX_PAYLOAD_BYTES = 1024;

export const DeviceId = z.string().regex(/^[a-z0-9-]{3,32}$/);
export const BootId = z.string().regex(/^[0-9a-f]{8}$/);
/** Epoch ms UTC, `null` until the device has synced NTP once. */
export const Ts = z.number().int().positive().nullable();
export const Seq = z.number().int().nonnegative().max(0xffffffff);

export const EdgeState = z.enum(["NORMAL", "UNCOMFORTABLE", "WARNING", "DANGER"]);
export type EdgeState = z.infer<typeof EdgeState>;

export const Severity = z.enum(["info", "warning", "critical"]);
export type Severity = z.infer<typeof Severity>;

export const Actuators = z.object({
  windowAngle: z.number().int().min(0).max(90),
  buzzer: z.boolean(),
});
export type Actuators = z.infer<typeof Actuators>;

/** Override as reported in status and ack payloads. */
export const OverrideState = z.object({
  window: z.boolean(),
  buzzer: z.boolean(),
  expiresInSec: z.number().int().nonnegative(),
});
export type OverrideState = z.infer<typeof OverrideState>;
