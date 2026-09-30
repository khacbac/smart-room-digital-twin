import type { TwinSource } from "./types";

// ─── MOCK / PLACEHOLDER ────────────────────────────────────────────────────────────
// Firestore data source, for the cloud team. Selected with NEXT_PUBLIC_DATA_SOURCE=firestore.
// It only reports that it is not implemented yet.
//
// Suggested implementation (data model in docs/cloud.md):
//
//   pnpm --filter @srdt/dashboard add firebase
//   src/lib/firebase.ts → initializeApp({ apiKey, authDomain, projectId, … }) from NEXT_PUBLIC_FIREBASE_*
//
//   subscribe(code, h):
//     1. getDoc(devices/{code}) + the three queries below with getDocs → h.onMessage({ type: "snapshot", … })
//     2. onSnapshot(doc(devices/{code}))                               → { type: "device" }
//        onSnapshot(query(devices/{code}/telemetry, orderBy("measuredAt","desc"), limit(1)))
//                                                                      → { type: "telemetry" }
//        onSnapshot(query(devices/{code}/events,  orderBy("createdAt","desc"), limit(20)))
//                                                                      → { type: "event" } per added doc
//        onSnapshot(query(commands, where("deviceCode","==",code), orderBy("createdAt","desc"), limit(20)))
//                                                                      → { type: "command" } per added/modified doc
//     3. return () => every unsubscribe()
//
// Note: Firestore only has the *downsampled* telemetry (≈ every 5 s). If the value cards
// must stay at 2 s, keep the backend SSE for telemetry and use Firestore for the rest.
// Commands are still sent through the backend API (src/lib/api.ts) in both cases.
// ───────────────────────────────────────────────────────────────────────────────────

export const firestoreSource: TwinSource = {
  name: "firestore",
  subscribe(_deviceCode, h) {
    h.onError("Firestore data source is not implemented yet (dashboard/src/lib/datasource/firestore.ts)");
    return () => undefined;
  },
};
