import { parseArgs } from "node:util";
import { NodeSim, TELEMETRY_INTERVAL_MS } from "../src/node";
import { describeFrame, openLink } from "../src/transport";

// Stand-in for the node board (docs/link-protocol.md §6.2), for whoever builds the gateway:
// HELLO, telemetry / status / events from a simulated room, commands executed and acked,
// all as link frames on --link.
//
//   pnpm --filter @srdt/link-sim fake-node                            tcp:127.0.0.1:7000 (fake-gateway)
//   pnpm --filter @srdt/link-sim fake-node --link serial:COM6         the gateway board on a USB-UART adapter
//   pnpm --filter @srdt/link-sim fake-node --link tunnel:mqtts://u:p@host:8883
//
// env: DEVICE_ID

const { values: args } = parseArgs({
  options: {
    link: { type: "string", default: "tcp:127.0.0.1:7000" },
    node: { type: "string", default: process.env.DEVICE_ID ?? "room-01" },
    verbose: { type: "boolean", short: "v", default: false },
  },
});

const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 23)} ${msg}`);
const link = await openLink(args.link, { role: "node", nodeId: args.node, log });
const node = new NodeSim({ deviceId: args.node, link, log });

link.onFrame((f) => {
  if (args.verbose) log(`[node] ← ${describeFrame(f)}`);
  node.onFrame(f);
});
node.start();
setInterval(() => node.tick(), 1000);
setInterval(() => node.step(), TELEMETRY_INTERVAL_MS);

log(`[node] fake node ${args.node} (boot ${node.bootId}) on ${link.label}`);
const help = "[node] stdin: hot | smoke | calm | die [sec] | reboot | stats";
log(help);

process.stdin.setEncoding("utf8");
process.stdin.on("data", (text: string) => {
  for (const line of text.split(/\r?\n/)) {
    const [cmd, arg] = line.trim().split(/\s+/);
    if (!cmd) continue;
    if (cmd === "hot" || cmd === "smoke" || cmd === "calm") {
      node.room.steer(cmd);
      log(`[node] steering toward ${cmd}`);
    } else if (cmd === "die") {
      const sec = Number(arg ?? 20);
      node.silentUntil = Date.now() + sec * 1000;
      log(`[node] silent for ${sec} s (the gateway should report offline after 15 s)`);
    } else if (cmd === "reboot") {
      node.reboot();
      log(`[node] rebooted, boot ${node.bootId}`);
    } else if (cmd === "stats") {
      const r = node.room.readings();
      log(
        `[node] gateway ${node.gateway.up ? "up" : "down"}, mqtt ${node.mqttUp ? "up" : "down"}, ` +
          `${r.temperature}°C aq ${r.airQuality} ${node.room.edgeState}, ` +
          `link lost ${node.gateway.lost} dup ${node.gateway.duplicates} bad ${link.errors()}`,
      );
    } else log(help);
  }
});

process.on("SIGINT", async () => {
  await link.close();
  process.exit(0);
});
