import { parseArgs } from "node:util";
import { LinkSplice } from "../src/splice";
import { openLink } from "../src/transport";

// Wires the two real boards together (docs/link-protocol.md §6.2), with no fake on either
// side: env:node-wokwi and env:gateway-wokwi in two Wokwi simulators, each serving its link
// UART on its own RFC 2217 port. Both consoles show up here as node| … and gw| ….
//
//   pnpm --filter @srdt/link-sim splice                                  rfc2217:4002 (node) ⇄ rfc2217:4001 (gateway)
//   pnpm --filter @srdt/link-sim splice --node serial:COM5              the node board on a USB-UART, gateway in Wokwi
//
// Any --link spec works on either side (serial:, tcp:, tcp-listen:, rfc2217:, tunnel:).
// env: DEVICE_ID (only for tunnel: topics)

const { values: args } = parseArgs({
  options: {
    node: { type: "string", default: "rfc2217:127.0.0.1:4002" },
    gateway: { type: "string", default: "rfc2217:127.0.0.1:4001" },
    id: { type: "string", default: process.env.DEVICE_ID ?? "room-01" },
    verbose: { type: "boolean", short: "v", default: false },
  },
});

const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 23)} ${msg}`);
// Toward the node we stand where the gateway is, and the other way round (tunnel: topics).
const node = await openLink(args.node, { role: "gateway", nodeId: args.id, log });
const gateway = await openLink(args.gateway, { role: "node", nodeId: args.id, log });
const splice = new LinkSplice(node, gateway, { log, verbose: args.verbose });
splice.start();

const help = "[wire] stdin: cut [sec] | stats";
log(`[wire] node ${node.label} ⇄ gateway ${gateway.label}`);
log(help);

process.stdin.setEncoding("utf8");
process.stdin.on("data", (text: string) => {
  for (const line of text.split(/\r?\n/)) {
    const [cmd, arg] = line.trim().split(/\s+/);
    if (!cmd) continue;
    if (cmd === "cut") {
      const sec = arg ? Number(arg) : 20;
      splice.cut(sec * 1000);
      log(`[wire] cut for ${sec} s (both boards should report the other lost after 15 s)`);
      setTimeout(() => log("[wire] reconnected"), sec * 1000);
    } else if (cmd === "stats") {
      const c = splice.counters;
      log(
        `[wire] node → gw ${c.up}, gw → node ${c.down}, dropped while cut ${c.cut}, ` +
          `bad frames node ${node.errors()} gw ${gateway.errors()}`,
      );
    } else log(help);
  }
});

process.on("SIGINT", async () => {
  await node.close();
  await gateway.close();
  process.exit(0);
});
