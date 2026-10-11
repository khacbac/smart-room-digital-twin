import { readFileSync } from "node:fs";
import type { AssistantLocale } from "@srdt/contracts";
import { normalise } from "../src/assistant/assistant.service";
import { AnthropicModel } from "../src/assistant/anthropic.model";
import { GeminiModel } from "../src/assistant/gemini.model";
import { AssistantPlan, DEFAULT_ASSISTANT_MODEL, type AssistantModel, type RoomContext } from "../src/assistant/model";
import { RulesModel } from "../src/assistant/rules.model";

// Runs the sentence table of mobile/specs/05-voice-assistant.md §6 through a real model and
// prints how many plans match (action set, and angle within 5°). Target: ≥ 90 %.
//
//   GEMINI_API_KEY=… pnpm --filter @srdt/server assistant-eval            (gemini, ASSISTANT_MODEL)
//   ASSISTANT_PROVIDER=anthropic ANTHROPIC_API_KEY=… pnpm --filter @srdt/server assistant-eval
//   ASSISTANT_PROVIDER=rules pnpm --filter @srdt/server assistant-eval    (offline keyword model)

interface Case {
  text: string;
  locale: AssistantLocale;
  room?: Partial<RoomContext>;
  intent: string;
  commands: { action: string; value: number | null }[];
  /** Also require this intent (off-topic and history cases, where no command shows the decision). */
  strict?: boolean;
  /** The first plan must (true) or must not (false) ask for history. */
  history?: boolean;
}

const BASE_ROOM: RoomContext = {
  deviceName: "Room 01",
  online: true,
  edgeState: "WARNING",
  mlState: "WARNING",
  aiControl: true,
  temperature: 31.2,
  humidity: 62,
  light: 280,
  airQuality: 240,
  presence: true,
  windowAngle: 0,
  buzzer: false,
  override: { window: false, buzzer: false, secondsLeft: null },
  dhtFault: false,
};

try {
  process.loadEnvFile();
} catch {
  // no .env: use the environment
}

const provider = process.env.ASSISTANT_PROVIDER ?? "gemini";
let model: AssistantModel;
if (provider === "rules") model = new RulesModel();
else if (provider === "anthropic" || provider === "gemini") {
  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
  const key = process.env[keyName];
  if (!key) {
    console.error(`${keyName} is not set (or use ASSISTANT_PROVIDER=rules)`);
    process.exit(1);
  }
  const name = process.env.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL[provider];
  model = provider === "anthropic" ? new AnthropicModel(key, name) : new GeminiModel(key, name);
} else {
  console.error(`unknown ASSISTANT_PROVIDER=${provider}`);
  process.exit(1);
}

const cases = readFileSync(new URL("./assistant-eval.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Case);

let ok = 0;
for (const c of cases) {
  const room = { ...BASE_ROOM, ...c.room };
  const started = Date.now();
  let verdict = "FAIL";
  let detail = "";
  try {
    const plan = AssistantPlan.parse(await model.plan({ text: c.text, locale: c.locale, history: [], room }, AbortSignal.timeout(15_000)));
    // compare after the same clean-up the service does (clamping, dropping no-ops)
    const got = normalise(plan.commands, room);
    const match =
      got.length === c.commands.length &&
      c.commands.every((want) => got.some((g) => g.action === want.action && (want.value === null || Math.abs((g.value ?? 0) - want.value) <= 5))) &&
      (!c.strict || plan.intent === c.intent) &&
      (c.history === undefined || (plan.historyDays != null) === c.history);
    if (match) {
      ok++;
      verdict = "ok  ";
    }
    detail = `${plan.intent}${plan.historyDays != null ? ` historyDays=${plan.historyDays}` : ""} ${JSON.stringify(got)} — ${plan.reply}`;
  } catch (err) {
    detail = String(err);
  }
  console.log(`${verdict} ${String(Date.now() - started).padStart(5)} ms  ${c.text}\n         ${detail}`);
}
const pct = Math.round((ok / cases.length) * 100);
console.log(`\n${model.name}: ${ok}/${cases.length} (${pct} %) ${pct >= 90 ? "≥ 90 % target met" : "below the 90 % target"}`);
process.exit(pct >= 90 ? 0 : 1);
