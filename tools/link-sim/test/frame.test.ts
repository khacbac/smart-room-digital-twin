import { describe, expect, it } from "vitest";
import {
  LINK_PAYLOAD_MAX,
  StreamDecoder,
  Type,
  WIRE_MAX,
  cobsDecode,
  cobsEncode,
  crc16,
  decodeRaw,
  encodeRaw,
  encodeStream,
} from "../src/frame";
import { buildHello, buildLinkState, buildTime } from "../src/messages";
import { PeerMonitor, TxTracker } from "../src/peer";

// Same vectors as device/test/test_link and docs/link-protocol.md §3.4.
const hex = (b: Buffer) => b.toString("hex").toUpperCase().match(/../g)!.join(" ");

describe("frame codec (twin of lib/link)", () => {
  it("CRC-16/CCITT-FALSE check value", () => {
    expect(crc16(Buffer.from("123456789"))).toBe(0x29b1);
  });

  it("golden vectors", () => {
    expect(hex(encodeRaw(Type.Heartbeat, 7))).toBe("01 06 07 ED 21");
    expect(hex(encodeStream(Type.Heartbeat, 7))).toBe("06 01 06 07 ED 21 00");
    expect(hex(encodeStream(Type.Command, 0, Buffer.from('{"a":1}')))).toBe(
      "03 01 81 0A 7B 22 61 22 3A 31 7D BA 59 00",
    );
    expect(hex(cobsEncode(Buffer.from([0x11, 0x22, 0x00, 0x33])))).toBe("03 11 22 02 33");
  });

  it("COBS round trip around the 254-byte block edge", () => {
    for (const n of [1, 253, 254, 255, 508, 1029]) {
      const buf = Buffer.alloc(n, 0).map((_, i) => (i % 7 === 0 ? 0 : (i % 255) + 1));
      const enc = cobsEncode(buf);
      expect(enc.includes(0)).toBe(false);
      expect(cobsDecode(enc)).toEqual(Buffer.from(buf));
    }
    expect(cobsDecode(Buffer.from([0x03, 0x11, 0x00]))).toBeNull();
  });

  it("decode errors", () => {
    const f = encodeRaw(Type.Event, 1, Buffer.from("{}"));
    expect(decodeRaw(f.subarray(0, 4))).toEqual({ error: "TOO_SHORT" });
    const bad = Buffer.from(f);
    bad[3]! ^= 1;
    expect(decodeRaw(bad)).toEqual({ error: "BAD_CRC" });
    expect(() => encodeRaw(Type.Telemetry, 0, Buffer.alloc(LINK_PAYLOAD_MAX + 1))).toThrow(RangeError);
  });

  it("stream decoder: back to back, noise, overflow, max payload", () => {
    const d = new StreamDecoder();
    const a = encodeStream(Type.Heartbeat, 1);
    const b = encodeStream(Type.Ack, 2, Buffer.from('{"ok":1}'));
    expect(d.push(Buffer.concat([Buffer.from([0, 0x5a, 0xa5, 0]), a, b])).map((f) => f.seq)).toEqual([1, 2]);
    expect(d.stats.errors).toBe(1);

    d.push(Buffer.alloc(WIRE_MAX + 10, 0x41));
    expect(d.push(Buffer.from([0]))).toEqual([]);
    expect(d.lastError).toBe("TOO_LONG");

    const big = Buffer.alloc(LINK_PAYLOAD_MAX).map((_, i) => i & 0xff);
    const [frame] = d.push(encodeStream(Type.Status, 4, big));
    expect(frame?.payload).toEqual(Buffer.from(big));
  });

  it("link-only JSON matches the firmware bytes", () => {
    expect(buildHello({ deviceId: "room-01", bootId: "a1b2c3d4", fw: "0.2.0" }).toString()).toBe(
      '{"deviceId":"room-01","bootId":"a1b2c3d4","fw":"0.2.0"}',
    );
    expect(buildTime(1790591200123).toString()).toBe('{"ts":1790591200123}');
    expect(buildLinkState({ mqtt: true, rssi: -61, bootId: "a1b2c3d4" }).toString()).toBe(
      '{"mqtt":true,"rssi":-61,"bootId":"a1b2c3d4"}',
    );
    expect(buildLinkState({ mqtt: false }).toString()).toBe('{"mqtt":false}');
  });

  it("liveness", () => {
    const tx = new TxTracker();
    expect(tx.heartbeatDue(0)).toBe(true);
    tx.take(1000);
    expect(tx.heartbeatDue(5999)).toBe(false);
    expect(tx.heartbeatDue(6000)).toBe(true);

    const p = new PeerMonitor();
    expect(p.onFrame(250, 0)).toBe("up");
    p.onFrame(253, 0);
    p.onFrame(253, 0);
    p.onFrame(1, 0);
    expect([p.lost, p.duplicates]).toEqual([5, 1]);
    expect(p.tick(15_000)).toBe("down");
  });
});
