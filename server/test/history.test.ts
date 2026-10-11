import { describe, expect, it } from "vitest";
import type { EventRecord, TelemetryRecord } from "@srdt/contracts";
import { pino } from "pino";
import { buildHistory, historyText } from "../src/assistant/history";
import { createMemoryStorage } from "../src/storage/memory/memory.storage";
import { RollupService, addSample, emptyRollup, hourOf } from "../src/telemetry/rollup.service";

// Hourly rollups and the history digest the assistant reads for questions about the past.

const log = pino({ level: "silent" });
const TZ = "Asia/Ho_Chi_Minh"; // UTC+7, no DST

function sample(measuredAt: string, over: Partial<TelemetryRecord> = {}): TelemetryRecord {
  return {
    id: `b-${measuredAt}`,
    deviceCode: "room-01",
    bootId: "a1b2c3d4",
    seq: 1,
    measuredAt,
    receivedAt: measuredAt,
    temperature: 26,
    humidity: 60,
    light: 300,
    airQuality: 120,
    presence: false,
    edgeState: "NORMAL",
    windowAngle: 0,
    buzzer: false,
    overrideActive: false,
    mlState: null,
    aiControl: false,
    ...over,
  };
}

describe("rollups", () => {
  it("folds samples into min/max/sum and state counts", () => {
    const r = emptyRollup("room-01", "2026-10-10T08");
    addSample(r, sample("2026-10-10T08:00:00.000Z", { temperature: 25 }));
    addSample(r, sample("2026-10-10T08:00:05.000Z", { temperature: 33, edgeState: "WARNING", windowAngle: 90, presence: true }));
    addSample(r, sample("2026-10-10T08:00:10.000Z", { temperature: null }));
    expect(r.samples).toBe(3);
    expect(r.temperature).toEqual({ min: 25, max: 33, sum: 58, count: 2 });
    expect(r.states).toEqual({ NORMAL: 2, UNCOMFORTABLE: 0, WARNING: 1, DANGER: 0 });
    expect([r.windowOpen, r.presence, r.buzzer]).toEqual([1, 1, 0]);
    expect(hourOf("2026-10-10T08:59:59.999Z")).toBe("2026-10-10T08");
  });

  it("stores an hour when it ends and merges the open hour into reads", async () => {
    const storage = createMemoryStorage();
    let clock = Date.parse("2026-10-10T08:00:00.000Z");
    const rollups = new RollupService(storage.rollups, log, 60_000, () => clock);

    rollups.add(sample("2026-10-10T08:10:00.000Z"));
    rollups.add(sample("2026-10-10T08:20:00.000Z"));
    // not yet flushed, but a read sees it
    expect((await rollups.since("room-01", "2026-10-10T00")).map((r) => [r.hour, r.samples])).toEqual([["2026-10-10T08", 2]]);
    expect(await storage.rollups.get("room-01", "2026-10-10T08")).toBeNull();

    rollups.add(sample("2026-10-10T09:00:01.000Z", { edgeState: "DANGER" }));
    await rollups.since("room-01", "2026-10-10T00");
    expect((await storage.rollups.get("room-01", "2026-10-10T08"))?.samples).toBe(2);

    // a late sample goes into its own stored hour
    rollups.add(sample("2026-10-10T08:59:00.000Z"));
    expect((await rollups.since("room-01", "2026-10-10T00")).map((r) => [r.hour, r.samples])).toEqual([
      ["2026-10-10T08", 3],
      ["2026-10-10T09", 1],
    ]);

    // the open hour is written once a minute has passed, and fully on shutdown
    clock += 61_000;
    rollups.add(sample("2026-10-10T09:01:00.000Z"));
    await rollups.flushAll();
    expect((await storage.rollups.get("room-01", "2026-10-10T09"))?.samples).toBe(2);
  });

  it("continues an hour that was partly stored before a restart", async () => {
    const storage = createMemoryStorage();
    const before = new RollupService(storage.rollups, log);
    before.add(sample("2026-10-10T08:10:00.000Z"));
    await before.flushAll();

    const after = new RollupService(storage.rollups, log);
    after.add(sample("2026-10-10T08:30:00.000Z"));
    await after.flushAll();
    expect((await storage.rollups.get("room-01", "2026-10-10T08"))?.samples).toBe(2);
  });
});

describe("buildHistory", () => {
  const NOW = Date.parse("2026-10-11T08:00:00.000Z"); // 15:00 in Hanoi

  function hourRollup(hour: string, over: { temp?: number; warning?: number } = {}) {
    const r = emptyRollup("room-01", hour);
    addSample(r, sample(`${hour}:00:00.000Z`, { temperature: over.temp ?? 26 }));
    for (let i = 0; i < (over.warning ?? 0); i++) addSample(r, sample(`${hour}:30:00.000Z`, { temperature: over.temp ?? 26, edgeState: "WARNING" }));
    return r;
  }

  const event = (type: string, severity: "info" | "warning" | "critical", at: string): EventRecord => ({
    id: `${type}-${at}`,
    deviceCode: "room-01",
    source: "device",
    bootId: null,
    seq: null,
    type,
    severity,
    message: `${type} happened`,
    data: {},
    measuredAt: at,
    createdAt: at,
  });

  it("groups by local day for long windows and lists notable events", () => {
    const h = buildHistory(
      {
        // 2026-10-09T18 UTC is already 10-10 01:00 in Hanoi
        rollups: [hourRollup("2026-10-09T10"), hourRollup("2026-10-09T18", { temp: 34, warning: 3 }), hourRollup("2026-10-10T05")],
        events: [
          event("STATE_CHANGED", "warning", "2026-10-09T18:30:00.000Z"),
          event("BUTTON_PRESSED", "info", "2026-10-09T11:00:00.000Z"),
          event("DEVICE_OFFLINE", "warning", "2026-10-09T10:30:00.000Z"),
        ],
        commands: [],
      },
      30,
      NOW,
      TZ,
    );
    expect(h.rows.map((r) => r.label)).toEqual(["2026-10-09 Fri", "2026-10-10 Sat"]);
    expect(h.rows[1]!.temperature).toMatchObject({ min: 26, max: 34 });
    expect(h.rows[1]!.states.WARNING).toBeCloseTo(3 / 5);
    expect(h.events.map((e) => e.type)).toEqual(["STATE_CHANGED", "DEVICE_OFFLINE"]);
    expect(h.events[0]!.at).toBe("10-10 01:30");
    expect(h.eventCounts).toEqual({ STATE_CHANGED: 1, BUTTON_PRESSED: 1, DEVICE_OFFLINE: 1 });
    expect([h.hoursWithData, h.hoursInWindow]).toEqual([3, 720]);

    const text = historyText(h);
    expect(text).toContain("HISTORY of the last 30 day(s), 2026-09-11 15:00 → 2026-10-11 15:00");
    expect(text).toContain("2026-10-10 Sat (readings in 2 of 24 h) | T 26.0/32.4/34.0°C");
    expect(text).toContain("not normal: WARNING 60%");
    expect(text).toContain("10-10 01:30 warning STATE_CHANGED: STATE_CHANGED happened");
    expect(text).toContain("device offline: 10-09 17:30 → still offline (46 h)")
  });

  it("uses local hours for a window of two days or less, and says when there is no data", () => {
    const h = buildHistory({ rollups: [hourRollup("2026-10-11T06")], events: [], commands: [] }, 1, NOW, TZ);
    expect(h.rows.map((r) => r.label)).toEqual(["10-11 13h"]);
    const empty = buildHistory({ rollups: [], events: [], commands: [] }, 7, NOW, TZ);
    expect(empty.overall).toBeNull();
    expect(historyText(empty)).toContain("(no readings at all)");
    const outage = buildHistory(
      {
        rollups: [],
        events: [event("DEVICE_ONLINE", "info", "2026-10-11T02:00:00.000Z"), event("DEVICE_OFFLINE", "warning", "2026-10-10T23:00:00.000Z")],
        commands: [],
      },
      1,
      NOW,
      TZ,
    );
    expect(outage.offline).toEqual([{ from: "10-11 06:00", to: "10-11 09:00", minutes: 180 }]);
    expect(historyText(outage)).toContain("device offline: 10-11 06:00 → 10-11 09:00 (3 h)");
  });
});
