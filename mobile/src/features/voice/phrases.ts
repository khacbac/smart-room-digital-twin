import type { AssistantCommandResult, CommandRecord } from "@srdt/contracts";
import type { VoiceLocale } from "@/features/settings/_atoms/settings";
import type { SpeechError } from "@/features/voice/use-speech";

// What the app itself says aloud, in the voice locale: the report once the device has
// carried out (or not) what the assistant sent, and the errors, so a voice turn never ends silent.

type Action = AssistantCommandResult["action"];

const vi = (locale: VoiceLocale) => locale === "vi-VN";

/** "the window is open 45 degrees" — the state after an executed command. */
function doneClause(locale: VoiceLocale, action: Action, value: number | null): string {
  switch (action) {
    case "OPEN_WINDOW":
      return vi(locale) ? `cửa sổ đã mở ${value ?? 90} độ` : `the window is open ${value ?? 90} degrees`;
    case "CLOSE_WINDOW":
      return vi(locale) ? "cửa sổ đã đóng" : "the window is closed";
    case "BUZZER_ON":
      return vi(locale) ? "còi đang kêu" : "the alarm is sounding";
    case "BUZZER_OFF":
      return vi(locale) ? "còi đã tắt" : "the alarm is off";
    case "CLEAR_OVERRIDE":
      return vi(locale) ? "phòng đã về chế độ tự động" : "the room is back on automatic control";
    case "IDENTIFY":
      return vi(locale) ? "mạch đang nháy đèn" : "the board is blinking";
    case "SHOW_MESSAGE":
      return vi(locale) ? "màn hình đã hiện chữ" : "the message is on the screen";
    default:
      return vi(locale) ? "thiết bị đã phản hồi" : "the device answered";
  }
}

/** "opening the window" — the command, for failure sentences. */
function what(locale: VoiceLocale, action: Action): string {
  const VI: Partial<Record<Action, string>> = {
    OPEN_WINDOW: "mở cửa sổ",
    CLOSE_WINDOW: "đóng cửa sổ",
    BUZZER_ON: "bật còi",
    BUZZER_OFF: "tắt còi",
    CLEAR_OVERRIDE: "trả về tự động",
    IDENTIFY: "nháy đèn",
    SHOW_MESSAGE: "hiển thị chữ",
  };
  const EN: Partial<Record<Action, string>> = {
    OPEN_WINDOW: "open the window",
    CLOSE_WINDOW: "close the window",
    BUZZER_ON: "sound the alarm",
    BUZZER_OFF: "silence the alarm",
    CLEAR_OVERRIDE: "go back to automatic",
    IDENTIFY: "blink the board",
    SHOW_MESSAGE: "show the message",
  };
  return (vi(locale) ? VI : EN)[action] ?? action;
}

const join = (locale: VoiceLocale, parts: string[]) =>
  parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")}${vi(locale) ? " và " : " and "}${parts.at(-1)}`;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface FinishedCommand {
  action: Action;
  value: number | null;
  status: CommandRecord["status"] | "lost";
}

/** One sentence (or two) about how the sent commands ended. */
export function reportText(locale: VoiceLocale, done: FinishedCommand[]): string {
  const ok = done.filter((c) => c.status === "executed");
  const bad = done.filter((c) => c.status !== "executed");
  const out: string[] = [];
  if (ok.length > 0) out.push(`${vi(locale) ? "Xong rồi" : "Done"}, ${join(locale, ok.map((c) => doneClause(locale, c.action, c.value)))}.`);
  for (const c of bad) {
    const cmd = what(locale, c.action);
    if (c.status === "rejected")
      out.push(vi(locale) ? `Thiết bị từ chối lệnh ${cmd}.` : `The device refused to ${cmd}.`);
    else if (c.status === "timeout" || c.status === "lost")
      out.push(
        vi(locale)
          ? `Thiết bị chưa xác nhận lệnh ${cmd}, bạn kiểm tra lại mạch giúp mình nhé.`
          : `The device hasn't confirmed it could ${cmd}. Please check the board.`,
      );
    else out.push(vi(locale) ? `Lệnh ${cmd} không chạy được.` : `I couldn't ${cmd}.`);
  }
  return capital(out.join(" "));
}

export const BUZZER_CONFIRMED = { "vi-VN": "Được, mình bật còi đây.", "en-US": "OK, sounding the alarm." } as const;
export const BUZZER_CANCELLED = { "vi-VN": "Được, mình không bật còi.", "en-US": "OK, I won't sound the alarm." } as const;

/** Spoken (and shown) when recognition fails; the screen keeps its own longer hint. */
export function speechErrorText(locale: VoiceLocale, error: SpeechError): string | null {
  switch (error) {
    case "no-speech":
      return vi(locale) ? "Mình chưa nghe rõ, bạn bấm mic và nói lại nhé." : "I didn't catch that. Tap the mic and say it again.";
    case "network":
      return vi(locale) ? "Nhận giọng nói cần mạng, bạn kiểm tra kết nối hoặc gõ chữ nhé." : "Speech recognition needs the internet. Check the connection or type instead.";
    case "permission":
      return null; // the screen shows the Settings button
    default:
      return vi(locale) ? "Micro đang gặp lỗi, bạn thử lại hoặc gõ chữ nhé." : "The microphone had a problem. Try again or type instead.";
  }
}

/** Lower case, no diacritics: "Ừ, bật đi" → "u bat di". */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const YES = /^(co|u|uh|um|ok|oke|okay|dong y|duoc|vang|da|chac|chac chan|bat di|bat|yes|yeah|yep|sure|do it|go ahead|turn it on)( (di|nhe|nha|lam di|bat di|please|do it))*$/;
const NO = /^(khong|thoi|dung|huy|khoi|no|nope|cancel|never mind|dont|don t)( (di|nhe|nha|bat|can|thanks))*$/;

/** Reads a short spoken answer to a yes/no question; null when it is something else. */
export function yesNo(text: string): "yes" | "no" | null {
  const s = fold(text);
  if (YES.test(s)) return "yes";
  if (NO.test(s)) return "no";
  return null;
}
