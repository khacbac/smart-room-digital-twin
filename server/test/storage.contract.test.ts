import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { DeviceRecord, EventRecord, TelemetryRecord } from "@srdt/contracts";
import { createFirestoreStorage } from "../src/storage/firestore/firestore.storage";
import { DEFAULT_MEMORY_LIMITS, createMemoryStorage } from "../src/storage/memory/memory.storage";
import type { Storage } from "../src/storage/types";

// One suite, every driver. The services only know the `Storage` interface, so a driver is
// only a drop-in replacement if it is observably identical here.
//
// The Firestore cases need an emulator and are skipped without one, so `pnpm test` stays
// green on a machine with no firebase-tools:
//
//   pnpm --filter @srdt/server test:firestore

const clock = { ms: Date.parse("2026-09-30T10:00:00.000Z") };
const now = () => clock.ms;
const at = (offsetMs: number) => new Date(clock.ms + offsetMs).toISOString();

/** A fresh device code per test keeps the shared emulator database from leaking between them. */
const newCode = () => `dev-${randomUUID().slice(0, 8)}`;

function device(code: string, overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    code,
    name: code,
    presence: "online",
    edgeState: "NORMAL",
    fwVersion: "0.2.0",
    bootId: "a1b2c3d4",
    reported: null,
    lastSeenAt: at(0),
    createdAt: at(0),
    updatedAt: at(0),
    ...overrides,
  };
}

function telemetry(code: string, seq: number, measuredAt: string): TelemetryRecord {
  return {
    id: `a1b2c3d4-${seq}`,
    deviceCode: code,
    bootId: "a1b2c3d4",
    seq,
    measuredAt,
    receivedAt: measuredAt,
    temperature: 25 + seq,
    humidity: 60,
    light: 300,
    airQuality: 120,
    presence: true,
    edgeState: "NORMAL",
    windowAngle: 0,
    buzzer: false,
    overrideActive: false,
  };
}

function event(code: string, id: string, createdAt: string): EventRecord {
  return {
    id,
    deviceCode: code,
    source: "device",
    bootId: "a1b2c3d4",
    seq: 1,
    type: "STATE_CHANGED",
    severity: "info",
    message: "state changed",
    // Open-shaped on purpose (§5.5): the driver must store whatever the device sent.
    data: { from: "NORMAL", to: "WARNING", nested: { ok: true } },
    measuredAt: createdAt,
    createdAt,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const drivers: { name: string; skip: boolean; create: () => Storage }[] = [
  {
    name: "memory",
    skip: false,
    create: () => createMemoryStorage(DEFAULT_MEMORY_LIMITS, now),
  },
  {
    name: "firestore",
    skip: !process.env.FIRESTORE_EMULATOR_HOST,
    create: () => createFirestoreStorage({ projectId: "srdt-contract-test" }, now),
  },
];

for (const driver of drivers) {
  describe.skipIf(driver.skip)(`storage contract: ${driver.name}`, () => {
    const storage = driver.create();
    afterAll(() => storage.close());

    it("reports a healthy connection", async () => {
      expect(await storage.ping()).toBe(true);
    });

    it("stores devices and lists them by code", async () => {
      const a = newCode();
      const b = newCode();
      await storage.devices.put(device(b));
      await storage.devices.put(device(a));

      expect(await storage.devices.get(a)).toEqual(device(a));
      expect(await storage.devices.get(newCode())).toBeNull();

      const codes = (await storage.devices.list()).map((d) => d.code);
      expect(codes).toEqual([...codes].sort());
      expect(codes).toContain(a);
      expect(codes).toContain(b);
    });

    it("replaces the device document on put", async () => {
      const code = newCode();
      await storage.devices.put(device(code));
      await storage.devices.put(device(code, { presence: "offline", lastSeenAt: null }));

      const stored = await storage.devices.get(code);
      expect(stored?.presence).toBe("offline");
      expect(stored?.lastSeenAt).toBeNull();
    });

    it("ignores a redelivered telemetry sample", async () => {
      const code = newCode();
      const sample = telemetry(code, 1, at(0));
      await storage.telemetry.append(sample);
      await storage.telemetry.append(sample); // MQTT QoS 1 can deliver twice

      const stored = await storage.telemetry.recent(code, new Date(clock.ms - 60_000), 100);
      expect(stored).toEqual([sample]);
    });

    it("returns the newest telemetry inside the window, oldest first", async () => {
      const code = newCode();
      for (let seq = 0; seq < 5; seq += 1) {
        await storage.telemetry.append(telemetry(code, seq, at(seq * 1000)));
      }

      const all = await storage.telemetry.recent(code, new Date(clock.ms), 100);
      expect(all.map((r) => r.seq)).toEqual([0, 1, 2, 3, 4]);

      // `limit` keeps the newest samples, but the result still reads oldest → newest.
      const capped = await storage.telemetry.recent(code, new Date(clock.ms), 2);
      expect(capped.map((r) => r.seq)).toEqual([3, 4]);

      // `since` is inclusive and cuts off everything older.
      const windowed = await storage.telemetry.recent(code, new Date(clock.ms + 3000), 100);
      expect(windowed.map((r) => r.seq)).toEqual([3, 4]);
    });

    it("returns events newest first and keeps open-shaped data intact", async () => {
      const code = newCode();
      const first = event(code, `a1b2c3d4-1`, at(0));
      const second = event(code, `a1b2c3d4-2`, at(1000));
      await storage.events.append(first);
      await storage.events.append(second);

      const stored = await storage.events.recent(code, 10);
      expect(stored.map((e) => e.id)).toEqual([second.id, first.id]);
      expect(stored[1]).toEqual(first);

      expect((await storage.events.recent(code, 1)).map((e) => e.id)).toEqual([second.id]);
    });

    it("creates commands pending, with a UUID id", async () => {
      const code = newCode();
      const cmd = await storage.commands.insert({
        deviceCode: code,
        action: "OPEN_WINDOW",
        value: 45,
        source: "dashboard",
      });

      // Not cosmetic: CommandService.handleAck drops any commandId that is not a UUID.
      expect(cmd.id).toMatch(UUID_RE);
      expect(cmd).toEqual({
        id: cmd.id,
        deviceCode: code,
        action: "OPEN_WINDOW",
        value: 45,
        source: "dashboard",
        status: "pending",
        reason: null,
        ack: null,
        createdAt: at(0),
        sentAt: null,
        ackedAt: null,
      });
      expect(await storage.commands.get(cmd.id)).toEqual(cmd);
    });

    it("applies a transition only from an expected status", async () => {
      const code = newCode();
      const cmd = await storage.commands.insert({
        deviceCode: code,
        action: "BUZZER_OFF",
        value: null,
        source: "dashboard",
      });

      const sent = await storage.commands.transition(cmd.id, ["pending"], {
        status: "sent",
        sentAt: at(1000),
      });
      expect(sent).toMatchObject({ status: "sent", sentAt: at(1000) });

      // Already `sent`: a second `pending → sent` must not apply.
      expect(await storage.commands.transition(cmd.id, ["pending"], { status: "sent" })).toBeNull();
      expect(await storage.commands.transition(randomUUID(), ["pending"], { status: "sent" })).toBeNull();

      // Immutable columns survive a patch that tries to change them.
      const patched = await storage.commands.transition(cmd.id, ["sent"], {
        status: "executed",
        ackedAt: at(2000),
      } as never);
      expect(patched).toMatchObject({
        id: cmd.id,
        deviceCode: code,
        createdAt: cmd.createdAt,
        status: "executed",
      });
    });

    it("lets only one of two concurrent transitions win", async () => {
      const code = newCode();
      const cmd = await storage.commands.insert({
        deviceCode: code,
        action: "PING",
        value: null,
        source: "api",
      });

      // §6.6: the ack can arrive before the `sent` write lands.
      const results = await Promise.all([
        storage.commands.transition(cmd.id, ["pending"], { status: "sent", sentAt: at(10) }),
        storage.commands.transition(cmd.id, ["pending"], { status: "executed", ackedAt: at(10) }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("lists only open commands created before the cutoff", async () => {
      const code = newCode();
      const base = { deviceCode: code, value: null, source: "dashboard" } as const;
      const pending = await storage.commands.insert({ ...base, action: "PING" });
      const sent = await storage.commands.insert({ ...base, action: "BUZZER_ON" });
      const done = await storage.commands.insert({ ...base, action: "BUZZER_OFF" });
      await storage.commands.transition(sent.id, ["pending"], { status: "sent", sentAt: at(0) });
      await storage.commands.transition(done.id, ["pending"], { status: "executed", ackedAt: at(0) });

      // The sweep is global, so narrow it to this test's device.
      const open = (await storage.commands.listOpenBefore(new Date(clock.ms + 1000))).filter(
        (c) => c.deviceCode === code,
      );
      expect(open.map((c) => c.id).sort()).toEqual([pending.id, sent.id].sort());

      const none = (await storage.commands.listOpenBefore(new Date(clock.ms))).filter(
        (c) => c.deviceCode === code,
      );
      expect(none).toEqual([]);
    });

    it("returns a device's commands newest first", async () => {
      const code = newCode();
      const base = { deviceCode: code, value: null, source: "dashboard" } as const;
      const first = await storage.commands.insert({ ...base, action: "BUZZER_ON" });
      clock.ms += 1000;
      const second = await storage.commands.insert({ ...base, action: "BUZZER_OFF" });
      clock.ms -= 1000;

      expect((await storage.commands.recent(code, 10)).map((c) => c.id)).toEqual([second.id, first.id]);
      expect((await storage.commands.recent(code, 1)).map((c) => c.id)).toEqual([second.id]);
      expect(await storage.commands.recent(newCode(), 10)).toEqual([]);
    });
  });
}
