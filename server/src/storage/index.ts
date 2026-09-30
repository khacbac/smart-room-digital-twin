import type { Config } from "../config/env";
import { createFirestoreStorage } from "./firestore/firestore.storage";
import { createMemoryStorage } from "./memory/memory.storage";
import type { Storage } from "./types";

export type { Storage } from "./types";

/** `STORAGE_DRIVER`: `memory` (default, works today) or `firestore` (stub for the cloud team). */
export function createStorage(config: Config): Storage {
  switch (config.STORAGE_DRIVER) {
    case "memory":
      return createMemoryStorage();
    case "firestore":
      return createFirestoreStorage({ projectId: config.GCP_PROJECT_ID });
  }
}
