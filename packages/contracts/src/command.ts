import { z } from "zod";
import { Actuators, DeviceId, OverrideState, Ts } from "./common";

// §5.2 enums
export const CommandAction = z.enum([
  "OPEN_WINDOW",
  "CLOSE_WINDOW",
  "BUZZER_ON",
  "BUZZER_OFF",
  "CLEAR_OVERRIDE",
  "PING",
]);
export type CommandAction = z.infer<typeof CommandAction>;

export const CommandSource = z.enum(["dashboard", "ai", "api"]);
export type CommandSource = z.infer<typeof CommandSource>;

export const CommandStatus = z.enum(["pending", "sent", "executed", "rejected", "failed", "timeout"]);
export type CommandStatus = z.infer<typeof CommandStatus>;

export const AckStatus = z.enum(["executed", "rejected", "failed"]);
export type AckStatus = z.infer<typeof AckStatus>;

export const RejectReason = z.enum(["INVALID_PAYLOAD", "UNSUPPORTED_VERSION", "UNKNOWN_ACTION", "VALUE_OUT_OF_RANGE"]);
export type RejectReason = z.infer<typeof RejectReason>;

/** `CommandRecord.reason` for commands the backend fails itself (§6.6). */
export const CommandFailReason = z.enum(["DEVICE_OFFLINE", "BROKER_DISCONNECTED", "PUBLISH_ERROR"]);
export type CommandFailReason = z.infer<typeof CommandFailReason>;

export const WINDOW_ANGLE_MIN = 1;
export const WINDOW_ANGLE_MAX = 90;

// §5.6 `{prefix}/{deviceId}/command` (backend → device)
export const CommandMessage = z.object({
  v: z.literal(1),
  commandId: z.string().uuid(),
  action: CommandAction,
  value: z.number().int().min(WINDOW_ANGLE_MIN).max(WINDOW_ANGLE_MAX).optional(),
  source: CommandSource,
  ts: z.number().int().positive(),
});
export type CommandMessage = z.infer<typeof CommandMessage>;

// §5.7 `{prefix}/{deviceId}/command/ack` (device → backend). The device accepts any
// commandId up to 64 chars; only the backend's UUIDs match a `CommandRecord`.
export const CommandAck = z.object({
  v: z.literal(1),
  deviceId: DeviceId,
  commandId: z.string().min(1).max(64),
  status: AckStatus,
  reason: z.string().max(64).nullable(),
  ts: Ts,
  actuators: Actuators,
  override: OverrideState,
});
export type CommandAck = z.infer<typeof CommandAck>;

// Body of `POST /api/devices/:code/commands`. `value` only matters for
// OPEN_WINDOW (integer 1–90, optional); it is ignored for every other action.
export const CommandRequest = z
  .object({
    action: CommandAction,
    value: z.number().nullish(),
    source: z.enum(["dashboard", "ai"]).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.action !== "OPEN_WINDOW" || body.value == null) return;
    if (!Number.isInteger(body.value) || body.value < WINDOW_ANGLE_MIN || body.value > WINDOW_ANGLE_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `OPEN_WINDOW value must be an integer ${WINDOW_ANGLE_MIN}-${WINDOW_ANGLE_MAX}`,
      });
    }
  });
export type CommandRequest = z.infer<typeof CommandRequest>;
