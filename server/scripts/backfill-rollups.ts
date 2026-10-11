import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import type { TelemetryRecord, TelemetryRollup } from "@srdt/contracts";
import { createFirestoreStorage } from "../src/storage/firestore/firestore.storage";
import { addSample, emptyRollup, hourOf } from "../src/telemetry/rollup.service";

// One-off: builds the hourly rollups (devices/{code}/rollups) from the telemetry already in
// Firestore, so the assistant can answer about the days before rollups existed. Stops at
// the current hour, which the running backend is filling itself. Safe to run again: each
// past hour is recomputed from its samples and replaced.
//
//   pnpm --filter @srdt/server backfill-rollups           (last 30 days, every device)
//   DAYS=7 DEVICE=room-01 pnpm --filter @srdt/server backfill-rollups

try {
  process.loadEnvFile();
} catch {
  // no .env: use the environment
}

const projectId = process.env.GCP_PROJECT_ID;
if (!projectId) {
  console.error("GCP_PROJECT_ID is not set");
  process.exit(1);
}
const days = Number(process.env.DAYS ?? 30);
const databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";
const PAGE = 5000;

const app = process.env.FIRESTORE_EMULATOR_HOST
  ? initializeApp({ projectId }, "backfill")
  : initializeApp({ credential: applicationDefault(), projectId }, "backfill");
const db = getFirestore(app, databaseId);
const storage = createFirestoreStorage({ projectId, databaseId: process.env.FIRESTORE_DATABASE_ID });

const since = new Date(Date.now() - days * 24 * 3_600_000).toISOString();
const currentHour = hourOf(new Date().toISOString());
const codes = process.env.DEVICE ? [process.env.DEVICE] : (await db.collection("devices").get()).docs.map((d) => d.id);

for (const code of codes) {
  const hours = new Map<string, TelemetryRollup>();
  let read = 0;
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    let query = db
      .collection("devices")
      .doc(code)
      .collection("telemetry")
      .where("measuredAt", ">=", since)
      .where("measuredAt", "<", `${currentHour}:00:00.000Z`)
      .orderBy("measuredAt")
      .limit(PAGE);
    if (last) query = query.startAfter(last);
    const snap = await query.get();
    for (const doc of snap.docs) {
      const t = doc.data() as TelemetryRecord;
      const hour = hourOf(t.measuredAt);
      let r = hours.get(hour);
      if (!r) hours.set(hour, (r = emptyRollup(code, hour)));
      addSample(r, t);
    }
    read += snap.size;
    if (snap.size < PAGE) break;
    last = snap.docs.at(-1)!;
    process.stdout.write(`\r${code}: ${read} samples read`);
  }
  const now = new Date().toISOString();
  for (const r of hours.values()) await storage.rollups.put({ ...r, updatedAt: now });
  console.log(`\r${code}: ${read} samples → ${hours.size} hourly rollups`);
}

await storage.close();
await deleteApp(app);
