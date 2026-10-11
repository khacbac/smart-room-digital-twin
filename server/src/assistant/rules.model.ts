import { AQ_LINES, HUMIDITY_LINES, TEMP_LINES, levelFor } from "@srdt/twin-core";
import type { AssistantLocale, EdgeState } from "@srdt/contracts";
import type { RoomHistory } from "./history";
import type { AssistantModel, AssistantPlan, AssistantPlanInput, PlanInput, RoomContext } from "./model";

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
const IDENTIFY = /\b(nhay den|bao hieu|dinh vi|o dau|identify|blink|where are you|which (board|device))\b/;
const SCREEN = /\b(man hinh|screen|lcd|oled)\b/;
const SHOW = /\b(hien thi|hien|ghi|viet|show|display|write|put)\b/;
const PAST = /\b(hom qua|dem qua|tuan|thang|gan day|vua roi|vua qua|bat thuong|lich su|trung binh|yesterday|last (night|week|month)|this (week|month)|recently|history|unusual|anomal(y|ies)|average)\b/;
const OFF_TOPIC = /\b(thoi tiet|du bao|tin tuc|bong da|chung khoan|gia vang|ke chuyen|chuyen cuoi|bai hat|nau an the nao|cong thuc|dich|giai toan|lap trinh|weather|forecast|news|football|stocks?|joke|story|song|recipe|translate|math|coding|president|who won)\b/;
const ABOUT = /\b(lam duoc gi|lam duoc nhung gi|giup duoc gi|ban la ai|what can you do|who are you)\b/;

/** "Hiển thị Xin chào lên màn hình" → "Xin chào"; a quoted text wins. */
function messageFrom(text: string): string {
  const quoted = text.match(/["“'‘]([^"”'’]+)["”'’]/);
  if (quoted) return quoted[1]!.trim();
  return text
    .replace(/\s*(lên|len|ra|trên|tren|on|to|onto)?\s*(the\s+)?(màn hình|man hinh|screen|lcd|oled)\s*[.!?]*\s*$/iu, "")
    .replace(/^\s*(hãy|hay|please)?\s*(hiển thị|hien thi|hiện|hien|ghi|viết|viet|show|display|write|put)\s+(chữ|chu|dòng chữ|dong chu|câu|cau)?\s*(the\s+)?(text|message|words)?\s*/iu, "")
    .trim();
}

const YES = /^(co|u|uh|um|ok|oke|okay|dong y|duoc|vang|da|yes|yeah|yep|sure|please|go ahead|do it)( (di|nhe|nha|lam di|please))?$/;

const OFFER_VI = "Mình mở cửa sổ một nửa cho thoáng nhé?";
const OFFER_EN = "Shall I open the window halfway to let air in?";

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

function pastDays(s: string): number {
  if (has(s, /\b(hom qua|dem qua|yesterday|last night)\b/)) return 2;
  if (has(s, /\b(tuan|week)\b/)) return 7;
  return 30;
}

const RANK = { NORMAL: 0, UNCOMFORTABLE: 1, WARNING: 2, DANGER: 3 } as const;

function summarise(h: RoomHistory, locale: AssistantLocale): string {
  if (!h.overall) return t(locale, `Mình không có dữ liệu nào trong ${h.days} ngày qua.`, `I have no readings from the last ${h.days} days.`);
  const bad = h.rows.filter((r) => r.states.WARNING + r.states.DANGER > 0);
  const worst = (["DANGER", "WARNING", "UNCOMFORTABLE"] as const).find((s) => (h.overall?.states[s] ?? 0) > 0);
  const temp = h.overall.temperature;
  const tempText = temp ? t(locale, `nhiệt độ từ ${temp.min.toFixed(1)} đến ${temp.max.toFixed(1)} độ C`, `temperature ranged ${temp.min.toFixed(1)} to ${temp.max.toFixed(1)} °C`) : "";
  const faults = (h.eventCounts.SENSOR_FAULT ?? 0) + (h.eventCounts.DEVICE_OFFLINE ?? 0);
  if (!worst || RANK[worst] < RANK.WARNING) {
    return t(
      locale,
      `${h.days} ngày qua phòng không có gì bất thường, ${tempText}${faults ? `, có ${faults} lần lỗi cảm biến hoặc mất kết nối` : ""}.`,
      `Nothing unusual in the last ${h.days} days; ${tempText}${faults ? `, with ${faults} sensor faults or disconnects` : ""}.`,
    );
  }
  const labels = bad.slice(-3).map((r) => r.label);
  return t(
    locale,
    `${h.days} ngày qua có ${bad.length} lúc phòng ở mức ${worst === "DANGER" ? "nguy hiểm" : "cảnh báo"}, gần nhất: ${labels.join(", ")}. Cả kỳ ${tempText}.`,
    `In the last ${h.days} days the room reached ${worst} in ${bad.length} periods, latest: ${labels.join(", ")}. Overall ${tempText}.`,
  );
}

export class RulesModel implements AssistantModel {
  readonly name = "rules";

  async plan({ text, locale, room, history, past }: PlanInput): Promise<AssistantPlanInput> {
    const s = fold(text);
    const say = (vi: string, en: string) => t(locale, vi, en);

    // "yes" to the window offer made for an unsupported device (below)
    const last = history.at(-1);
    if (has(s, YES) && last?.role === "assistant" && last.text.includes(say(OFFER_VI, OFFER_EN)) && room.online)
      return {
        intent: "command",
        commands: [{ action: "OPEN_WINDOW", value: 45 }],
        reply: say("Mình đang mở cửa sổ 45 độ. Chế độ tay giữ 2 phút.", "Opening the window to 45 degrees. Manual mode lasts 2 minutes."),
      };

    if (has(s, PAST)) {
      if (past) return { intent: "query", commands: [], reply: summarise(past, locale) };
      return { intent: "query", commands: [], reply: say("Để mình xem lịch sử.", "Let me check the history."), historyDays: pastDays(s) };
    }
    if (has(s, ABOUT))
      return {
        intent: "query",
        commands: [],
        reply: say(
          "Mình là trợ lý của phòng: xem số đo và lịch sử 30 ngày, mở đóng cửa sổ, tắt bật còi và hiện chữ lên màn hình.",
          "I'm the room assistant: I read the sensors and the last 30 days, open or close the window, handle the alarm and write on the screen.",
        ),
      };
    if (has(s, OFF_TOPIC))
      return {
        intent: "unsupported",
        commands: [],
        reply: say(
          "Xin lỗi, câu này nằm ngoài phạm vi của mình. Mình chỉ giúp được về căn phòng: số đo, lịch sử 30 ngày, cửa sổ, còi và màn hình.",
          "Sorry, that's outside what I can help with. I can only help with this room: its readings, the last 30 days, the window, the alarm and the screen.",
        ),
      };

    if (has(s, SCREEN) && has(s, SHOW) && room.online) {
      const message = messageFrom(text);
      if (message)
        return {
          intent: "command",
          commands: [{ action: "SHOW_MESSAGE", value: null, text: message }],
          reply: say(`Mình đang hiển thị "${message}" lên màn hình.`, `Showing "${message}" on the screen.`),
        };
    }
    if (has(s, IDENTIFY) && room.online)
      return {
        intent: "command",
        commands: [{ action: "IDENTIFY", value: null }],
        reply: say("Mình đây, đang nháy đèn và kêu bíp.", "Here I am, blinking my lights and beeping."),
      };

    if (has(s, UNSUPPORTED) && !has(s, WINDOW) && !has(s, BUZZER))
      return {
        intent: "unsupported",
        commands: [],
        reply: say(
          `Phòng này chỉ có cửa sổ và còi báo động, chưa có thiết bị đó. ${OFFER_VI}`,
          `This room only has a window and an alarm, not that device. ${OFFER_EN}`,
        ),
        expectsAnswer: true,
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
        expectsAnswer: true,
      };
    return { intent: "clarify", commands: [], reply: say("Bạn nói lại được không?", "Could you say that again?"), expectsAnswer: true };
  }
}
