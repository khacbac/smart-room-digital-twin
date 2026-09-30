import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type Frame, StreamDecoder, Type, encodeStream } from "../src/frame";
import { type LinkTransport, TELNET_BINARY, TelnetFilter, openLink, telnetEscape } from "../src/transport";

// rfc2217: transport (docs/link-protocol.md §6.2, Wokwi): telnet framing under the stream frames.

describe("telnet byte layer", () => {
  it("escapes 0xFF as IAC IAC", () => {
    expect(telnetEscape(Buffer.from([1, 0xff, 2]))).toEqual(Buffer.from([1, 0xff, 0xff, 2]));
    const plain = Buffer.from([1, 2, 3]);
    expect(telnetEscape(plain)).toBe(plain);
  });

  it("strips negotiation and sub-negotiation, split across chunks", () => {
    const f = new TelnetFilter();
    const wire = Buffer.from([
      0xff, 0xfb, 0x2c, // IAC WILL COM-PORT-OPTION
      0x41,
      0xff, 0xff, // data 0xFF
      0xff, 0xfa, 0x2c, 0x65, 0x00, 0x01, 0xc2, 0x00, 0xff, 0xf0, // IAC SB … IAC SE
      0x42,
      0xff, 0xf1, // IAC NOP
      0x00,
    ]);
    const out: number[] = [];
    for (const b of wire) out.push(...f.push(Buffer.from([b]))); // worst case: 1 byte per chunk
    expect(out).toEqual([0x41, 0xff, 0x42, 0x00]);
  });
});

// A stand-in for Wokwi's RFC 2217 server: telnet on the socket, a "UART" on the other side.
function fakeRfc2217Server() {
  const uart = new StreamDecoder();
  const fromClient: Frame[] = [];
  const opening: Buffer[] = [];
  let socket: net.Socket | null = null;
  const filter = new TelnetFilter();
  const server = net.createServer((s) => {
    socket = s;
    s.write(Buffer.from([0xff, 0xfb, 0x2c])); // negotiation the client has to skip
    s.on("data", (chunk: Buffer) => {
      if (opening.length === 0) opening.push(chunk);
      for (const f of uart.push(filter.push(chunk))) fromClient.push(f);
    });
  });
  return {
    fromClient,
    opening,
    listen: () => new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as net.AddressInfo).port))),
    uartSend: (bytes: Buffer) => socket?.write(telnetEscape(bytes)),
    close: () => {
      socket?.destroy();
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(cond()).toBe(true);
};

describe("rfc2217 transport", () => {
  let link: LinkTransport | null = null;
  let server: ReturnType<typeof fakeRfc2217Server> | null = null;
  afterEach(async () => {
    await link?.close();
    await server?.close();
  });

  it("round-trips frames that contain 0xFF", async () => {
    server = fakeRfc2217Server();
    const port = await server.listen();
    link = await openLink(`rfc2217:127.0.0.1:${port}`, { role: "gateway", nodeId: "room-01", log: () => {} });
    expect(link.label).toBe(`rfc2217 127.0.0.1:${port}`);
    const got: Frame[] = [];
    link.onFrame((f) => got.push(f));
    await until(() => server!.opening.length > 0);
    expect(server.opening[0]!.subarray(0, TELNET_BINARY.length)).toEqual(TELNET_BINARY);

    const payload = Buffer.from([0x7b, 0xff, 0xff, 0x00, 0x7d]);
    link.send(Type.Command, 0xff, payload);
    await until(() => server!.fromClient.length === 1);
    expect(server.fromClient[0]).toMatchObject({ type: Type.Command, seq: 0xff });
    expect(server.fromClient[0]!.payload).toEqual(payload);

    server.uartSend(encodeStream(Type.Telemetry, 0xff, payload));
    await until(() => got.length === 1);
    expect(got[0]).toMatchObject({ type: Type.Telemetry, seq: 0xff });
    expect(got[0]!.payload).toEqual(payload);
    expect(link.errors()).toBe(0);
  });

  it("joins a peer's console chunks (console_tee.cpp) back into lines", async () => {
    server = fakeRfc2217Server();
    const port = await server.listen();
    link = await openLink(`rfc2217:127.0.0.1:${port}`, { role: "node", nodeId: "room-01", log: () => {} });
    const lines: string[] = [];
    const got: Frame[] = [];
    link.onConsole?.((l) => lines.push(l));
    link.onFrame((f) => got.push(f));
    await until(() => server!.opening.length > 0);

    server.uartSend(Buffer.from("[boot] gateway \0"));
    server.uartSend(encodeStream(Type.LinkState, 1, Buffer.from('{"mqtt":false}')));
    server.uartSend(Buffer.from("reset=PANIC\r\n\0[wifi] up\n\0"));
    await until(() => lines.length === 2 && got.length === 1);
    expect(lines).toEqual(["[boot] gateway reset=PANIC", "[wifi] up"]);
    expect(link.errors()).toBe(0);
  });
});
