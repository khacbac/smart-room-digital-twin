// TypeScript twin of device/lib/link/src/link_frame.* (docs/link-protocol.md §3).
// It must produce the same bytes as the firmware: test/frame.test.ts checks the §3.4
// golden vectors, which device/test/test_link checks too.

export const LINK_VERSION = 1;
export const LINK_PAYLOAD_MAX = 1024;
export const HEADER_SIZE = 3; // version, type, seq
export const CRC_SIZE = 2;
export const RAW_MAX = HEADER_SIZE + LINK_PAYLOAD_MAX + CRC_SIZE;
export const cobsMaxEncoded = (n: number) => n + Math.floor(n / 254) + 1;
export const WIRE_MAX = cobsMaxEncoded(RAW_MAX) + 1;

/** Bit 7 is the direction: 0 node → gateway, 1 gateway → node (doc §4). */
export const Type = {
  Telemetry: 0x01,
  Status: 0x02,
  Event: 0x03,
  Ack: 0x04,
  Hello: 0x05,
  Heartbeat: 0x06,
  Command: 0x81,
  Time: 0x82,
  LinkState: 0x83,
  HelloRequest: 0x84,
} as const;
export type Type = (typeof Type)[keyof typeof Type];

const NAMES: Record<number, string> = {
  [Type.Telemetry]: "TELEMETRY",
  [Type.Status]: "STATUS",
  [Type.Event]: "EVENT",
  [Type.Ack]: "ACK",
  [Type.Hello]: "HELLO",
  [Type.Heartbeat]: "HEARTBEAT",
  [Type.Command]: "COMMAND",
  [Type.Time]: "TIME",
  [Type.LinkState]: "LINK_STATE",
  [Type.HelloRequest]: "HELLO_REQUEST",
};

export const isKnownType = (t: number): t is Type => t in NAMES;
export const typeName = (t: number) => NAMES[t] ?? "?";
export const fromNode = (t: Type) => (t & 0x80) === 0;

export interface Frame {
  version: number;
  type: Type;
  seq: number;
  payload: Buffer;
}

export type DecodeError = "TOO_SHORT" | "TOO_LONG" | "BAD_COBS" | "BAD_CRC" | "BAD_VERSION" | "UNKNOWN_TYPE";

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF): "123456789" → 0x29B1. */
export function crc16(data: Uint8Array, crc = 0xffff): number {
  for (const byte of data) {
    crc ^= byte << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

export function cobsEncode(input: Uint8Array): Buffer {
  const out = Buffer.alloc(cobsMaxEncoded(input.length));
  let codeAt = 0;
  let o = 1;
  let code = 1;
  for (const byte of input) {
    if (byte === 0) {
      out[codeAt] = code;
      codeAt = o++;
      code = 1;
      continue;
    }
    out[o++] = byte;
    if (++code === 0xff) {
      out[codeAt] = code;
      codeAt = o++;
      code = 1;
    }
  }
  out[codeAt] = code;
  return out.subarray(0, o);
}

/** `null` on malformed input. */
export function cobsDecode(input: Uint8Array): Buffer | null {
  const out = Buffer.alloc(input.length);
  let i = 0;
  let o = 0;
  while (i < input.length) {
    const code = input[i++]!;
    if (code === 0) return null;
    for (let k = 1; k < code; k++) {
      if (i >= input.length || input[i] === 0) return null;
      out[o++] = input[i++]!;
    }
    if (code !== 0xff && i < input.length) out[o++] = 0;
  }
  return out.subarray(0, o);
}

/** version | type | seq | payload | crc16 LE. Throws when the payload is too long. */
export function encodeRaw(type: Type, seq: number, payload: Uint8Array = Buffer.alloc(0)): Buffer {
  if (payload.length > LINK_PAYLOAD_MAX) throw new RangeError(`link payload ${payload.length} B > ${LINK_PAYLOAD_MAX}`);
  const out = Buffer.alloc(HEADER_SIZE + payload.length + CRC_SIZE);
  out[0] = LINK_VERSION;
  out[1] = type;
  out[2] = seq & 0xff;
  out.set(payload, HEADER_SIZE);
  out.writeUInt16LE(crc16(out.subarray(0, HEADER_SIZE + payload.length)), HEADER_SIZE + payload.length);
  return out;
}

export function decodeRaw(raw: Uint8Array): { frame: Frame } | { error: DecodeError } {
  if (raw.length < HEADER_SIZE + CRC_SIZE) return { error: "TOO_SHORT" };
  if (raw.length > RAW_MAX) return { error: "TOO_LONG" };
  const body = raw.length - CRC_SIZE;
  const crc = raw[body]! | (raw[body + 1]! << 8);
  if (crc16(raw.subarray(0, body)) !== crc) return { error: "BAD_CRC" };
  if (raw[0] !== LINK_VERSION) return { error: "BAD_VERSION" };
  const type = raw[1]!;
  if (!isKnownType(type)) return { error: "UNKNOWN_TYPE" };
  return {
    frame: { version: raw[0], type, seq: raw[2]!, payload: Buffer.from(raw.subarray(HEADER_SIZE, body)) },
  };
}

/** COBS(raw frame) + 0x00, for UART / USB serial / TCP. */
export function encodeStream(type: Type, seq: number, payload?: Uint8Array): Buffer {
  return Buffer.concat([cobsEncode(encodeRaw(type, seq, payload)), Buffer.from([0])]);
}

/** Byte-stream reassembly; drops noise and partial frames at the next 0x00. */
export class StreamDecoder {
  readonly stats = { frames: 0, errors: 0, overflows: 0 };
  lastError: DecodeError | null = null;
  private buf = Buffer.alloc(WIRE_MAX - 1);
  private len = 0;
  private overflow = false;

  push(chunk: Uint8Array): Frame[] {
    const frames: Frame[] = [];
    for (const byte of chunk) {
      if (byte !== 0) {
        if (this.len < this.buf.length) this.buf[this.len++] = byte;
        else this.overflow = true;
        continue;
      }
      const n = this.len;
      const overflow = this.overflow;
      this.len = 0;
      this.overflow = false;
      if (overflow) {
        this.fail("TOO_LONG");
        this.stats.overflows++;
        continue;
      }
      if (n === 0) continue; // idle delimiter
      const raw = cobsDecode(this.buf.subarray(0, n));
      const result = raw ? decodeRaw(raw) : ({ error: "BAD_COBS" } as const);
      if ("error" in result) {
        this.fail(result.error);
        continue;
      }
      this.stats.frames++;
      frames.push(result.frame);
    }
    return frames;
  }

  private fail(error: DecodeError) {
    this.lastError = error;
    this.stats.errors++;
  }
}
