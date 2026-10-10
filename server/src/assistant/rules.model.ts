import { AQ_LINES, HUMIDITY_LINES, TEMP_LINES, levelFor } from "@srdt/twin-core";
import type { AssistantLocale, EdgeState } from "@srdt/contracts";
import type { AssistantModel, AssistantPlan, PlanInput, RoomContext } from "./model";

// Keyword planner that needs no network or API key: for tests, offline demos and as the
// fallback when no LLM is configured. It understands the sentences of the spec's table
// (mobile/specs/05-voice-assistant.md §6) in Vietnamese and English, nothing clever.

/** Lower case, no Vietnamese diacritics, single spaces: "Mở hé cửa sổ" → "mo he cua so". */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}°\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const has = (t: string, re: RegExp) => re.test(t);

const UNSUPPORTED = /\b(dieu hoa|may lanh|quat|den|tivi|tv|air ?con(ditioner|ditioning)?|ac|fan|lamp|lights?|heater|curtains?|rem)\b/;
const AUTO = /\b(tu dong|automatic(ally)?|auto)\b/;
const BUZZER = /\b(coi|bao dong|chuong|alarm|buzzer|siren)\b/;
const WINDOW = /\b(cua so|cua|window)\b/;
const OFF = /\b(tat|im|ngung|dung|silence|stop|off|quiet|mute)\b/;
const ON = /\b(bat|keu|hu|on|sound|ring|start)\b/;
const CLOSE = /\b(dong|close|shut)\b/;
const OPEN = /\b(mo|open|raise)\b/;
const MORE = /\b(them|more|wider|further)\b/;
const LESS = /\b(khep bot|bot|less|narrower)\b/;
const HALF = /\b(mot nua|nua|half(way)?)\b/;
const BIT = /\b(he|mot chut|chut|a bit|slightly|a little|crack)\b/;
const HOT = /\b(nong|ngot ngat|bi|hot|stuffy|warm)\b/;
const QUERY = /\b(the nao|sao|bao nhieu|co ai|khong|nhu nao|how|what|why|is (there|anyone)|status|temperature|nhiet do|do am|humidity)\b/;
const VAGUE = /\b(lam gi do|gi do|something|anything)\b/;

const t = (locale: AssistantLocale, vi: string, en: string) => (locale === "vi-VN" ? vi : en);

function angleFrom(text: string, current: number | null): number | "close" | null {
  const deg = text.match(/(\d{1,3})\s*(do|°|degrees?|deg)?\b/);
  if (deg) return Number(deg[1]);
  const now = current ?? 0;
  if (has(text, LESS)) return now - 20 <= 0 ? "close" : now - 20;
  if (has(text, MORE)) return Math.min(90, now + 20);
  if (has(text, HALF)) return 45;
  if (has(text, BIT)) return 25;
  return null;
}

const STATE_VI: Record<EdgeState, string> = {
  NORMAL: "bình thường",
  UNCOMFORTABLE: "hơi khó chịu",
  WARNING: "cảnh báo",
  DANGER: "nguy hiểm",
};

function describe(room: RoomContext, locale: AssistantLocale): string {
  const temp = room.temperature === null ? null : room.temperature.toFixed(1);
  const hum = room.humidity === null ? null : room.humidity.toFixed(0);
  const aq = room.airQuality === null ? null : room.airQuality.toFixed(0);
  const state = room.edgeState;
  if (locale === "vi-VN")
    return `Phòng đang ${state ? STATE_VI[state] : "chưa rõ trạng thái"}: ${temp ?? "?"} độ C, độ ẩm ${hum ?? "?"} phần trăm, chất lượng không khí ${aq ?? "?"}. Cửa sổ ${
      room.windowAngle ? `mở ${room.windowAngle} độ` : "đang đóng"
    }, còi ${room.buzzer ? "đang kêu" : "tắt"}.`;
  return `The room is ${state ? state.toLowerCase() : "unknown"}: ${temp ?? "?"} °C, ${hum ?? "?"} % humidity, air quality ${aq ?? "?"}. The window is ${
    room.windowAngle ? `open ${room.windowAngle} degrees` : "closed"
  } and the alarm is ${room.buzzer ? "sounding" : "off"}.`;
}

function explain(room: RoomContext, locale: AssistantLocale): string {
  const reasons: string[] = [];
  const tl = levelFor(room.temperature, TEMP_LINES);
  const hl = levelFor(room.humidity, HUMIDITY_LINES);
  const al = levelFor(room.airQuality, AQ_LINES);
  if (tl) reasons.push(t(locale, `nhiệt độ ${room.temperature?.toFixed(1)} độ C`, `temperature is ${room.temperature?.toFixed(1)} °C`));
  if (hl) reasons.push(t(locale, `độ ẩm ${room.humidity?.toFixed(0)} phần trăm`, `humidity is ${room.humidity?.toFixed(0)} %`));
  if (al) reasons.push(t(locale, `chất lượng không khí ${room.airQuality?.toFixed(0)}`, `air quality is ${room.airQuality?.toFixed(0)}`));
  if (reasons.length === 0) return describe(room, locale);
  return t(locale, `Vì ${reasons.join(" và ")}, vượt ngưỡng cảnh báo.`, `Because ${reasons.join(" and ")}, above the alert thresholds.`);
}

export class RulesModel implements AssistantModel {
  readonly name = "rules";

  async plan({ text, locale, room }: PlanInput): Promise<AssistantPlan> {
    const s = fold(text);
    const say = (vi: string, en: string) => t(locale, vi, en);

    if (has(s, UNSUPPORTED) && !has(s, WINDOW) && !has(s, BUZZER))
      return {
        intent: "unsupported",
        commands: [],
        reply: say(
          "Phòng này chỉ có cửa sổ và còi báo động thôi, mình chưa điều khiển được thiết bị đó.",
          "This room only has a window and an alarm, so I can't control that.",
        ),
      };
    if (!room.online && (has(s, WINDOW) || has(s, BUZZER) || has(s, AUTO)))
      return { intent: "command", commands: [], reply: say("Thiết bị đang offline.", "The device is offline.") };

    if (has(s, AUTO) && !has(s, WINDOW) && !has(s, BUZZER))
      return {
        intent: "command",
        commands: [{ action: "CLEAR_OVERRIDE", value: null }],
        reply: say("Mình trả phòng về chế độ tự động.", "Handing the room back to automatic control."),
      };

    const commands: AssistantPlan["commands"] = [];
    const parts: string[] = [];
    // "đóng cửa và tắt còi": look at each clause on its own
    for (const clause of s.split(/\b(?:va|roi|and|then)\b/)) {
      if (has(clause, BUZZER)) {
        if (has(clause, OFF)) {
          commands.push({ action: "BUZZER_OFF", value: null });
          parts.push(say("tắt còi", "silencing the alarm"));
        } else if (has(clause, ON)) {
          commands.push({ action: "BUZZER_ON", value: null });
          parts.push(say("bật còi", "sounding the alarm"));
        }
      } else if (has(clause, WINDOW) || has(clause, MORE) || has(clause, LESS)) {
        const angle = angleFrom(clause, room.windowAngle);
        if (has(clause, CLOSE) && !has(clause, LESS)) {
          commands.push({ action: "CLOSE_WINDOW", value: null });
          parts.push(say("đóng cửa sổ", "closing the window"));
        } else if (angle === "close") {
          commands.push({ action: "CLOSE_WINDOW", value: null });
          parts.push(say("đóng cửa sổ", "closing the window"));
        } else if (has(clause, OPEN) || angle !== null) {
          const value = angle ?? 90;
          commands.push({ action: "OPEN_WINDOW", value });
          parts.push(say(`mở cửa sổ ${value} độ`, `opening the window to ${value} degrees`));
        }
      }
    }
    if (commands.length > 0) {
      const what = parts.join(say(" và ", " and "));
      return {
        intent: "command",
        commands: commands.slice(0, 2),
        reply: say(`Mình đang ${what}. Chế độ tay giữ 2 phút.`, `${what.charAt(0).toUpperCase()}${what.slice(1)}. Manual mode lasts 2 minutes.`),
      };
    }

    if (has(s, HOT) && !has(s, QUERY)) {
      if ((room.windowAngle ?? 0) < 90)
        return {
          intent: "command",
          commands: [{ action: "OPEN_WINDOW", value: 90 }],
          reply: say(
            `Phòng đang ${room.temperature?.toFixed(1) ?? "?"} độ C, mình mở hết cửa sổ cho thoáng nhé.`,
            `It's ${room.temperature?.toFixed(1) ?? "?"} °C in there. Opening the window fully.`,
          ),
        };
      return { intent: "query", commands: [], reply: describe(room, locale) };
    }

    if (has(s, /\b(co ai|ai trong|anyone|somebody|someone|occupied)\b/))
      return {
        intent: "query",
        commands: [],
        reply:
          room.presence === null
            ? say("Mình chưa có dữ liệu cảm biến chuyển động.", "I have no motion reading yet.")
            : room.presence
              ? say("Cảm biến đang thấy có người trong phòng.", "The motion sensor sees someone in the room.")
              : say("Hiện không thấy chuyển động trong phòng.", "No motion in the room right now."),
      };
    if (has(s, /\b(sao|tai sao|why)\b/)) return { intent: "query", commands: [], reply: explain(room, locale) };
    if (has(s, QUERY)) return { intent: "query", commands: [], reply: describe(room, locale) };
    if (has(s, VAGUE) || s.length > 0)
      return {
        intent: "clarify",
        commands: [],
        reply: say(
          "Bạn muốn mình mở hay đóng cửa sổ, tắt còi, hay xem tình trạng phòng?",
          "Would you like me to open or close the window, silence the alarm, or check the room?",
        ),
      };
    return { intent: "clarify", commands: [], reply: say("Bạn nói lại được không?", "Could you say that again?") };
  }
}
