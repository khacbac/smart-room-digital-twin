"use client";

import { useEffect, useRef, useState } from "react";
import type { CommandAction, CommandRecord, CommandStatus } from "@srdt/contracts";
import { ApiError, sendCommand, type CommandBody } from "@/lib/api";
import { clockTime, toMs } from "@/lib/format";
import { useToast } from "./Toasts";

// Manual control: POST → the button stays pending until the command is final → toast.
// The actuator state itself comes from the device's reported state, never assumed here.

type Group = "window" | "buzzer" | "all";

const GROUP: Record<CommandAction, Group | null> = {
  OPEN_WINDOW: "window",
  CLOSE_WINDOW: "window",
  BUZZER_ON: "buzzer",
  BUZZER_OFF: "buzzer",
  CLEAR_OVERRIDE: "all",
  PING: null,
};

const isOpen = (s: CommandStatus) => s === "pending" || s === "sent";

function conflicts(a: Group | null, b: Group | null): boolean {
  if (!a || !b) return false;
  return a === "all" || b === "all" || a === b;
}

function resultText(c: CommandRecord): string {
  switch (c.status) {
    case "executed": {
      const created = toMs(c.createdAt);
      const acked = toMs(c.ackedAt);
      const took = created !== null && acked !== null ? ` in ${((acked - created) / 1000).toFixed(1)} s` : "";
      return `${c.action} executed${took}`;
    }
    case "rejected":
      return `${c.action} rejected by the device (${c.reason ?? "no reason"})`;
    case "failed":
      return `${c.action} failed (${c.reason ?? "unknown"})`;
    case "timeout":
      return `${c.action}: no ack from the device (timeout)`;
    default:
      return `${c.action} ${c.status}`;
  }
}

/** Sends a command and toasts its final status. */
export function useCommandSender(deviceCode: string, commands: CommandRecord[]) {
  const toast = useToast();
  const awaited = useRef(new Set<string>());
  const latest = useRef(commands); // `send` must see records that arrived while the request ran
  const [requesting, setRequesting] = useState<CommandAction[]>([]);

  useEffect(() => {
    latest.current = commands;
    for (const c of commands) {
      if (awaited.current.has(c.id) && !isOpen(c.status)) {
        awaited.current.delete(c.id);
        toast(c.status === "executed" ? "success" : "error", resultText(c));
      }
    }
  }, [commands, toast]);

  const send = async (body: CommandBody) => {
    setRequesting((r) => [...r, body.action]);
    try {
      const res = await sendCommand(deviceCode, body);
      const known = latest.current.find((c) => c.id === res.commandId);
      if (known && !isOpen(known.status)) toast(known.status === "executed" ? "success" : "error", resultText(known));
      else if (isOpen(res.status)) awaited.current.add(res.commandId);
      else toast(res.status === "executed" ? "success" : "error", `${body.action} ${res.status}`);
    } catch (err) {
      const text =
        err instanceof ApiError
          ? err.code === "DEVICE_OFFLINE"
            ? "Device is offline"
            : err.code === "BROKER_DISCONNECTED"
              ? "Backend is not connected to the MQTT broker"
              : err.code === "RATE_LIMITED"
                ? "Too many commands, wait a moment"
                : err.message
          : String(err);
      toast("error", `${body.action}: ${text}`);
    } finally {
      setRequesting((r) => {
        const i = r.indexOf(body.action);
        return i < 0 ? r : [...r.slice(0, i), ...r.slice(i + 1)];
      });
    }
  };

  /** Busy while a request for a conflicting actuator is in flight or its command is still open. */
  const busy = (action: CommandAction) => {
    const g = GROUP[action];
    return (
      requesting.some((a) => conflicts(GROUP[a], g)) ||
      commands.some((c) => isOpen(c.status) && conflicts(GROUP[c.action], g))
    );
  };

  return { send, busy };
}

const STATUS_CLASS: Record<CommandStatus, string> = {
  pending: "pill-pending",
  sent: "pill-pending",
  executed: "pill-ok",
  rejected: "pill-bad",
  failed: "pill-bad",
  timeout: "pill-bad",
};

function ActionButton(props: {
  action: CommandAction;
  label: string;
  quiet?: boolean;
  value?: number;
  online: boolean;
  sender: ReturnType<typeof useCommandSender>;
}) {
  const isBusy = props.sender.busy(props.action);
  return (
    <button
      type="button"
      className={props.quiet ? "button button-quiet" : "button"}
      disabled={!props.online || isBusy}
      onClick={() => void props.sender.send({ action: props.action, value: props.value, source: "dashboard" })}
    >
      {isBusy && props.online ? <span className="spinner" aria-label="pending" /> : null}
      {props.label}
    </button>
  );
}

export function Controls(props: {
  commands: CommandRecord[];
  online: boolean;
  sender: ReturnType<typeof useCommandSender>;
}) {
  const [angle, setAngle] = useState(90);
  const recent = props.commands.slice(0, 6);
  const common = { online: props.online, sender: props.sender };

  return (
    <section className="card" aria-label="Controls">
      <div className="card-head">
        <h2>Controls</h2>
        {!props.online && <span className="muted">device offline</span>}
      </div>

      <label className="angle">
        <span className="small muted">Window angle</span>
        <input
          type="range"
          min={1}
          max={90}
          value={angle}
          onChange={(e) => setAngle(Number(e.target.value))}
          disabled={!props.online}
        />
        <span className="mono small">{angle}°</span>
      </label>
      <div className="controls">
        <ActionButton action="OPEN_WINDOW" label={`Open window ${angle}°`} value={angle} {...common} />
        <ActionButton action="CLOSE_WINDOW" label="Close window" {...common} />
        <ActionButton action="BUZZER_ON" label="Buzzer on" {...common} />
        <ActionButton action="BUZZER_OFF" label="Buzzer off" {...common} />
        <ActionButton action="CLEAR_OVERRIDE" label="Clear override (back to auto)" quiet {...common} />
      </div>

      <h3 className="subhead">Recent commands</h3>
      {recent.length === 0 ? (
        <p className="muted small">No commands yet.</p>
      ) : (
        <ul className="list">
          {recent.map((c) => (
            <li key={c.id} className="list-row">
              <span className="mono">
                {c.action}
                {c.value != null && ` ${c.value}°`}
              </span>
              <span className={`pill ${STATUS_CLASS[c.status]}`}>{c.status}</span>
              <span className="muted small grow">{c.reason ?? (c.source !== "dashboard" ? c.source : "")}</span>
              <span className="muted small mono">{clockTime(c.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
