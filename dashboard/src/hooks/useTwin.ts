"use client";

import { useEffect, useReducer } from "react";
import type { StreamMessage } from "@srdt/contracts";
import { applyMessage, initialTwinData, type ConnectionState, type TwinData } from "@srdt/twin-core";
import { twinSource } from "@/lib/datasource";

// The dashboard's copy of the twin: a snapshot, then every change from the data source.
// How a message changes the twin lives in @srdt/twin-core, shared with the app.

export interface TwinState extends TwinData {
  status: "loading" | "ready" | "error";
  error: string | null;
  connection: ConnectionState;
}

const initial: TwinState = {
  ...initialTwinData,
  status: "loading",
  error: null,
  connection: "connecting",
};

type Action =
  | { kind: "message"; msg: StreamMessage; at: number }
  | { kind: "connection"; state: ConnectionState }
  | { kind: "error"; message: string };

function reduce(state: TwinState, action: Action): TwinState {
  switch (action.kind) {
    case "connection":
      return { ...state, connection: action.state };
    case "error":
      // keep showing the last data if we had some; the banner shows the connection state
      return state.device ? state : { ...state, status: "error", error: action.message };
    case "message": {
      const next = applyMessage(state, action.msg, action.at);
      return action.msg.type === "snapshot" ? { ...next, status: "ready", error: null } : next;
    }
  }
}

export function useTwin(deviceCode: string): TwinState {
  const [state, dispatch] = useReducer(reduce, initial);

  useEffect(
    () =>
      twinSource.subscribe(deviceCode, {
        onMessage: (msg) => dispatch({ kind: "message", msg, at: Date.now() }),
        onConnection: (s) => dispatch({ kind: "connection", state: s }),
        onError: (message) => dispatch({ kind: "error", message }),
      }),
    [deviceCode],
  );

  return state;
}
