import { config } from "../config";
import { backendSource } from "./backend-sse";
import { firestoreSource } from "./firestore";
import type { TwinSource } from "@srdt/twin-core";

export type { ConnectionState, TwinSource } from "@srdt/twin-core";

export const twinSource: TwinSource = config.dataSource === "firestore" ? firestoreSource : backendSource;
