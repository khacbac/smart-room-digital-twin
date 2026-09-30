import type { Storage } from "../types";

// ─── MOCK / PLACEHOLDER ────────────────────────────────────────────────────────────
// Firestore driver, to be written by the cloud team. Nothing here talks to Google Cloud
// yet: `STORAGE_DRIVER=firestore` starts the backend with this stub, and every call
// throws, so the gap is obvious instead of silently losing data.
//
// Suggested implementation (see docs/cloud.md for the full data model):
//
//   pnpm --filter @srdt/server add firebase-admin
//
//   import { initializeApp, applicationDefault } from "firebase-admin/app";
//   import { getFirestore, FieldValue } from "firebase-admin/firestore";
//
//   const app = initializeApp({ credential: applicationDefault(), projectId: opts.projectId });
//   const db = getFirestore(app);
//
//   devices   → devices/{code}                               (put = set(), list = get())
//   telemetry → devices/{code}/telemetry/{bootId}-{seq}       (id makes duplicates idempotent)
//   events    → devices/{code}/events/{id}
//   commands  → commands/{id}   with field deviceCode         (transition = runTransaction:
//               read → check status ∈ from → update → return, else null)
//
//   recent(...)       → where/orderBy/limit queries (add composite indexes in
//                       cloud/firebase/firestore.indexes.json)
//   listOpenBefore()  → where("status", "in", ["pending","sent"]).where("createdAt", "<", iso)
//
// Keep writes cheap: the telemetry service already downsamples (TELEMETRY_PERSIST_INTERVAL_SEC)
// before calling `telemetry.append`, so Firestore gets ~1 write / 5 s / device, not one per MQTT message.
// ───────────────────────────────────────────────────────────────────────────────────

export interface FirestoreOptions {
  projectId?: string;
}

function notImplemented(what: string): never {
  throw new Error(`firestore storage: ${what} is not implemented yet (see server/src/storage/firestore)`);
}

export function createFirestoreStorage(_opts: FirestoreOptions): Storage {
  return {
    driver: "firestore (stub)",
    devices: {
      list: async () => notImplemented("devices.list"),
      get: async () => notImplemented("devices.get"),
      put: async () => notImplemented("devices.put"),
    },
    telemetry: {
      append: async () => notImplemented("telemetry.append"),
      recent: async () => notImplemented("telemetry.recent"),
    },
    events: {
      append: async () => notImplemented("events.append"),
      recent: async () => notImplemented("events.recent"),
    },
    commands: {
      insert: async () => notImplemented("commands.insert"),
      transition: async () => notImplemented("commands.transition"),
      get: async () => notImplemented("commands.get"),
      listOpenBefore: async () => notImplemented("commands.listOpenBefore"),
      recent: async () => notImplemented("commands.recent"),
    },
    ping: async () => false,
    close: async () => undefined,
  };
}
