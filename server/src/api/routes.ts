import cors from "@fastify/cors";
import Fastify, { type FastifyReply } from "fastify";
import { CommandRequest, DeviceId, type DeviceRecord, type TwinSnapshot } from "@srdt/contracts";
import { z } from "zod";
import type { CommandService } from "../commands/command.service";
import type { DeviceService } from "../devices/device.service";
import type { EventService } from "../events/event.service";
import type { Logger } from "../logger";
import { formatSse, type RealtimeHub } from "../realtime/hub";
import type { Storage } from "../storage";
import type { TelemetryService } from "../telemetry/telemetry.service";

// REST API + SSE stream. JSON only; errors are `{ error: { code, message } }`.
//
//   GET  /health
//   GET  /api/devices
//   GET  /api/devices/:code              → TwinSnapshot
//   GET  /api/devices/:code/stream       → text/event-stream of StreamMessage
//   POST /api/devices/:code/commands     → 202 { commandId, status } | 409 | 429 | 503
//   GET  /api/devices/:code/commands?limit=20

export interface ApiDeps {
  storage: Storage;
  devices: DeviceService;
  telemetry: TelemetryService;
  events: EventService;
  commands: CommandService;
  hub: RealtimeHub;
  mqttConnected: () => boolean;
  corsOrigins: string[];
  snapshotTelemetryMs: number;
  log: Logger;
}

const LIST_SIZE = 20;
const SNAPSHOT_TELEMETRY_MAX = 1000;

const CodeParams = z.object({ code: DeviceId });
const CommandsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(LIST_SIZE) });

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}

function zodMessage(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}

export async function buildApi(deps: ApiDeps) {
  const { devices, commands, log } = deps;
  const app = Fastify({ loggerInstance: log });
  await app.register(cors, { origin: deps.corsOrigins, methods: ["GET", "POST"] });

  app.setNotFoundHandler((req, reply) => sendError(reply, 404, "NOT_FOUND", `${req.method} ${req.url} not found`));
  app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, "request failed");
    return sendError(
      reply,
      status,
      status === 500 ? "INTERNAL" : "BAD_REQUEST",
      status === 500 ? "internal error" : err.message,
    );
  });

  /** Parses `:code` and finds the device, or answers 400/404. */
  async function deviceFor(params: unknown, reply: FastifyReply): Promise<DeviceRecord | null> {
    const parsed = CodeParams.safeParse(params);
    if (!parsed.success) {
      await sendError(reply, 400, "INVALID_DEVICE_CODE", zodMessage(parsed.error));
      return null;
    }
    const device = devices.get(parsed.data.code);
    if (!device) {
      await sendError(reply, 404, "DEVICE_NOT_FOUND", `device ${parsed.data.code} not found`);
      return null;
    }
    return device;
  }

  async function snapshot(device: DeviceRecord): Promise<TwinSnapshot> {
    const since = new Date(Date.now() - deps.snapshotTelemetryMs);
    const [telemetry, events, recentCommands] = await Promise.all([
      deps.telemetry.recent(device.code, since, SNAPSHOT_TELEMETRY_MAX),
      deps.events.recent(device.code, LIST_SIZE),
      commands.recent(device.code, LIST_SIZE),
    ]);
    return { device, telemetry, events, commands: recentCommands };
  }

  app.get("/health", async () => ({
    mqtt: deps.mqttConnected() ? "connected" : "disconnected",
    storage: { driver: deps.storage.driver, ok: await deps.storage.ping().catch(() => false) },
    streamClients: deps.hub.count(),
  }));

  app.get("/api/devices", async () => devices.list());

  app.get("/api/devices/:code", async (req, reply) => {
    const device = await deviceFor(req.params, reply);
    if (!device) return reply;
    return snapshot(device);
  });

  // SSE. The first frame is a full snapshot, so a reconnecting EventSource never misses
  // what happened while it was away.
  app.get("/api/devices/:code/stream", async (req, reply) => {
    const device = await deviceFor(req.params, reply);
    if (!device) return reply;
    const first = await snapshot(device);

    reply.hijack(); // headers set by plugins (CORS) are not sent after this, so set them here
    const origin = req.headers.origin;
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      ...(origin && deps.corsOrigins.includes(origin) && { "access-control-allow-origin": origin, vary: "Origin" }),
    });
    reply.raw.write("retry: 2000\n\n");
    reply.raw.write(formatSse({ type: "snapshot", data: first }));
    deps.hub.add(device.code, reply.raw);
  });

  app.post("/api/devices/:code/commands", async (req, reply) => {
    const device = await deviceFor(req.params, reply);
    if (!device) return reply;
    const body = CommandRequest.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "INVALID_COMMAND", zodMessage(body.error));

    const result = await commands.create(device, body.data);
    switch (result.kind) {
      case "accepted":
        return reply.status(202).send({ commandId: result.commandId, status: result.status });
      case "rate_limited":
        return sendError(reply, 429, "RATE_LIMITED", "at most 10 commands per minute per device");
      case "device_offline":
        return sendError(reply, 409, "DEVICE_OFFLINE", `device ${device.code} is offline (command ${result.commandId})`);
      case "broker_disconnected":
        return sendError(
          reply,
          503,
          "BROKER_DISCONNECTED",
          `backend is not connected to the MQTT broker (command ${result.commandId})`,
        );
    }
  });

  app.get("/api/devices/:code/commands", async (req, reply) => {
    const device = await deviceFor(req.params, reply);
    if (!device) return reply;
    const query = CommandsQuery.safeParse(req.query);
    if (!query.success) return sendError(reply, 400, "INVALID_QUERY", zodMessage(query.error));
    return commands.recent(device.code, query.data.limit);
  });

  return app;
}
