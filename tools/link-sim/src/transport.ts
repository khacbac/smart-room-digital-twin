import net from "node:net";
import type { Duplex } from "node:stream";
import mqtt from "mqtt";
import { type Frame, StreamDecoder, type Type, decodeRaw, encodeRaw, encodeStream, typeName } from "./frame";

// Link transports (docs/link-protocol.md §6). The node / gateway logic only sees
// send(type, seq, payload) and onFrame(); the spec string picks the transport:
//
//   serial:COM5[@115200]     UART through a USB-UART adapter (§6.1, §6.2)
//   tcp-listen:[host:]7000   stream frames over TCP, waits for the peer
//   tcp:host:7000            stream frames over TCP, connects (and reconnects) to the peer
//   rfc2217:host:4000        like tcp:, through a telnet/RFC 2217 serial server (Wokwi, §6.2)
//   tunnel:mqtts://u:p@host  raw frames over MQTT topics srdt-link/{nodeId}/up|down (§6.3)

export interface FrameSink {
  send(type: Type, seq: number, payload: Buffer): void;
}

export interface LinkTransport extends FrameSink {
  readonly label: string;
  onFrame(cb: (frame: Frame) => void): void;
  /** Console lines the peer copies onto the link (Wokwi builds, docs §6.2); stream links only. */
  onConsole?(cb: (line: string) => void): void;
  /** Frames dropped by the decoder (noise, bad CRC …). */
  errors(): number;
  close(): Promise<void>;
}

type Log = (msg: string) => void;

// ---- Telnet (RFC 854 / 2217) -------------------------------------------------------------

const IAC = 0xff;
const SB = 0xfa;
const SE = 0xf0;
const WILL = 0xfb;
const DO = 0xfd;
const BINARY = 0x00;

/** Asks for 8-bit clean data both ways, so no CR NUL / CR LF rewriting (RFC 856). */
export const TELNET_BINARY = Buffer.from([IAC, WILL, BINARY, IAC, DO, BINARY]);

/** Data byte 0xFF goes out as IAC IAC. */
export function telnetEscape(data: Buffer): Buffer {
  if (!data.includes(IAC)) return data;
  const out: number[] = [];
  for (const b of data) {
    out.push(b);
    if (b === IAC) out.push(IAC);
  }
  return Buffer.from(out);
}

/**
 * Strips telnet commands from the received bytes, keeping state across chunks.
 * Option negotiation is ignored: the only option we need is BINARY, which we ask for.
 */
export class TelnetFilter {
  private state: "data" | "iac" | "opt" | "sb" | "sbIac" = "data";

  push(chunk: Buffer): Buffer {
    const out: number[] = [];
    for (const b of chunk) {
      switch (this.state) {
        case "data":
          if (b === IAC) this.state = "iac";
          else out.push(b);
          break;
        case "iac":
          if (b === IAC) {
            out.push(IAC);
            this.state = "data";
          } else if (b >= WILL) this.state = "opt"; // WILL / WONT / DO / DONT <option>
          else if (b === SB) this.state = "sb";
          else this.state = "data"; // NOP, BREAK …
          break;
        case "opt":
          this.state = "data";
          break;
        case "sb": // COM-PORT-OPTION replies (baud rate …), up to IAC SE
          if (b === IAC) this.state = "sbIac";
          break;
        case "sbIac":
          this.state = b === SE ? "data" : "sb";
          break;
      }
    }
    return Buffer.from(out);
  }
}

/** Byte layer under the stream frames: none for UART / TCP, telnet for RFC 2217. */
interface Codec {
  start(): Buffer | null;
  rx(chunk: Buffer): Buffer;
  tx(bytes: Buffer): Buffer;
}

const rawCodec = (): Codec => ({ start: () => null, rx: (c) => c, tx: (b) => b });

const telnetCodec = (): Codec => {
  const filter = new TelnetFilter();
  return { start: () => TELNET_BINARY, rx: (c) => filter.push(c), tx: telnetEscape };
};

/** Stream frames over whichever Duplex is currently attached (serial port, socket). */
class StreamTransport implements LinkTransport {
  private stream: Duplex | null = null;
  private decoder = new StreamDecoder();
  private codec = rawCodec();
  private handler: (frame: Frame) => void = () => {};
  private consoleHandler: ((line: string) => void) | null = null;
  private consoleLine = "";

  constructor(
    readonly label: string,
    private log: Log,
    private makeCodec: () => Codec = rawCodec,
  ) {}

  attach(stream: Duplex) {
    this.stream = stream;
    this.decoder = new StreamDecoder(); // drop half a frame from the previous connection
    this.consoleLine = "";
    if (this.consoleHandler) this.decoder.onText = (text) => this.onText(text);
    this.codec = this.makeCodec();
    const start = this.codec.start();
    if (start) stream.write(start);
    stream.write(this.codec.tx(Buffer.from([0]))); // flush garbage on the peer's side (§3.2)
    stream.on("data", (chunk: Buffer) => {
      const before = this.decoder.stats.errors;
      for (const f of this.decoder.push(this.codec.rx(chunk))) this.handler(f);
      if (this.decoder.stats.errors > before) this.log(`[link] dropped frame: ${this.decoder.lastError}`);
    });
  }

  detach(stream: Duplex) {
    if (this.stream === stream) this.stream = null;
  }

  send(type: Type, seq: number, payload: Buffer) {
    if (!this.stream) return; // no peer: the frame is lost, like on an unplugged UART
    this.stream.write(this.codec.tx(encodeStream(type, seq, payload)));
  }

  onFrame(cb: (frame: Frame) => void) {
    this.handler = cb;
  }

  onConsole(cb: (line: string) => void) {
    this.consoleHandler = cb;
    this.decoder.onText = (text) => this.onText(text);
  }

  errors() {
    return this.decoder.stats.errors;
  }

  // One console write per chunk (console_tee.cpp): join them back into lines.
  private onText(text: Buffer) {
    const lines = (this.consoleLine + text.toString("utf8")).split("\n");
    this.consoleLine = lines.pop() ?? "";
    for (const line of lines) {
      const l = line.replace(/\r$/, "");
      if (l) this.consoleHandler?.(l);
    }
  }

  async close() {
    this.stream?.destroy();
  }
}

async function openSerial(path: string, baudRate: number, log: Log): Promise<LinkTransport> {
  // Loaded lazily: only this transport needs the native binding.
  const { SerialPort } = await import("serialport");
  const t = new StreamTransport(`serial ${path} @${baudRate}`, log);
  let closing = false;
  const open = () => {
    const port = new SerialPort({ path, baudRate, autoOpen: false });
    port.open((err) => {
      if (err) {
        log(`[link] ${path}: ${err.message}, retrying in 2 s`);
        setTimeout(open, 2000);
        return;
      }
      log(`[link] ${path} open`);
      t.attach(port);
    });
    port.on("close", () => {
      t.detach(port);
      if (!closing) {
        log(`[link] ${path} closed, reopening in 2 s`);
        setTimeout(open, 2000);
      }
    });
    port.on("error", (e) => log(`[link] ${path}: ${e.message}`));
  };
  open();
  const close = t.close.bind(t);
  t.close = async () => {
    closing = true;
    await close();
  };
  return t;
}

function listenTcp(host: string, port: number, log: Log): LinkTransport {
  const t = new StreamTransport(`tcp-listen ${host}:${port}`, log);
  let current: net.Socket | null = null;
  const server = net.createServer((socket) => {
    if (current) {
      // Like re-plugging a UART: the newest peer wins. If this repeats every second,
      // two peers are running and keep kicking each other out.
      log("[link] new peer connection replaces the old one (two peers running?)");
      current.destroy();
    }
    current = socket;
    log(`[link] peer connected from ${socket.remoteAddress}:${socket.remotePort}`);
    t.attach(socket);
    socket.on("close", () => {
      t.detach(socket);
      if (current === socket) current = null;
      log("[link] peer disconnected");
    });
    socket.on("error", () => {});
  });
  server.listen(port, host, () => log(`[link] waiting for the peer on tcp ${host}:${port}`));
  t.close = async () => {
    current?.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  };
  return t;
}

function connectTcp(host: string, port: number, log: Log, telnet = false): LinkTransport {
  const t = new StreamTransport(`${telnet ? "rfc2217" : "tcp"} ${host}:${port}`, log, telnet ? telnetCodec : rawCodec);
  let closing = false;
  let socket: net.Socket | null = null;
  let warned = false;
  const connect = () => {
    const s = net.connect(port, host, () => {
      warned = false;
      log(`[link] connected to tcp ${host}:${port}`);
      t.attach(s);
    });
    socket = s;
    s.on("error", (e) => {
      if (!warned) log(`[link] tcp ${host}:${port}: ${e.message}, retrying every 1 s`);
      warned = true;
    });
    s.on("close", () => {
      t.detach(s);
      if (!closing) setTimeout(connect, 1000);
    });
  };
  connect();
  t.close = async () => {
    closing = true;
    socket?.destroy();
  };
  return t;
}

/** Raw frames over MQTT (§6.3). `role` decides which topic is up and which is down. */
function tunnel(url: string, role: "node" | "gateway", nodeId: string, log: Log): LinkTransport {
  const up = `srdt-link/${nodeId}/up`;
  const down = `srdt-link/${nodeId}/down`;
  const [rx, tx] = role === "node" ? [down, up] : [up, down];
  const client = mqtt.connect(url, { clientId: `link-${role}-${nodeId}-${process.pid}`, protocolVersion: 4 });
  let handler: (frame: Frame) => void = () => {};
  let errors = 0;
  client.on("connect", () => {
    log(`[link] tunnel connected, rx ${rx}, tx ${tx}`);
    client.subscribe(rx, { qos: 0 });
  });
  client.on("error", (e) => log(`[link] tunnel: ${e.message}`));
  client.on("message", (_topic, payload) => {
    const r = decodeRaw(payload);
    if ("error" in r) {
      errors++;
      log(`[link] dropped frame: ${r.error}`);
      return;
    }
    handler(r.frame);
  });
  return {
    label: `tunnel ${url.replace(/\/\/[^@]*@/, "//***@")}`,
    send(type, seq, payload) {
      if (client.connected) client.publish(tx, encodeRaw(type, seq, payload), { qos: 0 });
    },
    onFrame(cb) {
      handler = cb;
    },
    errors: () => errors,
    close: async () => {
      await client.endAsync();
    },
  };
}

export async function openLink(
  spec: string,
  opts: { role: "node" | "gateway"; nodeId: string; log: Log },
): Promise<LinkTransport> {
  const [kind, ...rest] = spec.split(":");
  const arg = rest.join(":");
  switch (kind) {
    case "serial": {
      const [path, baud] = arg.split("@");
      if (!path) break;
      return openSerial(path, Number(baud ?? 115200), opts.log);
    }
    case "tcp-listen": {
      const parts = arg.split(":");
      const port = Number(parts.pop());
      return listenTcp(parts[0] || "127.0.0.1", port, opts.log);
    }
    case "tcp":
    case "rfc2217": {
      const i = arg.lastIndexOf(":");
      if (i <= 0) break;
      return connectTcp(arg.slice(0, i), Number(arg.slice(i + 1)), opts.log, kind === "rfc2217");
    }
    case "tunnel":
      if (!arg) break;
      return tunnel(arg, opts.role, opts.nodeId, opts.log);
  }
  throw new Error(
    `bad --link "${spec}" (serial:COM5[@115200] | tcp-listen:[host:]port | tcp:host:port | rfc2217:host:port | tunnel:mqtt-url)`,
  );
}

/**
 * Two transports wired back to back in memory, through the real stream codec. For
 * tests; `cut(true)` breaks the line.
 */
export function memoryPair(): { a: LinkTransport; b: LinkTransport; cut: (on: boolean) => void } {
  let broken = false;
  const make = (label: string) => {
    const decoder = new StreamDecoder();
    let handler: (frame: Frame) => void = () => {};
    return {
      decoder,
      deliver: (bytes: Buffer) => {
        for (const f of decoder.push(bytes)) handler(f);
      },
      t: {
        label,
        send: (_type: Type, _seq: number, _payload: Buffer) => {},
        onFrame: (cb: (frame: Frame) => void) => {
          handler = cb;
        },
        errors: () => decoder.stats.errors,
        close: async () => {},
      } as LinkTransport,
    };
  };
  const a = make("memory a");
  const b = make("memory b");
  a.t.send = (type, seq, payload) => {
    if (!broken) b.deliver(encodeStream(type, seq, payload));
  };
  b.t.send = (type, seq, payload) => {
    if (!broken) a.deliver(encodeStream(type, seq, payload));
  };
  return { a: a.t, b: b.t, cut: (on) => (broken = on) };
}

export const describeFrame = (f: Frame) => `${typeName(f.type)} #${f.seq} (${f.payload.length} B)`;
