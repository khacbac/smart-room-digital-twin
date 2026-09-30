import { parseArgs } from "node:util";
import mqtt from "mqtt";
import { type Broker, GatewayBridge } from "../src/gateway";
import { openLink } from "../src/transport";

// Stand-in for the gateway board (docs/link-protocol.md §6.2), for whoever builds the node:
// speaks the link on --link and bridges it to the real broker, so the backend and the
// dashboard work as usual. `--mqtt none` logs what would be published instead.
//
//   pnpm --filter @srdt/link-sim fake-gateway                         tcp-listen:7000 ⇄ mqtt://127.0.0.1:1883
//   pnpm --filter @srdt/link-sim fake-gateway --link serial:COM5      the node board on a USB-UART adapter
//   pnpm --filter @srdt/link-sim fake-gateway --mqtt none             no broker
//
// env: MQTT_URL, MQTT_TOPIC_PREFIX, DEVICE_ID (same as server/.env)

const { values: args } = parseArgs({
  options: {
    link: { type: "string", default: "tcp-listen:7000" },
    mqtt: { type: "string", default: process.env.MQTT_URL ?? "mqtt://127.0.0.1:1883" },
    prefix: { type: "string", default: process.env.MQTT_TOPIC_PREFIX ?? "srdt" },
    node: { type: "string", default: process.env.DEVICE_ID ?? "room-01" },
    verbose: { type: "boolean", short: "v", default: false },
  },
});

const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 23)} ${msg}`);
const nodeId = args.node;
const link = await openLink(args.link, { role: "gateway", nodeId, log });

let bridge: GatewayBridge;
let broker: Broker;
let mqttClient: mqtt.MqttClient | null = null;

if (args.mqtt === "none") {
  broker = {
    publish(topic, payload, o) {
      if (args.verbose || !topic.endsWith("/telemetry")) {
        log(`[mqtt] ${topic} qos${o.qos}${o.retain ? " retained" : ""} ${payload.toString("utf8").slice(0, 160)}`);
      }
    },
  };
} else {
  const client = mqtt.connect(args.mqtt, {
    clientId: `gw-${nodeId}-fake`,
    protocolVersion: 4,
    keepalive: 15,
    // §5.3: the gateway's Last Will speaks for the node.
    will: {
      topic: `${args.prefix}/${nodeId}/status`,
      payload: Buffer.from(JSON.stringify({ v: 1, deviceId: nodeId, online: false })),
      qos: 1,
      retain: true,
    },
  });
  mqttClient = client;
  broker = { publish: (topic, payload, o) => void client.publish(topic, payload, o) };
  client.on("connect", () => {
    client.subscribe(`${args.prefix}/${nodeId}/command`, { qos: 1 });
    bridge.onBrokerUp();
  });
  client.on("close", () => bridge.onBrokerDown());
  client.on("error", (e) => log(`[mqtt] ${e.message}`));
  client.on("message", (_topic, payload) => bridge.onCommand(payload));
}

bridge = new GatewayBridge({ nodeId, prefix: args.prefix, link, broker, log, verbose: args.verbose });
link.onFrame((f) => bridge.onFrame(f));
if (args.mqtt === "none") bridge.onBrokerUp();
bridge.start();
setInterval(() => bridge.tick(), 1000);

log(`[gw] fake gateway for ${nodeId}: link ${link.label}, mqtt ${args.mqtt}, prefix ${args.prefix}`);
log("[gw] stdin: open [1-90] | close | buzz on|off | clear | ping | mqtt down|up | stats");

process.stdin.setEncoding("utf8");
process.stdin.on("data", (text: string) => {
  for (const line of text.split(/\r?\n/)) {
    const [cmd, arg] = line.trim().split(/\s+/);
    if (!cmd) continue;
    if (cmd === "open") bridge.inject("OPEN_WINDOW", arg ? Number(arg) : undefined);
    else if (cmd === "close") bridge.inject("CLOSE_WINDOW");
    else if (cmd === "buzz") bridge.inject(arg === "off" ? "BUZZER_OFF" : "BUZZER_ON");
    else if (cmd === "clear") bridge.inject("CLEAR_OVERRIDE");
    else if (cmd === "ping") bridge.inject("PING");
    else if (cmd === "mqtt") bridge.setForcedDown(arg === "down");
    else if (cmd === "stats") {
      const c = bridge.counters;
      log(
        `[gw] node ${bridge.node.up ? "up" : "down"} ${bridge.registered ? `(boot ${bridge.registered.bootId})` : "(no HELLO)"}, ` +
          `mqtt ${bridge.mqttUp ? "up" : "down"}, uplink ${c.uplink}, published ${c.published}, dropped ${c.dropped}, ` +
          `commands ${c.commands}, link lost ${bridge.node.lost} dup ${bridge.node.duplicates} bad ${link.errors()}`,
      );
    } else log("[gw] stdin: open [1-90] | close | buzz on|off | clear | ping | mqtt down|up | stats");
  }
});

process.on("SIGINT", async () => {
  await link.close();
  await mqttClient?.endAsync();
  process.exit(0);
});
