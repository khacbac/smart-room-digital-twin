"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CommandAction,
  CommandRecord,
  CommandStatus,
  ReportedState,
} from "@srdt/contracts";
import {
  ArrowUpRight,
  History,
  PanelsTopLeft,
  RotateCcw,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import { ApiError, sendCommand, type CommandBody } from "@/lib/api";
import { clockTime, toMs, windowLabel } from "@/lib/format";
import { useToast } from "./Toasts";

// Manual control: POST → the button stays pending until the command is final → toast.
// The actuator state itself comes from the device's reported state, never assumed here.

type Group = "window" | "buzzer" | "all";

const ACTION_LABEL: Record<CommandAction, string> = {
  OPEN_WINDOW: "Open window",
  CLOSE_WINDOW: "Close window",
  BUZZER_ON: "Turn alarm on",
  BUZZER_OFF: "Silence alarm",
  CLEAR_OVERRIDE: "Resume automatic control",
  PING: "Check connection",
};

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
      const took =
        created !== null && acked !== null
          ? ` in ${((acked - created) / 1000).toFixed(1)} s`
          : "";
      return `${ACTION_LABEL[c.action]} completed${took}`;
    }
    case "rejected":
      return `${ACTION_LABEL[c.action]} rejected by the device (${c.reason ?? "no reason"})`;
    case "failed":
      return `${ACTION_LABEL[c.action]} failed (${c.reason ?? "unknown"})`;
    case "timeout":
      return `${ACTION_LABEL[c.action]}: device did not respond in time`;
    default:
      return `${ACTION_LABEL[c.action]} ${c.status}`;
  }
}

/** Sends a command and toasts its final status. */
export function useCommandSender(
  deviceCode: string,
  commands: CommandRecord[],
) {
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
      if (known && !isOpen(known.status))
        toast(
          known.status === "executed" ? "success" : "error",
          resultText(known),
        );
      else if (isOpen(res.status)) awaited.current.add(res.commandId);
      else
        toast(
          res.status === "executed" ? "success" : "error",
          `${ACTION_LABEL[body.action]} ${res.status}`,
        );
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
      toast("error", `${ACTION_LABEL[body.action]}: ${text}`);
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
  icon: LucideIcon;
  tone?: "danger";
  value?: number;
  online: boolean;
  sender: ReturnType<typeof useCommandSender>;
}) {
  const isBusy = props.sender.busy(props.action);
  const Icon = props.icon;
  return (
    <button
      type="button"
      className={`button${props.quiet ? " button-quiet" : ""}${props.tone === "danger" ? " button-danger" : ""}`}
      disabled={!props.online || isBusy}
      onClick={() =>
        void props.sender.send({
          action: props.action,
          value: props.value,
          source: "dashboard",
        })
      }
    >
      {isBusy && props.online ? (
        <span className="spinner" aria-label="pending" />
      ) : (
        <Icon size={16} aria-hidden="true" />
      )}
      {props.label}
    </button>
  );
}

export function Controls(props: {
  commands: CommandRecord[];
  online: boolean;
  sender: ReturnType<typeof useCommandSender>;
  windowAngle: number | null;
  buzzer: boolean | null;
  override: ReportedState["override"] | undefined;
}) {
  const [angle, setAngle] = useState(90);
  const recent = props.commands.slice(0, 6);
  const common = { online: props.online, sender: props.sender };

  return (
    <section
      className="card control-card"
      id="controls"
      aria-label="Room controls"
    >
      <div className="card-head">
        <div>
          <h2>Room controls</h2>
          <p className="section-description">
            Make your space feel just right.
          </p>
        </div>
        <SlidersHorizontal size={19} className="muted" aria-hidden="true" />
      </div>
      {!props.online && (
        <p className="control-offline">
          Your device is offline. Controls will be available when it reconnects.
        </p>
      )}
      <div className="control-group-heading">
        <span className="control-icon">
          <PanelsTopLeft size={19} aria-hidden="true" />
        </span>
        <div>
          <h3>Window</h3>
          <span className="small muted">{windowLabel(props.windowAngle)}</span>
        </div>
        <span className="tag">
          {props.override
            ? props.override.window
              ? "Manual"
              : "Auto"
            : "Unknown"}
        </span>
      </div>
      <label className="angle">
        <span className="small muted">Opening angle</span>
        <input
          type="range"
          min={1}
          max={90}
          value={angle}
          onChange={(e) => setAngle(Number(e.target.value))}
          disabled={!props.online}
        />
        <span className="angle-value">{angle}°</span>
      </label>
      <div className="controls">
        <ActionButton
          action="OPEN_WINDOW"
          label={`Open ${angle}°`}
          icon={ArrowUpRight}
          value={angle}
          {...common}
        />
        <ActionButton
          action="CLOSE_WINDOW"
          label="Close"
          icon={PanelsTopLeft}
          quiet
          {...common}
        />
      </div>
      <div className="control-group-heading alarm-heading">
        <span className="control-icon">
          <Volume2 size={19} aria-hidden="true" />
        </span>
        <div>
          <h3>Room alarm</h3>
          <span className="small muted">
            {props.buzzer == null
              ? "Awaiting device status"
              : props.buzzer
                ? "Alarm is sounding"
                : "Alarm is off"}
          </span>
        </div>
        <span className="tag">
          {props.override
            ? props.override.buzzer
              ? "Manual"
              : "Auto"
            : "Unknown"}
        </span>
      </div>
      <div className="controls">
        <ActionButton
          action="BUZZER_ON"
          label="Turn on"
          icon={Volume2}
          tone="danger"
          quiet
          {...common}
        />
        <ActionButton
          action="BUZZER_OFF"
          label="Silence"
          icon={VolumeX}
          quiet
          {...common}
        />
      </div>
      <div className="auto-control">
        <ActionButton
          action="CLEAR_OVERRIDE"
          label="Resume automatic control"
          icon={RotateCcw}
          quiet
          {...common}
        />
        <p className="small muted">
          Manual changes last 2 minutes, then automatic control resumes.
        </p>
      </div>
      <details className="command-history">
        <summary>
          <History size={15} aria-hidden="true" />
          Recent commands<span className="tag">{recent.length}</span>
        </summary>
        {recent.length === 0 ? (
          <p className="muted small">No commands yet.</p>
        ) : (
          <ul className="list">
            {recent.map((c) => (
              <li key={c.id} className="list-row">
                <span className="command-name" title={c.action}>
                  {ACTION_LABEL[c.action]}
                  {c.value != null && ` ${c.value}°`}
                </span>
                <span className={`pill ${STATUS_CLASS[c.status]}`}>
                  {c.status}
                </span>
                {c.reason && (
                  <span className="muted small command-reason">{c.reason}</span>
                )}
                <span className="muted small mono">
                  {clockTime(c.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
