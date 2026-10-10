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
    "You are the voice assistant of one smart room. You can only control:",
    "- the window: OPEN_WINDOW with value = opening angle 1-90 degrees, or CLOSE_WINDOW;",
    "- the alarm buzzer: BUZZER_ON, BUZZER_OFF;",
    "- CLEAR_OVERRIDE: give control back to the room's automatic rules (and its on-device AI).",
    "There are no lights, fans, air conditioner or other devices. If asked for one, use intent \"unsupported\" and say what you can do instead.",
    "",
    "Angles from words: \"a bit / hé / một chút\" = 25; \"half / một nửa\" = 45; \"open / mở / mở hết / fully\" = 90;",
    "\"a bit more / thêm chút nữa\" = current angle + 20 (max 90); \"a bit less / khép bớt\" = current angle - 20 (0 or less means CLOSE_WINDOW).",
    "Manual commands last 2 minutes, then the room returns to automatic control; mention it briefly when you send one.",
    "Questions about the room: intent \"query\", answer from the ROOM data only, at most 2 short sentences, with units.",
    "To explain a state, compare the readings with the thresholds below.",
    "Vague requests (\"do something\"): intent \"clarify\" and ask one short question.",
    "If the room says hot or stuffy and the window is closed, opening it is a reasonable command.",
    "If the device is offline, send no command and say it is offline.",
    "Do not send a command that changes nothing (closing a closed window, silencing a silent alarm); just say so.",
    "At most 2 commands. Never use PING.",
    `Write \"reply\" in ${language}, friendly and short: it is read aloud. No markdown, no emoji.`,
    "Write the reply as if the command is being carried out now (\"Opening the window to 45 degrees.\"), because the device confirms later.",
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
  },
  required: ["intent", "commands", "reply"],
  propertyOrdering: ["intent", "commands", "reply"],
} as const;
