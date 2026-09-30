import { type Frame, Type } from "./frame";
import { type LinkTransport, describeFrame } from "./transport";

// A wire between two real boards (docs/link-protocol.md §6.2): every frame from one link
// goes out unchanged (type, seq, payload) on the other. Used for env:node-wokwi ⇄
// env:gateway-wokwi, each on its own Wokwi RFC 2217 port. Frames are decoded and
// re-encoded: a valid frame reaches the other board byte for byte, noise and broken
// frames stop here. `cut()` unplugs the wire for a while.

/** Frames worth a line without -v: the rest (telemetry, heartbeats, LINK_STATE) are periodic. */
const QUIET: ReadonlySet<Type> = new Set<Type>([Type.Telemetry, Type.Heartbeat, Type.LinkState]);

export class LinkSplice {
  readonly counters = { up: 0, down: 0, cut: 0 };
  private cutUntil = 0;

  constructor(
    private node: LinkTransport,
    private gateway: LinkTransport,
    private opts: { log: (msg: string) => void; verbose?: boolean; now?: () => number },
  ) {}

  start() {
    const { log } = this.opts;
    this.node.onConsole?.((line) => log(`node| ${line}`));
    this.gateway.onConsole?.((line) => log(`gw| ${line}`));
    this.node.onFrame((f) => this.pass(f, this.gateway, "up"));
    this.gateway.onFrame((f) => this.pass(f, this.node, "down"));
  }

  /** Drop every frame, both ways, for `ms`: both boards should time out after 15 s. */
  cut(ms: number) {
    this.cutUntil = this.now() + ms;
  }

  get isCut() {
    return this.now() < this.cutUntil;
  }

  private pass(f: Frame, to: LinkTransport, dir: "up" | "down") {
    if (this.isCut) {
      this.counters.cut++;
      return;
    }
    this.counters[dir]++;
    to.send(f.type, f.seq, f.payload);
    if (this.opts.verbose || !QUIET.has(f.type)) {
      this.opts.log(`[wire] ${dir === "up" ? "node → gw" : "gw → node"} ${describeFrame(f)}`);
    }
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }
}
