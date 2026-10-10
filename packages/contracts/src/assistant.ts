import { z } from "zod";
import type { CommandAction, CommandStatus } from "./command";

// Voice/text assistant (mobile/specs/05-voice-assistant.md): the app sends what the user
// said, the backend asks an LLM what to do and sends the commands itself (source "ai").

export const AssistantLocale = z.enum(["vi-VN", "en-US"]);
export type AssistantLocale = z.infer<typeof AssistantLocale>;

export const AssistantTurn = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(500),
});
export type AssistantTurn = z.infer<typeof AssistantTurn>;

/** Body of `POST /api/devices/:code/assistant`. */
export const AssistantRequest = z.object({
  text: z.string().trim().min(1).max(500),
  locale: AssistantLocale,
  /** Last turns of this voice session, oldest first, so follow-ups ("a bit more") work. */
  history: z.array(AssistantTurn).max(6).default([]),
});
export type AssistantRequest = z.infer<typeof AssistantRequest>;

export const AssistantIntent = z.enum(["command", "query", "clarify", "unsupported"]);
export type AssistantIntent = z.infer<typeof AssistantIntent>;

export interface AssistantCommandResult {
  action: CommandAction;
  value: number | null;
  /** SHOW_MESSAGE text as sent to the device. */
  text?: string | null;
  /** null when the command was not created (rate limited). */
  commandId: string | null;
  /** Status at response time; the app follows the rest over SSE. */
  status: CommandStatus | null;
  /** API error code when it could not be sent: DEVICE_OFFLINE, RATE_LIMITED, BROKER_DISCONNECTED. */
  error: string | null;
}

export interface AssistantResponse {
  intent: AssistantIntent;
  /** Text to show and speak, in the request locale. */
  reply: string;
  commands: AssistantCommandResult[];
  /** Commands the model proposed that need the user's OK first (BUZZER_ON). */
  pendingConfirmation: { action: CommandAction; value: number | null }[];
  /** The reply ends with a question (clarify, an offer, a confirmation): the app listens again after speaking it. */
  expectsAnswer: boolean;
}
