import {
  MESSAGE_MAX,
  toDisplayText,
  WINDOW_ANGLE_MAX,
  WINDOW_ANGLE_MIN,
  type AssistantCommandResult,
  type AssistantRequest,
  type AssistantResponse,
  type DeviceRecord,
  type TelemetryRecord,
} from "@srdt/contracts";
import type { CommandService } from "../commands/command.service";
import { RateLimiter } from "../commands/rate-limit";
import type { Logger } from "../logger";
import { buildHistory, HISTORY_MAX_DAYS, localTime, type PastData, type RoomHistory } from "./history";
import { AssistantPlan, type AssistantModel, type PlanInput, type RoomContext } from "./model";
import { reply } from "./replies";

// One utterance → one model call → checked commands through the normal CommandService
// (validation, rate limit, ack tracking, live push to every client), with source "ai".
// A question about the past takes two calls (rarely three): the model first asks for
// `historyDays`, the service loads that much history and asks again with it.

export type AssistantErrorCode = "ASSISTANT_DISABLED" | "ASSISTANT_TIMEOUT" | "ASSISTANT_UPSTREAM" | "RATE_LIMITED";

export class AssistantError extends Error {
  constructor(
    readonly code: AssistantErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface AssistantServiceOptions {
  timeoutMs: number;
  /** Utterances per minute per device; separate from the commands/min limit. */
  perMinute?: number;
  /** IANA zone the user lives in: "yesterday" and the history rows are in local time. */
  timeZone?: string;
  /** Hourly rollups, events and commands since a date; without it, history questions get a fixed reply. */
  loadPast?: (deviceCode: string, since: Date) => Promise<PastData>;
}

const DEFAULT_TIME_ZONE = "Asia/Ho_Chi_Minh";

const ERROR_CODE = {
  device_offline: "DEVICE_OFFLINE",
  broker_disconnected: "BROKER_DISCONNECTED",
  rate_limited: "RATE_LIMITED",
} as const;

export class AssistantService {
  private readonly limiter: RateLimiter;

  constructor(
    /** null when the assistant is off or not configured (no API key). */
    private readonly model: AssistantModel | null,
    private readonly commands: Pick<CommandService, "create">,
    private readonly latestTelemetry: (deviceCode: string) => Promise<TelemetryRecord | null>,
    private readonly opts: AssistantServiceOptions,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {
    this.limiter = new RateLimiter(opts.perMinute ?? 20);
  }

  get enabled(): boolean {
    return this.model !== null;
  }

  async ask(device: DeviceRecord, req: AssistantRequest): Promise<AssistantResponse> {
    if (!this.model) throw new AssistantError("ASSISTANT_DISABLED", "voice assistant is not configured on the server");
    if (!this.limiter.allow(device.code, this.now()))
      throw new AssistantError("RATE_LIMITED", "at most 20 assistant requests per minute per device");

    const timeZone = this.opts.timeZone ?? DEFAULT_TIME_ZONE;
    const room = toRoomContext(device, await this.latestTelemetry(device.code).catch(() => null), this.now(), timeZone);
    const started = this.now();
    const input: PlanInput = { text: req.text, locale: req.locale, history: req.history, room };
    let plan = await this.planWithRetry(input);
    const log = this.log.child({ device: device.code, model: this.model.name });

    // A plan that asks for history is only a request for data: its commands are not sent.
    // With the history in hand the model may still ask again ("last week" read as 14 days,
    // or simply a placeholder reply): one more round, with a longer history if it wants one.
    let past: RoomHistory | null = null;
    for (let round = 0; round < 2 && plan.historyDays != null; round++) {
      const days = Math.min(HISTORY_MAX_DAYS, Math.max(1, Math.ceil(plan.historyDays)));
      if (!past || days > past.days) {
        past = await this.past(device.code, days, timeZone);
        if (!past) {
          log.info({ text: req.text, historyDays: days }, "assistant answered without history");
          return { intent: "query", reply: reply(req.locale, "noHistory"), commands: [], pendingConfirmation: [], expectsAnswer: false };
        }
      }
      plan = await this.planWithRetry({ ...input, past });
    }

    const pendingConfirmation: AssistantResponse["pendingConfirmation"] = [];
    const results: AssistantCommandResult[] = [];
    let failure: "offline" | "rateLimited" | "broker" | null = null;

    const planned = normalise(plan.commands, room);
    for (const cmd of planned) {
      if (cmd.action === "BUZZER_ON") {
        // it makes a real sound in the room: the app asks, then sends it itself
        pendingConfirmation.push(cmd);
        continue;
      }
      const result = await this.commands.create(device, {
        action: cmd.action,
        value: cmd.action === "OPEN_WINDOW" ? cmd.value : null,
        text: cmd.text,
        source: "ai",
      });
      if (result.kind === "accepted") {
        results.push({ ...cmd, commandId: result.commandId, status: result.status, error: null });
      } else {
        results.push({
          ...cmd,
          commandId: "commandId" in result ? result.commandId : null,
          status: result.kind === "rate_limited" ? null : "failed",
          error: ERROR_CODE[result.kind],
        });
        failure ??= result.kind === "device_offline" ? "offline" : result.kind === "rate_limited" ? "rateLimited" : "broker";
      }
    }

    let text = plan.reply;
    let expectsAnswer = plan.expectsAnswer || plan.intent === "clarify" || pendingConfirmation.length > 0;
    if (failure) {
      text = reply(req.locale, failure);
      expectsAnswer = false;
    } else if (pendingConfirmation.length > 0 && results.length === 0) text = reply(req.locale, "confirmBuzzer");
    // the model said it would do something that the room already is: don't claim an action
    else if (plan.commands.length > 0 && planned.length === 0) text = reply(req.locale, "alreadyDone");

    log.info(
      { text: req.text, intent: plan.intent, actions: plan.commands.map((c) => c.action), historyDays: past?.days ?? null, ms: this.now() - started },
      "assistant answered",
    );
    return { intent: plan.intent, reply: text, commands: results, pendingConfirmation, expectsAnswer };
  }

  /** null when there is no history source or it failed. */
  private async past(deviceCode: string, days: number, timeZone: string) {
    if (!this.opts.loadPast) return null;
    const now = this.now();
    try {
      const data = await this.opts.loadPast(deviceCode, new Date(now - days * 24 * 3_600_000));
      return buildHistory(data, days, now, timeZone);
    } catch (err) {
      this.log.warn({ err, device: deviceCode, days }, "assistant history not loaded");
      return null;
    }
  }

  /** Model output that is not a valid plan gets one more try, then 502. */
  private async planWithRetry(input: Parameters<AssistantModel["plan"]>[0]): Promise<AssistantPlan> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.callWithTimeout(input);
      const parsed = AssistantPlan.safeParse(raw);
      if (parsed.success) return parsed.data;
      this.log.warn({ issues: parsed.error.issues.slice(0, 3), attempt }, "assistant plan failed validation");
    }
    throw new AssistantError("ASSISTANT_UPSTREAM", "the language model did not return a valid plan");
  }

  private async callWithTimeout(input: Parameters<AssistantModel["plan"]>[0]): Promise<unknown> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AssistantError("ASSISTANT_TIMEOUT", `no answer from the language model within ${this.opts.timeoutMs / 1000} s`));
      }, this.opts.timeoutMs);
    });
    try {
      return await Promise.race([this.model!.plan(input, controller.signal), timeout]);
    } catch (err) {
      if (err instanceof AssistantError) throw err;
      this.log.warn({ err }, "assistant model call failed");
      throw new AssistantError("ASSISTANT_UPSTREAM", "the language model request failed");
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Makes the model's commands safe to send: OPEN_WINDOW gets an integer angle in range
 * (90 when missing), SHOW_MESSAGE a display-safe text (dropped when empty), and commands
 * that would change nothing are dropped.
 */
export function normalise(commands: AssistantPlan["commands"], room: RoomContext) {
  const out: { action: AssistantPlan["commands"][number]["action"]; value: number | null; text?: string }[] = [];
  for (const c of commands) {
    if (c.action === "SHOW_MESSAGE") {
      const text = toDisplayText(c.text ?? "").slice(0, MESSAGE_MAX).trim();
      if (text && !out.some((o) => o.action === c.action)) out.push({ action: c.action, value: null, text });
      continue;
    }
    const value =
      c.action === "OPEN_WINDOW"
        ? Math.min(WINDOW_ANGLE_MAX, Math.max(WINDOW_ANGLE_MIN, Math.round(c.value ?? WINDOW_ANGLE_MAX)))
        : null;
    if (c.action === "CLOSE_WINDOW" && room.windowAngle === 0) continue;
    if (c.action === "OPEN_WINDOW" && room.windowAngle === value) continue;
    if (c.action === "BUZZER_OFF" && room.buzzer === false) continue;
    if (c.action === "BUZZER_ON" && room.buzzer === true) continue;
    if (c.action === "CLEAR_OVERRIDE" && !room.override.window && !room.override.buzzer) continue;
    if (out.some((o) => o.action === c.action)) continue;
    out.push({ action: c.action, value });
  }
  return out;
}

export function toRoomContext(
  device: DeviceRecord,
  live: TelemetryRecord | null,
  now: number,
  timeZone = DEFAULT_TIME_ZONE,
): RoomContext {
  const reported = device.reported;
  const expires = reported?.override.expiresAt ? Date.parse(reported.override.expiresAt) : null;
  return {
    deviceName: device.name,
    localTime: `${localTime(now, timeZone)} (${timeZone})`,
    online: device.presence === "online",
    edgeState: live?.edgeState ?? device.edgeState,
    mlState: live?.mlState ?? null,
    aiControl: live?.aiControl ?? false,
    temperature: live?.temperature ?? null,
    humidity: live?.humidity ?? null,
    light: live?.light ?? null,
    airQuality: live?.airQuality ?? null,
    presence: live?.presence ?? null,
    windowAngle: reported?.actuators.windowAngle ?? live?.windowAngle ?? null,
    buzzer: reported?.actuators.buzzer ?? live?.buzzer ?? null,
    override: {
      window: reported?.override.window ?? false,
      buzzer: reported?.override.buzzer ?? false,
      secondsLeft: expires !== null && !Number.isNaN(expires) ? Math.max(0, (expires - now) / 1000) : null,
    },
    dhtFault: reported?.sensorFault.dht ?? false,
  };
}
