import { config } from "../config";
import { backendSource } from "./backend-sse";
import { firestoreSource } from "./firestore";
import type { TwinSource } from "./types";

export type { ConnectionState, TwinSource } from "./types";

export const twinSource: TwinSource = config.dataSource === "firestore" ? firestoreSource : backendSource;
