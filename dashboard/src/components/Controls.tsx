"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CommandAction,
  CommandRecord,
  CommandStatus,
  ReportedState,
} from "@srdt/contracts";
import {
  ACTION_LABEL,
  apiErrorText,
  clockTime,
  isBusy,
  isOpenStatus as isOpen,
  resultText,
  windowLabel,
} from "@srdt/twin-core";
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
import { useToast } from "./Toasts";

// Manual control: POST → the button stays pending until the command is final → toast.
// The actuator state itself comes from the device's reported state, never assumed here.

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
          ? apiErrorText(err.code, err.message)
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
  const busy = (action: CommandAction) =>
    isBusy(action, requesting, commands);

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
