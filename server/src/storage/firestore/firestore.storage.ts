import { randomUUID } from "node:crypto";
import { applicationDefault, deleteApp, initializeApp, type App } from "firebase-admin/app";
import {
  getFirestore,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Transaction,
} from "firebase-admin/firestore";
import type { CommandRecord, CommandStatus, DeviceRecord, EventRecord, TelemetryRecord } from "@srdt/contracts";
import type { CommandStore, DeviceStore, EventStore, NewCommand, Storage, TelemetryStore } from "../types";

// Cloud Firestore driver. Same observable behaviour as the in-memory driver (see
// memory/memory.storage.ts), so services never learn which one they are talking to.
// Layout — docs/cloud.md §2:
//
//   devices/{code}
//   devices/{code}/telemetry/{bootId}-{seq}   id is derived, so an MQTT redelivery is idempotent
//   devices/{code}/events/{id}
//   commands/{id}                             flat, with a `deviceCode` field
//
// Records are stored exactly as `@srdt/contracts` defines them: timestamps stay ISO
// strings, which sort lexicographically the same way they sort chronologically, so range
// queries and `orderBy` work without a Timestamp converter.

export interface FirestoreOptions {
  projectId: string;
  /** Named database; defaults to the project's `(default)` one. */
  databaseId?: string;
}

const DEFAULT_DATABASE_ID = "(default)";

const data = <T>(snap: DocumentSnapshot): T => snap.data() as T;
const rows = <T>(snap: QuerySnapshot): T[] => snap.docs.map((d: QueryDocumentSnapshot) => d.data() as T);

class FirestoreDevices implements DeviceStore {
  constructor(private readonly db: Firestore) {}

  private get col() {
    return this.db.collection("devices");
  }

  async list() {
    // Sorted here rather than with `orderBy` so the order matches the in-memory driver's
    // `localeCompare`, and because the collection holds a handful of documents.
    return rows<DeviceRecord>(await this.col.get()).sort((a, b) => a.code.localeCompare(b.code));
  }

  async get(code: string) {
    const snap = await this.col.doc(code).get();
    return snap.exists ? data<DeviceRecord>(snap) : null;
  }

  async put(device: DeviceRecord) {
    await this.col.doc(device.code).set(device);
  }
}

class FirestoreTelemetry implements TelemetryStore {
  constructor(private readonly db: Firestore) {}

  private col(deviceCode: string) {
    return this.db.collection("devices").doc(deviceCode).collection("telemetry");
  }

  async append(record: TelemetryRecord) {
    await this.col(record.deviceCode).doc(record.id).set(record);
  }

  async recent(deviceCode: string, since: Date, limit: number) {
    // `limit` applies to the *newest* samples in the window, so take them descending and
    // flip, matching the in-memory `slice(-limit)`.
    const snap = await this.col(deviceCode)
      .where("measuredAt", ">=", since.toISOString())
      .orderBy("measuredAt", "desc")
      .limit(limit)
      .get();
    return rows<TelemetryRecord>(snap).reverse();
  }
}

class FirestoreEvents implements EventStore {
  constructor(private readonly db: Firestore) {}

  private col(deviceCode: string) {
    return this.db.collection("devices").doc(deviceCode).collection("events");
  }

  async append(record: EventRecord) {
    await this.col(record.deviceCode).doc(record.id).set(record);
  }

  async recent(deviceCode: string, limit: number) {
    const snap = await this.col(deviceCode).orderBy("createdAt", "desc").limit(limit).get();
    return rows<EventRecord>(snap);
  }
}

class FirestoreCommands implements CommandStore {
  constructor(
    private readonly db: Firestore,
    private readonly now: () => number,
  ) {}

  private get col() {
    return this.db.collection("commands");
  }

  async insert(cmd: NewCommand) {
    // The id must be a UUID: `CommandService.handleAck` rejects any other shape, so an
    // auto-generated Firestore id would make every ack look like garbage from the device.
    const row: CommandRecord = {
      id: randomUUID(),
      ...cmd,
      status: "pending",
      reason: null,
      ack: null,
      createdAt: new Date(this.now()).toISOString(),
      sentAt: null,
      ackedAt: null,
    };
    await this.col.doc(row.id).set(row);
    return row;
  }

  async transition(
    id: string,
    from: readonly CommandStatus[],
    patch: Partial<Omit<CommandRecord, "id" | "deviceCode" | "createdAt">>,
  ) {
    const ref = this.col.doc(id);
    // Compare-and-set, so the `sent` write and a racing ack cannot clobber each other (§6.6).
    return this.db.runTransaction<CommandRecord | null>(async (tx: Transaction) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const current = data<CommandRecord>(snap);
      if (!from.includes(current.status)) return null;
      const next: CommandRecord = {
        ...current,
        ...patch,
        id: current.id,
        deviceCode: current.deviceCode,
        createdAt: current.createdAt,
      };
      tx.set(ref, next);
      return next;
    });
  }

  async get(id: string) {
    const snap = await this.col.doc(id).get();
    return snap.exists ? data<CommandRecord>(snap) : null;
  }

  async listOpenBefore(before: Date) {
    const snap = await this.col
      .where("status", "in", ["pending", "sent"])
      .where("createdAt", "<", before.toISOString())
      .get();
    return rows<CommandRecord>(snap);
  }

  async recent(deviceCode: string, limit: number) {
    const snap = await this.col
      .where("deviceCode", "==", deviceCode)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return rows<CommandRecord>(snap);
  }
}

function createApp(opts: FirestoreOptions): App {
  // A unique name keeps several instances (tests, emulator) from sharing one app.
  const name = `srdt-firestore-${randomUUID()}`;
  // The emulator needs no credentials; against the real service the Admin SDK reads
  // GOOGLE_APPLICATION_CREDENTIALS (see server/.env.example).
  return process.env.FIRESTORE_EMULATOR_HOST
    ? initializeApp({ projectId: opts.projectId }, name)
    : initializeApp({ credential: applicationDefault(), projectId: opts.projectId }, name);
}

export function createFirestoreStorage(opts: FirestoreOptions, now: () => number = Date.now): Storage {
  const app = createApp(opts);
  const db = getFirestore(app, opts.databaseId ?? DEFAULT_DATABASE_ID);
  // `EventRecord.data` is open-shaped and optional fields elsewhere can be undefined;
  // without this the first such write throws instead of simply omitting the field.
  db.settings({ ignoreUndefinedProperties: true });

  return {
    driver: "firestore",
    devices: new FirestoreDevices(db),
    telemetry: new FirestoreTelemetry(db),
    events: new FirestoreEvents(db),
    commands: new FirestoreCommands(db, now),
    async ping() {
      try {
        await db.collection("devices").limit(1).get();
        return true;
      } catch {
        return false;
      }
    },
    close: () => deleteApp(app),
  };
}
