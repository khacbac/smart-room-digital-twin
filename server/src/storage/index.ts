import type { Config } from "../config/env";
import { createFirestoreStorage } from "./firestore/firestore.storage";
import { createMemoryStorage } from "./memory/memory.storage";
import type { Storage } from "./types";

export type { Storage } from "./types";

/** `STORAGE_DRIVER`: `memory` (default, lost on restart) or `firestore` (Cloud Firestore). */
export function createStorage(config: Config): Storage {
  switch (config.STORAGE_DRIVER) {
    case "memory":
      return createMemoryStorage();
    case "firestore":
      // `GCP_PROJECT_ID` is required for this driver (checked in config/env.ts).
      return createFirestoreStorage({
        projectId: config.GCP_PROJECT_ID!,
        databaseId: config.FIRESTORE_DATABASE_ID,
      });
  }
}
