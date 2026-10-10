import { z } from "zod";
import {
  AssistantIntent,
  type AssistantLocale,
  type AssistantTurn,
  type EdgeState,
} from "@srdt/contracts";

// What the assistant's language model decides for one utterance. The model never sends
// anything itself: AssistantService checks the plan and creates the commands.

/** Actions the assistant may use (PING is a diagnostic, not something a person asks for). */
export const AssistantAction = z.enum([
  "OPEN_WINDOW",
  "CLOSE_WINDOW",
  "BUZZER_ON",
  "BUZZER_OFF",
  "CLEAR_OVERRIDE",
  "IDENTIFY",
  "SHOW_MESSAGE",
]);
export type AssistantAction = z.infer<typeof AssistantAction>;

export const AssistantPlan = z.object({
  intent: AssistantIntent,
  commands: z
    .array(z.object({ action: AssistantAction, value: z.number().nullable(), text: z.string().nullish() }))
    .max(2),
  reply: z.string().trim().min(1).max(400),
  /** The reply asks the user something, so the app should listen for the answer. */
  expectsAnswer: z.boolean().default(false),
});
export type AssistantPlan = z.infer<typeof AssistantPlan>;
/** A plan before defaults (expectsAnswer may be left out). */
export type AssistantPlanInput = z.input<typeof AssistantPlan>;

/** A compact summary of the twin for the prompt (never the whole telemetry history). */
export interface RoomContext {
  deviceName: string;
  online: boolean;
  edgeState: EdgeState | null;
  mlState: EdgeState | null;
  aiControl: boolean;
  temperature: number | null;
  humidity: number | null;
  light: number | null;
  airQuality: number | null;
  presence: boolean | null;
  windowAngle: number | null;
  buzzer: boolean | null;
  override: { window: boolean; buzzer: boolean; secondsLeft: number | null };
  dhtFault: boolean;
}

export interface PlanInput {
  text: string;
  locale: AssistantLocale;
  history: AssistantTurn[];
  room: RoomContext;
}

export interface AssistantModel {
  readonly name: string;
  /** Throws on a transport error; may return anything (the caller validates it). */
  plan(input: PlanInput, signal: AbortSignal): Promise<unknown>;
}

/** Model used when ASSISTANT_MODEL is empty. */
export const DEFAULT_ASSISTANT_MODEL = {
  gemini: "gemini-3-flash-preview",
  anthropic: "claude-haiku-5-5",
} as const;
