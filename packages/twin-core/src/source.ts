import type { StreamMessage } from "@srdt/contracts";

// Where a client reads the twin from. Today: our backend (snapshot + SSE). Each app brings
// its own implementation (browser EventSource, react-native-sse, later Firestore) and turns
// it into the same StreamMessages, so nothing above this interface has to change.

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
