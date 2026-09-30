import type { StreamMessage } from "@srdt/contracts";

// Where the dashboard reads the twin from. Today: our backend (REST snapshot + SSE).
// Later the cloud team can add a Firestore source that turns onSnapshot() callbacks into
// the same StreamMessages, and nothing in the components has to change.

export type ConnectionState = "connecting" | "live" | "reconnecting";

export interface TwinHandlers {
  /** The first message after every (re)connect must be a `snapshot`. */
  onMessage(msg: StreamMessage): void;
  onConnection(state: ConnectionState): void;
  /** Fatal-for-now problem to show (unknown device, backend down…). The source keeps retrying. */
  onError(message: string): void;
}

export interface TwinSource {
  readonly name: string;
  /** Starts listening to one device; returns the unsubscribe function. */
  subscribe(deviceCode: string, handlers: TwinHandlers): () => void;
}
