import {
  CommandAck,
  DeviceEvent,
  MAX_PAYLOAD_BYTES,
  Status,
  Telemetry,
  type CommandAck as CommandAckMsg,
  type DeviceRecord,
  type DeviceEvent as DeviceEventMsg,
  type Status as StatusMsg,
  type Telemetry as TelemetryMsg,
} from "@srdt/contracts";
import type { z } from "zod";
import type { DeviceService } from "../devices/device.service";
import { truncate, type Logger } from "../logger";
import { measuredAtMs } from "../telemetry/time";
import type { RecentMessages } from "./dedup";
import { parseTopic, type InboundKind } from "./topics";

// §9.3 ingestion pipeline (see docs/reference for the § numbers):
// topic → size → JSON → Zod → deviceId match → resolve device → dedup → presence → route

export interface IngestDeps {
  prefix: string;
  devices: DeviceService;
  dedup: RecentMessages;
  telemetry: {
    handle(deviceCode: string, msg: TelemetryMsg, measuredAt: Date, receivedAtMs: number): Promise<void>;
  };
  events: { device(deviceCode: string, event: DeviceEventMsg, measuredAt: Date): Promise<void> };
  commands: { handleAck(device: DeviceRecord, ack: CommandAckMsg): Promise<void> };
  log: Logger;
  now?: () => number;
}

type Inbound =
  | { kind: "telemetry"; msg: TelemetryMsg }
  | { kind: "status"; msg: StatusMsg }
  | { kind: "event"; msg: DeviceEventMsg }
  | { kind: "command/ack"; msg: CommandAckMsg };

const SCHEMAS: Record<InboundKind, z.ZodTypeAny> = {
  telemetry: Telemetry,
  status: Status,
  event: DeviceEvent,
  "command/ack": CommandAck,
};

function bootIdOf(inbound: Inbound): string | undefined {
  if (inbound.kind === "command/ack") return undefined;
  if (inbound.kind === "status") return inbound.msg.online ? inbound.msg.bootId : undefined;
  return inbound.msg.bootId;
}

export function createMessageHandler(deps: IngestDeps) {
  const { devices, log } = deps;
  const now = deps.now ?? Date.now;

  return async function handle(topic: string, payload: Buffer, retain: boolean): Promise<void> {
    const receivedAt = now();
    const parsedTopic = parseTopic(deps.prefix, topic);
    if (!parsedTopic) {
      log.debug({ topic }, "unknown topic dropped");
      return;
    }
    if (payload.length > MAX_PAYLOAD_BYTES) {
      log.warn({ topic, bytes: payload.length }, "payload too large, dropped");
      return;
    }
    const text = payload.toString("utf8");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      log.warn({ topic, payload: truncate(text) }, "invalid JSON, dropped");
      return;
    }
    const result = SCHEMAS[parsedTopic.kind].safeParse(json);
    if (!result.success) {
      log.warn({ topic, issues: result.error.issues, payload: truncate(text) }, "schema error, dropped");
      return;
    }
    const inbound = { kind: parsedTopic.kind, msg: result.data } as Inbound;
    if (inbound.msg.deviceId !== parsedTopic.deviceId) {
      log.warn({ topic, deviceId: inbound.msg.deviceId }, "payload deviceId does not match topic, dropped");
      return;
    }

    const device = await devices.resolve(parsedTopic.deviceId);
    if (!device) return;

    if (inbound.kind === "telemetry" || inbound.kind === "event") {
      if (!deps.dedup.firstSeen(device.code, inbound.msg.bootId, inbound.msg.seq)) {
        log.debug({ topic, bootId: inbound.msg.bootId, seq: inbound.msg.seq }, "duplicate dropped");
        return;
      }
    }

    // Presence: the LWT and retained messages never count as "seen" (§9.3).
    const isLwt = inbound.kind === "status" && !inbound.msg.online;
    if (!isLwt) {
      await devices.touch(device.code, {
        retain,
        bootId: bootIdOf(inbound),
        edgeState: inbound.kind === "telemetry" ? inbound.msg.edgeState : undefined,
      });
    }

    switch (inbound.kind) {
      case "telemetry": {
        const measuredAt = new Date(measuredAtMs(inbound.msg.ts, receivedAt));
        await deps.telemetry.handle(device.code, inbound.msg, measuredAt, receivedAt);
        return;
      }
      case "status":
        if (inbound.msg.online) await devices.saveStatus(device.code, inbound.msg, receivedAt, retain);
        else await devices.markOffline(device.code, "lwt");
        return;
      case "event": {
        const measuredAt = new Date(measuredAtMs(inbound.msg.ts, receivedAt));
        await deps.events.device(device.code, inbound.msg, measuredAt);
        return;
      }
      case "command/ack":
        await deps.commands.handleAck(device, inbound.msg);
        return;
    }
  };
}
