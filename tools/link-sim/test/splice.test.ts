import { describe, expect, it } from "vitest";
import { type Frame, Type } from "../src/frame";
import { LinkSplice } from "../src/splice";
import { memoryPair } from "../src/transport";

// node board ⇄ line A ⇄ splice ⇄ line B ⇄ gateway board, through the real stream codec.

describe("link splice", () => {
  it("passes frames unchanged both ways, and drops them while cut", () => {
    let clock = 0;
    const a = memoryPair();
    const b = memoryPair();
    const logs: string[] = [];
    const splice = new LinkSplice(a.b, b.a, { log: (m) => logs.push(m), now: () => clock });
    splice.start();
    const atGw: Frame[] = [];
    const atNode: Frame[] = [];
    b.b.onFrame((f) => atGw.push(f));
    a.a.onFrame((f) => atNode.push(f));

    const hello = Buffer.from('{"deviceId":"room-01","bootId":"a1b2c3d4","fw":"0.2.0"}');
    a.a.send(Type.Hello, 0xff, hello);
    b.b.send(Type.Command, 3, Buffer.from('{"a":1}'));
    expect(atGw).toMatchObject([{ type: Type.Hello, seq: 0xff }]);
    expect(atGw[0]!.payload).toEqual(hello);
    expect(atNode).toMatchObject([{ type: Type.Command, seq: 3 }]);
    expect(logs).toEqual(["[wire] node → gw HELLO #255 (55 B)", "[wire] gw → node COMMAND #3 (7 B)"]);

    a.a.send(Type.Telemetry, 0, Buffer.from("{}")); // periodic: passed, not logged
    expect(atGw).toHaveLength(2);
    expect(logs).toHaveLength(2);

    splice.cut(20_000);
    clock = 19_999;
    a.a.send(Type.Heartbeat, 1, Buffer.alloc(0));
    b.b.send(Type.LinkState, 4, Buffer.from('{"mqtt":true}'));
    expect([atGw.length, atNode.length]).toEqual([2, 1]);
    clock = 20_000;
    a.a.send(Type.Heartbeat, 2, Buffer.alloc(0));
    expect(atGw.at(-1)).toMatchObject({ type: Type.Heartbeat, seq: 2 });
    expect(splice.counters).toEqual({ up: 3, down: 1, cut: 2 });
  });
});
