import { atom } from "jotai";
import type { AssistantResponse, AssistantTurn } from "@srdt/contracts";
import { ApiError } from "@/lib/api/client";
import { askAssistant } from "@/lib/api/endpoints";
import { haptics } from "@/lib/haptics";
import { deviceCodeAtom, voiceLocaleAtom } from "@/features/settings/_atoms/settings";

// One voice session = the turns since the sheet opened; cleared when it closes.

export interface VoiceTurn {
  id: number;
  text: string;
  /** null while waiting for the server. */
  response: AssistantResponse | null;
  error: string | null;
}

let nextId = 1;

export const voiceTurnsAtom = atom<VoiceTurn[]>([]);

export const clearVoiceSessionAtom = atom(null, (_get, set) => set(voiceTurnsAtom, []));

/** The last 3 exchanges, oldest first, so follow-ups like "a bit more" work. */
const historyAtom = atom<AssistantTurn[]>((get) =>
  get(voiceTurnsAtom)
    .filter((t) => t.response)
    .slice(-3)
    .flatMap((t) => [
      { role: "user" as const, text: t.text.slice(0, 500) },
      { role: "assistant" as const, text: t.response!.reply.slice(0, 500) },
    ]),
);

function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return String(err);
  switch (err.code) {
    case "ASSISTANT_DISABLED":
      return "Voice control isn't set up on the server (GEMINI_API_KEY, or ASSISTANT_PROVIDER=rules).";
    case "ASSISTANT_TIMEOUT":
      return "The assistant took too long to answer. Try again?";
    case "ASSISTANT_UPSTREAM":
      return "The assistant couldn't understand the answer from the language model. Try again?";
    case "RATE_LIMITED":
      return "That's a lot of questions in a minute. Give it a moment.";
    default:
      return err.message;
  }
}

/** Sends what the user said; never throws. Resolves to the finished turn. */
export const askAssistantAtom = atom(null, async (get, set, text: string): Promise<VoiceTurn> => {
  const turn: VoiceTurn = { id: nextId++, text, response: null, error: null };
  const history = get(historyAtom);
  set(voiceTurnsAtom, (turns) => [...turns, turn]);
  const update = (patch: Partial<VoiceTurn>) => {
    const done = { ...turn, ...patch };
    set(voiceTurnsAtom, (turns) => turns.map((t) => (t.id === turn.id ? done : t)));
    return done;
  };
  try {
    const response = await askAssistant(get(deviceCodeAtom), { text, locale: get(voiceLocaleAtom), history });
    return update({ response });
  } catch (err) {
    haptics.error();
    return update({ error: errorText(err) });
  }
});
