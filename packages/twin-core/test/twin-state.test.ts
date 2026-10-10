import { describe, expect, it } from "vitest";
import { HISTORY_MS, LIST_SIZE, applyMessage, initialTwinData, latest } from "../src";
import { T0, command, device, event, telemetry } from "./fixtures";

describe("applyMessage", () => {
  it("replaces everything on a snapshot and takes lastTelemetryAt from the newest sample", () => {
    const old = applyMessage(initialTwinData, { type: "telemetry", data: telemetry(1, T0 - 5000) }, T0 - 5000);
    const next = applyMessage(
      old,
      {
        type: "snapshot",
        data: {
          device: device(),
          telemetry: [telemetry(10, T0 - 4000), telemetry(11, T0 - 2000)],
          events: [event("e1", T0)],
          commands: [],
        },
      },
      T0,
    );
    expect(next.device?.code).toBe("room-01");
    expect(next.telemetry.map((t) => t.seq)).toEqual([10, 11]);
    expect(next.events).toHaveLength(1);
    expect(next.lastTelemetryAt).toBe(T0 - 2000);
  });

  it("drops telemetry older than the history window", () => {
    const snap = applyMessage(
      initialTwinData,
      {
        type: "snapshot",
        data: { device: device(), telemetry: [telemetry(1, T0 - HISTORY_MS - 1), telemetry(2, T0 - 1000)], events: [], commands: [] },
      },
      T0,
    );
    expect(snap.telemetry.map((t) => t.seq)).toEqual([2]);
  });

  it("ignores a duplicate telemetry id and returns the same state", () => {
    const s1 = applyMessage(initialTwinData, { type: "telemetry", data: telemetry(1, T0) }, T0);
    const s2 = applyMessage(s1, { type: "telemetry", data: telemetry(1, T0) }, T0 + 100);
    expect(s2).toBe(s1);
  });

  it("sets lastTelemetryAt to the receive time of a live sample", () => {
    const s = applyMessage(initialTwinData, { type: "telemetry", data: telemetry(1, T0 - 60_000) }, T0);
    expect(s.lastTelemetryAt).toBe(T0);
    expect(latest(s.telemetry)?.seq).toBe(1);
  });

  it("upserts commands newest first and keeps untouched references", () => {
    const s1 = applyMessage(initialTwinData, { type: "command", data: command("c1", T0) }, T0);
    const s2 = applyMessage(s1, { type: "command", data: command("c2", T0 + 1000) }, T0);
    const s3 = applyMessage(s2, { type: "command", data: command("c1", T0, { status: "executed" }) }, T0);
    expect(s3.commands.map((c) => [c.id, c.status])).toEqual([
      ["c2", "pending"],
      ["c1", "executed"],
    ]);
    expect(s3.events).toBe(s1.events);
    expect(s3.telemetry).toBe(s1.telemetry);
  });

  it("keeps at most LIST_SIZE events", () => {
    let s = initialTwinData;
    for (let i = 0; i < LIST_SIZE + 5; i++) s = applyMessage(s, { type: "event", data: event(`e${i}`, T0 + i * 1000) }, T0);
    expect(s.events).toHaveLength(LIST_SIZE);
    expect(s.events[0]?.id).toBe(`e${LIST_SIZE + 4}`);
  });

  it("keeps extra fields of a wider state", () => {
    const s = applyMessage({ ...initialTwinData, status: "loading" as const }, { type: "device", data: device() }, T0);
    expect(s.status).toBe("loading");
    expect(s.device?.name).toBe("Room 01");
  });
});
