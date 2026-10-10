import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceRecord, StreamMessage, TelemetryRecord } from "@srdt/contracts";
import { pino } from "pino";
import { AssistantError, AssistantService, normalise, toRoomContext } from "../src/assistant/assistant.service";
import { AnthropicModel } from "../src/assistant/anthropic.model";
import { GeminiModel } from "../src/assistant/gemini.model";
import type { AssistantModel, PlanInput } from "../src/assistant/model";
import { RulesModel, fold } from "../src/assistant/rules.model";
import { buildApi } from "../src/api/routes";
import { CommandService, type CommandPublisher } from "../src/commands/command.service";
import type { Publisher } from "../src/realtime/hub";
import { createMemoryStorage } from "../src/storage/memory/memory.storage";

// The assistant turns an utterance into checked commands (mobile/specs/05-voice-assistant.md).

const log = pino({ level: "silent" });
const NOW = Date.parse("2026-10-10T08:00:00.000Z");

function device(over: Partial<DeviceRecord> = {}, actuators = { windowAngle: 0, buzzer: false }): DeviceRecord {
  return {
    code: "room-01",
    name: "Room 01",
    presence: "online",
    edgeState: "NORMAL",
    fwVersion: "1.0.0",
    bootId: "a1b2c3d4",
    reported: {
      v: 1,
      deviceId: "room-01",
      online: true,
      bootId: "a1b2c3d4",
      ts: NOW,
      fw: "1.0.0",
      uptimeSec: 60,
      rssi: -60,
      edgeState: "NORMAL",
      actuators,
      override: { window: false, buzzer: false, expiresInSec: 0, expiresAt: null },
      sensorFault: { dht: false },
    },
    lastSeenAt: new Date(NOW).toISOString(),
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...over,
  };
}

const telemetry: TelemetryRecord = {
  id: "t-1",
  deviceCode: "room-01",
  bootId: "a1b2c3d4",
  seq: 1,
  measuredAt: new Date(NOW).toISOString(),
  receivedAt: new Date(NOW).toISOString(),
  temperature: 31.2,
  humidity: 60,
  light: 300,
  airQuality: 200,
  presence: true,
  edgeState: "WARNING",
  windowAngle: 0,
  buzzer: false,
  overrideActive: false,
  mlState: null,
  aiControl: false,
};

class Hub implements Publisher {
  readonly sent: StreamMessage[] = [];
  publish(_device: string, msg: StreamMessage) {
    this.sent.push(structuredClone(msg));
  }
}

class Mqtt implements CommandPublisher {
  connected = true;
  readonly published: Record<string, unknown>[] = [];
  isConnected() {
    return this.connected;
  }
  async publishCommand(_topic: string, payload: string) {
    this.published.push(JSON.parse(payload));
  }
}

/** A model that returns fixed answers, one per call. */
class ScriptedModel implements AssistantModel {
  readonly name = "scripted";
  calls = 0;
  constructor(private readonly answers: (unknown | (() => Promise<unknown>))[]) {}
  async plan(_input: PlanInput, _signal: AbortSignal) {
    const a = this.answers[Math.min(this.calls++, this.answers.length - 1)];
    return typeof a === "function" ? (a as () => Promise<unknown>)() : a;
  }
}

function setup(model: AssistantModel | null, opts: { perMinute?: number; timeoutMs?: number } = {}) {
  const storage = createMemoryStorage(undefined, () => NOW);
  const hub = new Hub();
  const mqtt = new Mqtt();
  const events = { server: async () => undefined } as never;
  const commands = new CommandService(storage.commands, mqtt, events, hub, { prefix: "srdt", ackTimeoutMs: 10_000, respondWithinMs: 20 }, log);
  const assistant = new AssistantService(model, commands, async () => telemetry, { timeoutMs: opts.timeoutMs ?? 1000, perMinute: opts.perMinute }, log, () => NOW);
  return { assistant, hub, mqtt, commands };
}

const ask = (text: string, locale: "vi-VN" | "en-US" = "vi-VN") => ({ text, locale, history: [] });

afterEach(() => {
  vi.useRealTimers();
});

describe("AssistantService", () => {
  it("sends the planned command with source ai and pushes it to the hub", async () => {
    const { assistant, hub, mqtt } = setup(new ScriptedModel([{ intent: "command", commands: [{ action: "OPEN_WINDOW", value: 45 }], reply: "Mở 45 độ." }]));
    const res = await assistant.ask(device(), ask("mở cửa sổ một nửa"));
    expect(res.intent).toBe("command");
    expect(res.commands).toHaveLength(1);
    expect(res.commands[0]).toMatchObject({ action: "OPEN_WINDOW", value: 45, status: "sent", error: null });
    expect(mqtt.published[0]).toMatchObject({ action: "OPEN_WINDOW", value: 45, source: "ai" });
    const pushed = hub.sent.filter((m) => m.type === "command");
    expect(pushed.at(-1)).toMatchObject({ data: { source: "ai", action: "OPEN_WINDOW" } });
  });

  it("clamps the angle and fills a missing one with 90", () => {
    const room = toRoomContext(device(), telemetry, NOW);
    expect(normalise([{ action: "OPEN_WINDOW", value: 120 }], room)).toEqual([{ action: "OPEN_WINDOW", value: 90 }]);
    expect(normalise([{ action: "OPEN_WINDOW", value: null }], room)).toEqual([{ action: "OPEN_WINDOW", value: 90 }]);
    expect(normalise([{ action: "OPEN_WINDOW", value: 0.4 }], room)).toEqual([{ action: "OPEN_WINDOW", value: 1 }]);
  });

  it("drops commands that change nothing", () => {
    const room = toRoomContext(device(), telemetry, NOW);
    expect(normalise([{ action: "CLOSE_WINDOW", value: null }, { action: "BUZZER_OFF", value: null }, { action: "CLEAR_OVERRIDE", value: null }], room)).toEqual([]);
  });

  it("never sends BUZZER_ON; it waits for the user's confirmation", async () => {
    const { assistant, mqtt } = setup(new ScriptedModel([{ intent: "command", commands: [{ action: "BUZZER_ON", value: null }], reply: "Bật còi." }]));
    const res = await assistant.ask(device(), ask("bật còi báo động"));
    expect(res.commands).toEqual([]);
    expect(res.pendingConfirmation).toEqual([{ action: "BUZZER_ON", value: null }]);
    expect(res.reply).toMatch(/chắc muốn bật còi/);
    expect(mqtt.published).toHaveLength(0);
  });

  it("asks for an answer after a question, a confirmation or an offer", async () => {
    const clarify = setup(new ScriptedModel([{ intent: "clarify", commands: [], reply: "Mở hay đóng?" }]));
    expect((await clarify.assistant.ask(device(), ask("làm gì đó đi"))).expectsAnswer).toBe(true);
    const offer = setup(new ScriptedModel([{ intent: "unsupported", commands: [], reply: "Không có quạt. Mở cửa sổ nhé?", expectsAnswer: true }]));
    expect((await offer.assistant.ask(device(), ask("bật quạt"))).expectsAnswer).toBe(true);
    const buzzer = setup(new ScriptedModel([{ intent: "command", commands: [{ action: "BUZZER_ON", value: null }], reply: "Bật còi." }]));
    expect((await buzzer.assistant.ask(device(), ask("bật còi"))).expectsAnswer).toBe(true);
    const done = setup(new ScriptedModel([{ intent: "command", commands: [{ action: "OPEN_WINDOW", value: 45 }], reply: "Mở 45 độ." }]));
    expect((await done.assistant.ask(device(), ask("mở một nửa"))).expectsAnswer).toBe(false);
  });

  it("does not claim an action when every command was a no-op", async () => {
    const { assistant, mqtt } = setup(new ScriptedModel([{ intent: "command", commands: [{ action: "CLOSE_WINDOW", value: null }], reply: "Đang đóng cửa sổ." }]));
    const res = await assistant.ask(device(), ask("đóng cửa sổ"));
    expect(res.commands).toEqual([]);
    expect(res.reply).toMatch(/đúng như vậy rồi/);
    expect(mqtt.published).toHaveLength(0);
  });

  it("reports an offline device without sending anything to MQTT", async () => {
    const { assistant, mqtt } = setup(new ScriptedModel([{ intent: "command", commands: [{ action: "OPEN_WINDOW", value: 90 }], reply: "Mở." }]));
    const res = await assistant.ask(device({ presence: "offline" }), ask("mở cửa sổ"));
    expect(res.commands[0]).toMatchObject({ error: "DEVICE_OFFLINE", status: "failed" });
    expect(res.reply).toMatch(/offline/);
    expect(mqtt.published).toHaveLength(0);
  });

  it("retries an invalid plan once, then gives up with ASSISTANT_UPSTREAM", async () => {
    const model = new ScriptedModel([{ nope: true }, "not json"]);
    const { assistant } = setup(model);
    await expect(assistant.ask(device(), ask("xin chào"))).rejects.toMatchObject({ code: "ASSISTANT_UPSTREAM" });
    expect(model.calls).toBe(2);

    const recovering = new ScriptedModel([{ nope: true }, { intent: "query", commands: [], reply: "Ổn." }]);
    const res = await setup(recovering).assistant.ask(device(), ask("phòng thế nào"));
    expect(res.reply).toBe("Ổn.");
  });

  it("times out a hanging model with ASSISTANT_TIMEOUT", async () => {
    vi.useFakeTimers();
    const { assistant } = setup(new ScriptedModel([() => new Promise(() => undefined)]), { timeoutMs: 10_000 });
    const pending = assistant.ask(device(), ask("mở cửa"));
    const check = expect(pending).rejects.toMatchObject({ code: "ASSISTANT_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(10_001);
    await check;
  });

  it("limits utterances per device", async () => {
    const { assistant } = setup(new ScriptedModel([{ intent: "query", commands: [], reply: "Ổn." }]), { perMinute: 2 });
    await assistant.ask(device(), ask("a"));
    await assistant.ask(device(), ask("b"));
    await expect(assistant.ask(device(), ask("c"))).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("is disabled without a model", async () => {
    const { assistant } = setup(null);
    await expect(assistant.ask(device(), ask("a"))).rejects.toBeInstanceOf(AssistantError);
  });
});

describe("POST /api/devices/:code/assistant", () => {
  async function api(model: AssistantModel | null) {
    const { assistant, commands, hub } = setup(model);
    const storage = createMemoryStorage(undefined, () => NOW);
    const dev = device();
    const app = await buildApi({
      storage,
      devices: { get: (code: string) => (code === dev.code ? dev : null), list: () => [dev] } as never,
      telemetry: { recent: async () => [] } as never,
      events: { recent: async () => [] } as never,
      commands,
      assistant,
      hub: hub as never,
      mqttConnected: () => true,
      corsOrigins: [],
      snapshotTelemetryMs: 60_000,
      log,
    });
    return app;
  }

  it("answers 200 with the response, 400 on a bad body, 503 when disabled", async () => {
    const ok = await api(new ScriptedModel([{ intent: "query", commands: [], reply: "Ổn." }]));
    const r1 = await ok.inject({ method: "POST", url: "/api/devices/room-01/assistant", payload: ask("phòng thế nào") });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ intent: "query", reply: "Ổn.", commands: [], pendingConfirmation: [] });
    const r2 = await ok.inject({ method: "POST", url: "/api/devices/room-01/assistant", payload: { text: "", locale: "vi-VN" } });
    expect(r2.statusCode).toBe(400);
    const r3 = await ok.inject({ method: "POST", url: "/api/devices/nope-99/assistant", payload: ask("a") });
    expect(r3.statusCode).toBe(404);

    const off = await api(null);
    const r4 = await off.inject({ method: "POST", url: "/api/devices/room-01/assistant", payload: ask("a") });
    expect(r4.statusCode).toBe(503);
    expect(r4.json()).toMatchObject({ error: { code: "ASSISTANT_DISABLED" } });
  });
});

describe("RulesModel", () => {
  const rules = new RulesModel();
  const room = (over: Partial<ReturnType<typeof toRoomContext>> = {}) => ({ ...toRoomContext(device(), telemetry, NOW), ...over });
  const plan = (text: string, r = room(), locale: "vi-VN" | "en-US" = "vi-VN") => rules.plan({ text, locale, history: [], room: r });

  it("folds Vietnamese text", () => {
    expect(fold("Mở hé cửa sổ ra!")).toBe("mo he cua so ra");
    expect(fold("Đóng cửa")).toBe("dong cua");
  });

  it.each([
    ["Mở cửa sổ", [{ action: "OPEN_WINDOW", value: 90 }]],
    ["Mở hé cửa sổ ra", [{ action: "OPEN_WINDOW", value: 25 }]],
    ["Mở cửa sổ một nửa", [{ action: "OPEN_WINDOW", value: 45 }]],
    ["Open the window halfway", [{ action: "OPEN_WINDOW", value: 45 }]],
    ["Mở cửa sổ 60 độ", [{ action: "OPEN_WINDOW", value: 60 }]],
    ["Đóng cửa sổ lại", [{ action: "CLOSE_WINDOW", value: null }]],
    ["Close the window", [{ action: "CLOSE_WINDOW", value: null }]],
    ["Tắt còi đi", [{ action: "BUZZER_OFF", value: null }]],
    ["Silence the alarm", [{ action: "BUZZER_OFF", value: null }]],
    ["Bật còi báo động", [{ action: "BUZZER_ON", value: null }]],
    ["Cho nó tự động lại", [{ action: "CLEAR_OVERRIDE", value: null }]],
    ["Back to automatic", [{ action: "CLEAR_OVERRIDE", value: null }]],
    ["Đóng cửa và tắt còi", [{ action: "CLOSE_WINDOW", value: null }, { action: "BUZZER_OFF", value: null }]],
  ])("%s", async (text, commands) => {
    const p = await plan(text);
    expect(p.intent).toBe("command");
    expect(p.commands).toEqual(commands);
  });

  it("opens a bit more from the current angle", async () => {
    expect((await plan("Mở thêm chút nữa", room({ windowAngle: 45 }))).commands).toEqual([{ action: "OPEN_WINDOW", value: 65 }]);
    expect((await plan("Khép bớt cửa", room({ windowAngle: 15 }))).commands).toEqual([{ action: "CLOSE_WINDOW", value: null }]);
  });

  it("answers questions, refuses other devices and asks back when vague", async () => {
    expect((await plan("Phòng đang thế nào?")).intent).toBe("query");
    expect((await plan("Sao lại báo Warning?")).reply).toMatch(/nhiệt độ 31.2/);
    expect((await plan("Trong phòng có ai không?")).reply).toMatch(/có người/);
    expect((await plan("Bật điều hoà")).intent).toBe("unsupported");
    expect((await plan("Làm gì đó đi")).intent).toBe("clarify");
    expect((await plan("Nóng quá")).commands).toEqual([{ action: "OPEN_WINDOW", value: 90 }]);
  });

  it("offers the window for a missing device and acts on yes", async () => {
    const offer = await plan("Bật quạt lên");
    expect(offer).toMatchObject({ intent: "unsupported", commands: [], expectsAnswer: true });
    const yes = await rules.plan({ text: "Ừ", locale: "vi-VN", history: [{ role: "user", text: "Bật quạt lên" }, { role: "assistant", text: offer.reply }], room: room() });
    expect(yes.commands).toEqual([{ action: "OPEN_WINDOW", value: 45 }]);
  });
});

describe("GeminiModel", () => {
  it("asks for structured JSON and parses the answer", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.generationConfig.responseMimeType).toBe("application/json");
      expect(body.contents.at(-1).parts[0].text).toContain("USER SAID: mở cửa");
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"intent":"command","commands":[],"reply":"ok"}' }] } }] }),
      );
    });
    const model = new GeminiModel("key", "gemini-3-flash-preview", fetchFn as unknown as typeof fetch);
    const out = await model.plan({ text: "mở cửa", locale: "vi-VN", history: [], room: toRoomContext(device(), telemetry, NOW) }, new AbortController().signal);
    expect(out).toEqual({ intent: "command", commands: [], reply: "ok" });
    expect(fetchFn.mock.calls[0]?.[0]).toContain("gemini-3-flash-preview:generateContent");
  });

  it("throws on an HTTP error", async () => {
    const fetchFn = async () => new Response("quota", { status: 429 });
    const model = new GeminiModel("key", "m", fetchFn as unknown as typeof fetch);
    await expect(
      model.plan({ text: "a", locale: "en-US", history: [], room: toRoomContext(device(), telemetry, NOW) }, new AbortController().signal),
    ).rejects.toThrow(/429/);
  });
});

describe("AnthropicModel", () => {
  it("forces the plan tool and returns its input", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.tool_choice).toEqual({ type: "tool", name: "room_plan" });
      expect(body.messages.at(-1).content).toContain("USER SAID: mở cửa");
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key");
      return new Response(
        JSON.stringify({
          content: [{ type: "tool_use", id: "t1", name: "room_plan", input: { intent: "command", commands: [], reply: "ok" } }],
        }),
      );
    });
    const model = new AnthropicModel("key", "claude-haiku-5-5", fetchFn as unknown as typeof fetch);
    const out = await model.plan({ text: "mở cửa", locale: "vi-VN", history: [], room: toRoomContext(device(), telemetry, NOW) }, new AbortController().signal);
    expect(out).toEqual({ intent: "command", commands: [], reply: "ok" });
  });

  it("throws on an HTTP error", async () => {
    const fetchFn = async () => new Response("overloaded", { status: 529 });
    const model = new AnthropicModel("key", "m", fetchFn as unknown as typeof fetch);
    await expect(
      model.plan({ text: "a", locale: "en-US", history: [], room: toRoomContext(device(), telemetry, NOW) }, new AbortController().signal),
    ).rejects.toThrow(/529/);
  });
});
