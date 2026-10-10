import { buildApi } from "./api/routes";
import { AnthropicModel } from "./assistant/anthropic.model";
import { AssistantService } from "./assistant/assistant.service";
import { GeminiModel } from "./assistant/gemini.model";
import { DEFAULT_ASSISTANT_MODEL, type AssistantModel } from "./assistant/model";
import { RulesModel } from "./assistant/rules.model";
import { CommandService } from "./commands/command.service";
import { loadConfig } from "./config/env";
import { DeviceService } from "./devices/device.service";
import { EventService } from "./events/event.service";
import { createLogger } from "./logger";
import { MqttLink } from "./mqtt/client";
import { RecentMessages } from "./mqtt/dedup";
import { createMessageHandler } from "./mqtt/handlers";
import { RealtimeHub } from "./realtime/hub";
import { startServerRules } from "./rules/server-rules";
import { createStorage } from "./storage";
import { Downsampler, TelemetryService } from "./telemetry/telemetry.service";

// Wiring: MQTT → ingestion → services → storage + SSE hub → dashboard;
//         dashboard → REST → CommandService → MQTT → device → ack → dashboard.

const SHUTDOWN_TIMEOUT_MS = 5000;

async function main() {
  const config = loadConfig();
  const log = createLogger(config.LOG_LEVEL);
  const storage = createStorage(config);
  const hub = new RealtimeHub(log);

  const events = new EventService(storage.events, hub, log);
  const devices = new DeviceService(
    storage.devices,
    events,
    hub,
    {
      autoRegister: config.AUTO_REGISTER_DEVICES,
      offlineAfterMs: config.DEVICE_OFFLINE_AFTER_SEC * 1000,
      persistIntervalMs: config.DEVICE_PERSIST_INTERVAL_SEC * 1000,
      seed: config.SEED_DEVICES,
    },
    log,
  );
  try {
    await devices.load(); // before MQTT, so presence starts from the stored state
  } catch (err) {
    log.fatal({ err, driver: storage.driver }, "cannot load devices from storage");
    process.exit(1);
  }

  const telemetry = new TelemetryService(
    storage.telemetry,
    hub,
    new Downsampler(config.TELEMETRY_PERSIST_INTERVAL_SEC * 1000),
    log,
  );

  // The handler needs `commands`, which needs the MQTT link: bind it late.
  let commands: CommandService | undefined;
  const handle = createMessageHandler({
    prefix: config.MQTT_TOPIC_PREFIX,
    devices,
    dedup: new RecentMessages(),
    telemetry,
    events,
    commands: { handleAck: (device, ack) => commands?.handleAck(device, ack) ?? Promise.resolve() },
    log,
  });
  const mqtt = new MqttLink(config, log, handle);
  commands = new CommandService(
    storage.commands,
    mqtt,
    events,
    hub,
    { prefix: config.MQTT_TOPIC_PREFIX, ackTimeoutMs: config.COMMAND_ACK_TIMEOUT_SEC * 1000 },
    log,
  );

  const stopRules = startServerRules({ devices, commands }, log);

  let model: AssistantModel | null = null;
  if (config.ASSISTANT_PROVIDER === "rules") model = new RulesModel();
  else if (config.ASSISTANT_PROVIDER === "gemini" && config.GEMINI_API_KEY)
    model = new GeminiModel(config.GEMINI_API_KEY, config.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL.gemini);
  else if (config.ASSISTANT_PROVIDER === "anthropic" && config.ANTHROPIC_API_KEY)
    model = new AnthropicModel(config.ANTHROPIC_API_KEY, config.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL.anthropic);
  else if (config.ASSISTANT_PROVIDER !== "off") {
    const key = config.ASSISTANT_PROVIDER === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
    log.warn(`ASSISTANT_PROVIDER=${config.ASSISTANT_PROVIDER} but ${key} is empty: the assistant answers 503 (set ASSISTANT_PROVIDER=rules to try it offline)`);
  }
  const assistant = new AssistantService(
    model,
    commands,
    async (code) => (await telemetry.recent(code, new Date(Date.now() - 5 * 60_000), 1))[0] ?? null,
    { timeoutMs: config.ASSISTANT_TIMEOUT_SEC * 1000 },
    log.child({ module: "assistant" }),
  );
  const app = await buildApi({
    storage,
    devices,
    telemetry,
    events,
    commands,
    assistant,
    hub,
    mqttConnected: () => mqtt.isConnected(),
    corsOrigins: config.CORS_ORIGIN,
    snapshotTelemetryMs: config.SNAPSHOT_TELEMETRY_MIN * 60_000,
    log,
  });
  await app.listen({ port: config.PORT, host: config.HOST });
  log.info(
    { prefix: config.MQTT_TOPIC_PREFIX, storage: storage.driver, assistant: model?.name ?? "off" },
    "backend ready",
  );

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "shutting down");
    setTimeout(() => {
      log.error("shutdown took longer than 5 s, exiting");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    stopRules();
    hub.close(); // SSE responses never end on their own, and app.close() waits for them
    await Promise.allSettled([app.close(), mqtt.close()]);
    await storage.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
