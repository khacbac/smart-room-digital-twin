import { atom } from "jotai";
import type { AssistantCommandResult, AssistantResponse, AssistantTurn } from "@srdt/contracts";
import { ApiError } from "@/lib/api/client";
import { askAssistant } from "@/lib/api/endpoints";
import { haptics } from "@/lib/haptics";
import { deviceCodeAtom, voiceLocaleAtom, type VoiceLocale } from "@/features/settings/_atoms/settings";

// One voice session = the turns since the sheet opened; cleared when it closes.

export interface VoiceTurn {
  id: number;
  text: string;
  /** null while waiting for the server. */
  response: AssistantResponse | null;
  error: string | null;
  /** Said once the device has carried out (or not) the commands of this turn. */
  report: string | null;
  /** The user's answer to pendingConfirmation (button or "yes"/"no" out loud). */
  confirmation: "yes" | "no" | null;
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

/** Shown and spoken, in the voice locale. */
function errorText(err: unknown, locale: VoiceLocale): string {
  const vi = locale === "vi-VN";
  const code = err instanceof ApiError ? err.code : "BACKEND_UNREACHABLE";
  switch (code) {
    case "ASSISTANT_DISABLED":
      return vi
        ? "Server chưa bật trợ lý giọng nói (cần ASSISTANT_PROVIDER và API key)."
        : "Voice control isn't set up on the server (ASSISTANT_PROVIDER and an API key).";
    case "ASSISTANT_TIMEOUT":
      return vi ? "Trợ lý trả lời lâu quá, bạn thử lại nhé." : "The assistant took too long to answer. Try again?";
    case "ASSISTANT_UPSTREAM":
      return vi ? "Mình chưa hiểu được câu trả lời của mô hình, bạn thử lại nhé." : "I couldn't make sense of the language model's answer. Try again?";
    case "RATE_LIMITED":
      return vi ? "Bạn hỏi hơi nhiều trong một phút rồi, đợi chút nhé." : "That's a lot of questions in a minute. Give it a moment.";
    case "BACKEND_UNREACHABLE":
      return vi ? "Mình không kết nối được tới server, bạn kiểm tra mạng nhé." : "I can't reach the server. Check the connection.";
    default:
      return err instanceof Error ? err.message : String(err);
  }
}

/** Sends what the user said; never throws. Resolves to the finished turn. */
export const askAssistantAtom = atom(null, async (get, set, text: string): Promise<VoiceTurn> => {
  const turn: VoiceTurn = { id: nextId++, text, response: null, error: null, report: null, confirmation: null };
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
    return update({ error: errorText(err, get(voiceLocaleAtom)) });
  }
});

/** A turn the app answers itself (a spoken "yes" to the alarm question), without the server. */
export const addLocalTurnAtom = atom(null, (_get, set, text: string, reply: string): VoiceTurn => {
  const turn: VoiceTurn = {
    id: nextId++,
    text,
    response: { intent: "command", reply, commands: [], pendingConfirmation: [], expectsAnswer: false },
    error: null,
    report: null,
    confirmation: null,
  };
  set(voiceTurnsAtom, (turns) => [...turns, turn]);
  return turn;
});

export const patchTurnAtom = atom(null, (_get, set, id: number, patch: Partial<VoiceTurn>) =>
  set(voiceTurnsAtom, (turns) => turns.map((t) => (t.id === id ? { ...t, ...patch } : t))),
);

/** A command sent from a turn after the fact (the confirmed alarm), followed like the others. */
export const addTurnCommandAtom = atom(null, (_get, set, id: number, command: AssistantCommandResult) =>
  set(voiceTurnsAtom, (turns) =>
    turns.map((t) => (t.id === id && t.response ? { ...t, report: null, response: { ...t.response, commands: [...t.response.commands, command] } } : t)),
  ),
);

/** The voice sheet is an overlay in the tabs layout, not a route: a route can't cover the tab bar on Android. */
export const voiceOpenAtom = atom(false);
