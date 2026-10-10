import type { CommandAction, CommandRecord, CommandStatus } from "@srdt/contracts";
import { toMs } from "./format";

// Manual-control rules shared by every client: labels, which actuator a command touches,
// and which commands must not overlap. The actuator state itself always comes from the
// device's reported state, never from a sent command.

export type CommandGroup = "window" | "buzzer" | "all";

export const ACTION_LABEL: Record<CommandAction, string> = {
  OPEN_WINDOW: "Open window",
  CLOSE_WINDOW: "Close window",
  BUZZER_ON: "Turn alarm on",
  BUZZER_OFF: "Silence alarm",
  CLEAR_OVERRIDE: "Resume automatic control",
  PING: "Check connection",
  IDENTIFY: "Identify device",
  SHOW_MESSAGE: "Show message",
};

const GROUP: Record<CommandAction, CommandGroup | null> = {
  OPEN_WINDOW: "window",
  CLOSE_WINDOW: "window",
  BUZZER_ON: "buzzer",
  BUZZER_OFF: "buzzer",
  CLEAR_OVERRIDE: "all",
  PING: null,
  IDENTIFY: null,
  SHOW_MESSAGE: null,
};

export function actionGroup(action: CommandAction): CommandGroup | null {
  return GROUP[action];
}

/** Still waiting for a final result from the device. */
export const isOpenStatus = (s: CommandStatus): boolean => s === "pending" || s === "sent";

/** Two commands conflict when they drive the same actuator (CLEAR_OVERRIDE drives both). */
export function conflicts(a: CommandGroup | null, b: CommandGroup | null): boolean {
  if (!a || !b) return false;
  return a === "all" || b === "all" || a === b;
}

/**
 * True while a request for a conflicting actuator is in flight (`requesting`) or a
 * conflicting command is still open.
 */
export function isBusy(action: CommandAction, requesting: readonly CommandAction[], commands: readonly CommandRecord[]): boolean {
  const g = GROUP[action];
  return (
    requesting.some((a) => conflicts(GROUP[a], g)) ||
    commands.some((c) => isOpenStatus(c.status) && conflicts(GROUP[c.action], g))
  );
}

/** Toast text for a command's final status, e.g. "Open window completed in 0.8 s". */
export function resultText(c: Pick<CommandRecord, "action" | "status" | "reason" | "createdAt" | "ackedAt">): string {
  switch (c.status) {
    case "executed": {
      const created = toMs(c.createdAt);
      const acked = toMs(c.ackedAt);
      const took = created !== null && acked !== null ? ` in ${((acked - created) / 1000).toFixed(1)} s` : "";
      return `${ACTION_LABEL[c.action]} completed${took}`;
    }
    case "rejected":
      return `${ACTION_LABEL[c.action]} rejected by the device (${c.reason ?? "no reason"})`;
    case "failed":
      return `${ACTION_LABEL[c.action]} failed (${c.reason ?? "unknown"})`;
    case "timeout":
      return `${ACTION_LABEL[c.action]}: device did not respond in time`;
    default:
      return `${ACTION_LABEL[c.action]} ${c.status}`;
  }
}

/** Human text for an API error code of `POST /commands`; falls back to the server message. */
export function apiErrorText(code: string, message: string): string {
  switch (code) {
    case "DEVICE_OFFLINE":
      return "Device is offline";
    case "BROKER_DISCONNECTED":
      return "Backend is not connected to the MQTT broker";
    case "RATE_LIMITED":
      return "Too many commands, wait a moment";
    default:
      return message;
  }
}
