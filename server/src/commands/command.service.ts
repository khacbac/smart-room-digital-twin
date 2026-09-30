import type {
  CommandAck,
  CommandMessage,
  CommandRecord,
  CommandRequest,
  CommandStatus,
  DeviceRecord,
} from "@srdt/contracts";
import type { ServerEventSink } from "../events/event.service";
import type { Logger } from "../logger";
import { commandTopic } from "../mqtt/topics";
import type { Publisher } from "../realtime/hub";
import type { CommandStore } from "../storage/types";
import { RateLimiter } from "./rate-limit";

// §6.6 command round trip: record → publish (QoS 1) → sent → ack | timeout.
// Every status change is a conditional transition, and every change is pushed to the
// dashboards, which follow the command until it is final.

export interface CommandPublisher {
  /** `client.connected`. The mqtt.js offline queue is never used for commands (§6.6). */
  isConnected(): boolean;
  /** QoS 1, not retained. Resolves on PUBACK, rejects on a publish error. */
  publishCommand(topic: string, payload: string): Promise<void>;
}

export type CreateResult =
  | { kind: "accepted"; commandId: string; status: CommandStatus }
  | { kind: "rate_limited" }
  | { kind: "device_offline"; commandId: string }
  | { kind: "broker_disconnected"; commandId: string };

export interface CommandServiceOptions {
  prefix: string;
  ackTimeoutMs: number;
  /** How long `create` waits for the PUBACK before answering with `pending`. */
  respondWithinMs?: number;
}

const OPEN = ["pending", "sent"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CommandService {
  private sweeping = false;

  constructor(
    private readonly store: CommandStore,
    private readonly publisher: CommandPublisher,
    private readonly events: ServerEventSink,
    private readonly hub: Publisher,
    private readonly opts: CommandServiceOptions,
    private readonly log: Logger,
    private readonly limiter = new RateLimiter(),
    private readonly now: () => number = Date.now,
  ) {}

  async create(device: DeviceRecord, req: CommandRequest): Promise<CreateResult> {
    if (!this.limiter.allow(device.code, this.now())) return { kind: "rate_limited" };

    const value = req.action === "OPEN_WINDOW" ? (req.value ?? null) : null;
    const source = req.source ?? "api";
    const row = await this.store.insert({ deviceCode: device.code, action: req.action, value, source });
    this.pushed(row);
    const log = this.log.child({ device: device.code, commandId: row.id, action: row.action });

    // The record exists either way, so the dashboard sees why the command did not go out.
    // The broker check comes first: with the broker down the device looks online until
    // presence times it out, and the right answer then is 503.
    if (!this.publisher.isConnected()) {
      await this.fail(row.id, "BROKER_DISCONNECTED");
      log.warn("command failed: broker disconnected");
      return { kind: "broker_disconnected", commandId: row.id };
    }
    if (device.presence !== "online") {
      await this.fail(row.id, "DEVICE_OFFLINE");
      log.warn("command failed: device offline");
      return { kind: "device_offline", commandId: row.id };
    }

    const msg: CommandMessage = {
      v: 1,
      commandId: row.id,
      action: row.action,
      ...(value !== null && { value }),
      source,
      ts: this.now(),
    };
    const delivered = this.deliver(row.id, commandTopic(this.opts.prefix, device.code), JSON.stringify(msg), log);
    const waitMs = this.opts.respondWithinMs ?? 3000;
    let timer: NodeJS.Timeout | undefined;
    const status = await Promise.race([
      delivered,
      new Promise<CommandStatus>((resolve) => {
        timer = setTimeout(() => resolve("pending"), waitMs);
      }),
    ]);
    clearTimeout(timer);
    return { kind: "accepted", commandId: row.id, status };
  }

  /** §6.6: only a `pending`/`sent` command takes the ack; a late ack is logged and ignored. */
  async handleAck(device: DeviceRecord, ack: CommandAck): Promise<void> {
    const log = this.log.child({ device: device.code, commandId: ack.commandId });
    if (!UUID_RE.test(ack.commandId)) {
      log.info({ status: ack.status }, "ack for a commandId the backend did not send, ignored");
      return;
    }
    const current = await this.store.get(ack.commandId);
    if (!current || current.deviceCode !== device.code) {
      log.info({ status: ack.status }, "ack for an unknown command, ignored");
      return;
    }
    const row = await this.store.transition(ack.commandId, OPEN, {
      status: ack.status,
      reason: ack.reason,
      ack,
      ackedAt: new Date(this.now()).toISOString(),
    });
    if (row) {
      this.pushed(row);
      log.info({ status: ack.status, reason: ack.reason }, "command acked");
    } else {
      log.info({ status: ack.status }, "late ack, status unchanged");
    }
  }

  /** §9.4 rule 2, every 2 s: pending/sent older than COMMAND_ACK_TIMEOUT_SEC → timeout. */
  async sweepTimeouts(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const overdue = await this.store.listOpenBefore(new Date(this.now() - this.opts.ackTimeoutMs));
      for (const c of overdue) {
        const row = await this.store.transition(c.id, OPEN, { status: "timeout" });
        if (!row) continue; // acked in between
        this.pushed(row);
        this.log.warn({ commandId: c.id, action: c.action }, "command timed out");
        await this.events.server(c.deviceCode, "COMMAND_TIMEOUT", "warning", `${c.action} timed out`, {
          commandId: c.id,
          action: c.action,
        });
      }
    } finally {
      this.sweeping = false;
    }
  }

  recent(deviceCode: string, limit: number): Promise<CommandRecord[]> {
    return this.store.recent(deviceCode, limit);
  }

  /** Publishes and records the result; returns the status to report to the API caller. */
  private async deliver(id: string, topic: string, payload: string, log: Logger): Promise<CommandStatus> {
    try {
      try {
        await this.publisher.publishCommand(topic, payload);
      } catch (err) {
        log.warn({ err }, "command publish failed");
        await this.fail(id, "PUBLISH_ERROR");
        return (await this.store.get(id))?.status ?? "failed";
      }
      const sentAt = new Date(this.now()).toISOString();
      const sent = await this.store.transition(id, ["pending"], { status: "sent", sentAt });
      if (sent) {
        this.pushed(sent);
        log.info("command sent");
        return "sent";
      }
      // The ack was stored first: keep its status, only fill in sentAt (§6.6 race).
      const acked = await this.store.transition(id, ["executed", "rejected", "failed"], { sentAt });
      if (acked) this.pushed(acked);
      return acked?.status ?? (await this.store.get(id))?.status ?? "sent";
    } catch (err) {
      log.error({ err }, "command store error");
      return "pending"; // the timeout sweeper settles the command
    }
  }

  private async fail(id: string, reason: string): Promise<void> {
    const row = await this.store.transition(id, ["pending"], { status: "failed", reason });
    if (row) this.pushed(row);
  }

  private pushed(row: CommandRecord): void {
    this.hub.publish(row.deviceCode, { type: "command", data: row });
  }
}
