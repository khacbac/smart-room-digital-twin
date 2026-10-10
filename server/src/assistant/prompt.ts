import { AQ_LINES, HUMIDITY_LINES, TEMP_LINES } from "@srdt/twin-core";
import type { AssistantLocale } from "@srdt/contracts";
import type { RoomContext } from "./model";

// The system prompt and the room summary sent with every utterance
// (mobile/specs/05-voice-assistant.md §3.3).

const lines = (name: string, list: readonly { value: number; state: string }[], unit: string) =>
  `${name}: ${list.map((l) => `${l.state} from ${l.value}${unit}`).join(", ")}`;

export function systemPrompt(locale: AssistantLocale): string {
  const language = locale === "vi-VN" ? "Vietnamese" : "English";
  return [
    "You are the voice assistant of one smart room. You hear what the user says, work out what they want from their words and the room readings, decide, act, and answer out loud.",
    "You can only control:",
    "- the window: OPEN_WINDOW with value = opening angle 1-90 degrees, or CLOSE_WINDOW;",
    "- the alarm buzzer: BUZZER_ON, BUZZER_OFF;",
    "- CLEAR_OVERRIDE: give control back to the room's automatic rules (and its on-device AI).",
    "You can also read every sensor in ROOM. There are no lights, fans, air conditioner, heater, doors, music or other devices.",
    "",
    "Understand intent, not just keywords. Situations imply actions, for example:",
    "- \"hot / stuffy / it smells / I'm cooking / nóng / ngột ngạt / bí / có mùi / đang nấu ăn\" and the window is closed or barely open: open it (45, or 90 if air quality or temperature is bad);",
    "- \"cold / it's raining / windy / I'm going to sleep / I'm going out / lạnh / mưa / gió to / đi ngủ / ra ngoài\": close the window;",
    "- \"too loud / stop that noise / ồn quá / im đi\" while the alarm sounds: BUZZER_OFF;",
    "- \"back to normal / let the room decide / như cũ / tự động\": CLEAR_OVERRIDE.",
    "Only act when the words and the room data make the wish clear; say briefly why when you inferred it (\"It's 31 degrees, so I'm opening the window halfway.\").",
    "",
    "Never answer with just \"I can't\". When asked for something this room cannot do (lights, fan, AC, music, other devices, anything off-topic):",
    "intent \"unsupported\", no commands; say in one short sentence that the room has no such device, then offer the closest thing you CAN do for the same goal",
    "(AC or fan when hot: open the window; heater when cold: close the window; lights: tell the light level) as a yes/no question, and set expectsAnswer true.",
    "If the user then agrees (\"yes / ok / có / ừ / được\"), carry out what you offered in the previous turn.",
    "",
    "Angles from words: \"a bit / hé / một chút\" = 25; \"half / một nửa\" = 45; \"open / mở / mở hết / fully\" = 90;",
    "\"a bit more / thêm chút nữa\" = current angle + 20 (max 90); \"a bit less / khép bớt\" = current angle - 20 (0 or less means CLOSE_WINDOW).",
    "Manual commands last 2 minutes, then the room returns to automatic control; mention it briefly when you send one.",
    "Questions about the room: intent \"query\", answer from the ROOM data only, at most 2 short sentences, with units. If a reading suggests an action (hot and window closed), offer it and set expectsAnswer true.",
    "To explain a state, compare the readings with the thresholds below.",
    "Vague requests (\"do something\"): intent \"clarify\", ask one short question that offers concrete choices, expectsAnswer true.",
    "If the device is offline, send no command and say it is offline.",
    "Do not send a command that changes nothing (closing a closed window, silencing a silent alarm); say it is already that way.",
    "At most 2 commands. Never use PING.",
    `Write \"reply\" in ${language}, friendly, short (1-2 sentences): it is read aloud. No markdown, no emoji, write numbers with units as words would be read (\"45 độ\", \"31 degrees\").`,
    "Write the reply as if the command is being carried out now (\"Opening the window to 45 degrees.\"); the app announces when the device confirms.",
    "expectsAnswer: true only when the reply ends with a question to the user.",
    ...(locale === "vi-VN" ? ["In Vietnamese, call yourself \"mình\" and the user \"bạn\"."] : []),
    "",
    "Thresholds (device rules):",
    lines("Temperature", TEMP_LINES, " °C"),
    lines("Humidity", HUMIDITY_LINES, " %"),
    lines("Air quality", AQ_LINES, " AQ (0-1000 index)"),
  ].join("\n");
}

const val = (v: number | null, unit: string, digits = 1) => (v === null ? "unknown" : `${v.toFixed(digits)}${unit}`);

export function roomText(r: RoomContext): string {
  const override =
    r.override.window || r.override.buzzer
      ? `manual (${[r.override.window && "window", r.override.buzzer && "alarm"].filter(Boolean).join(" + ")}${
          r.override.secondsLeft !== null ? `, ${Math.round(r.override.secondsLeft)} s left` : ""
        })`
      : "automatic";
  return [
    `ROOM "${r.deviceName}"`,
    `device: ${r.online ? "online" : "OFFLINE"}`,
    `state: ${r.edgeState ?? "unknown"}${r.mlState ? ` (on-device AI says ${r.mlState}, ${r.aiControl ? "in control" : "advisory"})` : ""}`,
    `temperature: ${r.dhtFault ? "sensor fault" : val(r.temperature, " °C")}`,
    `humidity: ${r.dhtFault ? "sensor fault" : val(r.humidity, " %", 0)}`,
    `light: ${val(r.light, " lx", 0)}`,
    `air quality: ${val(r.airQuality, " AQ", 0)}`,
    `occupancy: ${r.presence === null ? "unknown" : r.presence ? "motion detected" : "no motion"}`,
    `window: ${r.windowAngle === null ? "unknown" : r.windowAngle === 0 ? "closed (0°)" : `open ${r.windowAngle}°`}`,
    `alarm: ${r.buzzer === null ? "unknown" : r.buzzer ? "sounding" : "off"}`,
    `control mode: ${override}`,
  ].join("\n");
}

/** Gemini `responseSchema` (OpenAPI subset) for AssistantPlan. */
export const PLAN_SCHEMA = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING", enum: ["command", "query", "clarify", "unsupported"] },
    commands: {
      type: "ARRAY",
      maxItems: 2,
      items: {
        type: "OBJECT",
        properties: {
          action: { type: "STRING", enum: ["OPEN_WINDOW", "CLOSE_WINDOW", "BUZZER_ON", "BUZZER_OFF", "CLEAR_OVERRIDE"] },
          value: { type: "INTEGER", nullable: true },
        },
        required: ["action", "value"],
      },
    },
    reply: { type: "STRING" },
    expectsAnswer: { type: "BOOLEAN" },
  },
  required: ["intent", "commands", "reply", "expectsAnswer"],
  propertyOrdering: ["intent", "commands", "reply", "expectsAnswer"],
} as const;

/** The same shape as a JSON Schema, for Claude's tool `input_schema`. */
export const PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["command", "query", "clarify", "unsupported"] },
    commands: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["OPEN_WINDOW", "CLOSE_WINDOW", "BUZZER_ON", "BUZZER_OFF", "CLEAR_OVERRIDE"] },
          value: { type: ["integer", "null"] },
        },
        required: ["action", "value"],
      },
    },
    reply: { type: "string" },
    expectsAnswer: { type: "boolean", description: "true when the reply ends with a question for the user" },
  },
  required: ["intent", "commands", "reply", "expectsAnswer"],
} as const;
