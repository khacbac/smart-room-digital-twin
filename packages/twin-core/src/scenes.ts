import type { CommandAction } from "@srdt/contracts";

// One-tap scenes shared by every client: a few ordinary commands sent one after the
// other. Each step is a normal command (rate limit, ack, history); the device knows
// nothing about scenes.

export interface SceneStep {
  action: CommandAction;
  value?: number;
  text?: string;
}

export type SceneId = "welcome" | "ventilate" | "sleep" | "auto";

export interface Scene {
  id: SceneId;
  label: string;
  description: string;
  steps: readonly SceneStep[];
}

export const SCENES: readonly Scene[] = [
  {
    id: "welcome",
    label: "Welcome",
    description: "Blink the board and greet the room",
    steps: [{ action: "IDENTIFY" }, { action: "SHOW_MESSAGE", text: "Welcome!" }],
  },
  {
    id: "ventilate",
    label: "Ventilate",
    description: "Open the window fully",
    steps: [{ action: "OPEN_WINDOW", value: 90 }, { action: "SHOW_MESSAGE", text: "Airing the room" }],
  },
  {
    id: "sleep",
    label: "Good night",
    description: "Close the window",
    steps: [{ action: "CLOSE_WINDOW" }, { action: "SHOW_MESSAGE", text: "Good night" }],
  },
  {
    id: "auto",
    label: "Automatic",
    description: "Hand control back to the room",
    steps: [{ action: "CLEAR_OVERRIDE" }, { action: "SHOW_MESSAGE", text: "Auto mode" }],
  },
];
