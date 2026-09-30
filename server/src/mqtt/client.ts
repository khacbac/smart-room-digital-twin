import { randomBytes } from "node:crypto";
import mqtt, { type MqttClient } from "mqtt";
import type { CommandPublisher } from "../commands/command.service";
import type { Config } from "../config/env";
import type { Logger } from "../logger";
import { subscriptions } from "./topics";

export type MessageHandler = (topic: string, payload: Buffer, retain: boolean) => Promise<void>;

/** §6.4 backend client: `srdt-server-{random}`, keepalive 30 s, reconnect every 2 s, MQTT 3.1.1. */
export class MqttLink implements CommandPublisher {
  readonly client: MqttClient;

  constructor(
    config: Config,
    log: Logger,
    onMessage: MessageHandler,
  ) {
    this.client = mqtt.connect(config.MQTT_URL, {
      clientId: `srdt-server-${randomBytes(4).toString("hex")}`,
      protocolVersion: 4, // not MQTT 5 + rap: presence relies on live messages arriving with retain = 0 (§9.1)
      keepalive: 30,
      reconnectPeriod: 2000,
      connectTimeout: 5000,
      clean: true,
      resubscribe: false, // subscribed on every connect below
      queueQoSZero: false,
      username: config.MQTT_USERNAME,
      password: config.MQTT_PASSWORD,
    });

    const topics = subscriptions(config.MQTT_TOPIC_PREFIX);
    this.client.on("connect", () => {
      log.info({ url: config.MQTT_URL }, "mqtt connected");
      this.client.subscribe(topics, { qos: 1 }, (err) => {
        if (err) log.error({ err }, "mqtt subscribe failed");
        else log.info({ topics }, "mqtt subscribed");
      });
    });
    this.client.on("close", () => {
      // A QoS 1 command still waiting for its PUBACK would be re-sent by mqtt.js after
      // the reconnect. Drop it instead: its row is failed (PUBLISH_ERROR) and it can
      // never reach the device late (§6.6).
      const inflight = Object.keys(this.client.outgoing).map(Number);
      for (const id of inflight) this.client.removeOutgoingMessage(id);
      if (inflight.length > 0) log.warn({ dropped: inflight.length }, "in-flight commands dropped on disconnect");
    });
    this.client.on("offline", () => log.warn("mqtt offline, reconnecting"));
    this.client.on("error", (err) => log.warn({ err: err.message }, "mqtt error"));
    this.client.on("message", (topic, payload, packet) => {
      onMessage(topic, payload, packet.retain).catch((err: unknown) =>
        log.error({ err, topic }, "mqtt message handler failed"),
      );
    });
  }

  isConnected(): boolean {
    return this.client.connected;
  }

  publishCommand(topic: string, payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.publish(topic, payload, { qos: 1, retain: false }, (err) => (err ? reject(err) : resolve()));
    });
  }

  async close(): Promise<void> {
    await this.client.endAsync();
  }
}
