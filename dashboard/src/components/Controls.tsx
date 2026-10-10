"use client";

import { useEffect, useRef, useState } from "react";
import {
  MESSAGE_MAX,
  toDisplayText,
  type CommandAction,
  type CommandRecord,
  type CommandStatus,
  type ReportedState,
} from "@srdt/contracts";
import {
  ACTION_LABEL,
  SCENES,
  apiErrorText,
  clockTime,
  isBusy,
  isOpenStatus as isOpen,
  resultText,
  windowLabel,
  type Scene,
  type SceneId,
} from "@srdt/twin-core";
import {
  ArrowUpRight,
  BedDouble,
  Cpu,
  History,
  Lightbulb,
  PanelsTopLeft,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  VolumeX,
  Wind,
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
  const [runningScene, setRunningScene] = useState<SceneId | null>(null);

  useEffect(() => {
    latest.current = commands;
    for (const c of commands) {
      if (awaited.current.has(c.id) && !isOpen(c.status)) {
        awaited.current.delete(c.id);
        toast(c.status === "executed" ? "success" : "error", resultText(c));
      }
    }
  }, [commands, toast]);

  /** Resolves to false when the backend refused the command. */
  const send = async (body: CommandBody): Promise<boolean> => {
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
      return true;
    } catch (err) {
      const text =
        err instanceof ApiError
          ? apiErrorText(err.code, err.message)
          : String(err);
      toast("error", `${ACTION_LABEL[body.action]}: ${text}`);
      return false;
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

  /** A scene's steps one after the other; stops at the first refused one. */
  const runScene = async (scene: Scene) => {
    if (runningScene) return;
    setRunningScene(scene.id);
    try {
      for (const step of scene.steps) {
        if (!(await send({ ...step, source: "dashboard" }))) break;
      }
    } finally {
      setRunningScene(null);
    }
  };

  return { send, busy, runScene, runningScene };
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
  text?: string;
  disabled?: boolean;
  online: boolean;
  sender: ReturnType<typeof useCommandSender>;
}) {
  const isBusy = props.sender.busy(props.action);
  const Icon = props.icon;
  return (
    <button
      type="button"
      className={`button${props.quiet ? " button-quiet" : ""}${props.tone === "danger" ? " button-danger" : ""}`}
      disabled={!props.online || isBusy || props.disabled}
      onClick={() =>
        void props.sender.send({
          action: props.action,
          value: props.value,
          text: props.text,
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

const SCENE_ICON: Record<SceneId, LucideIcon> = {
  welcome: Sparkles,
  ventilate: Wind,
  sleep: BedDouble,
  auto: RotateCcw,
};

function Scenes(props: {
  online: boolean;
  sender: ReturnType<typeof useCommandSender>;
}) {
  const { runningScene, runScene } = props.sender;
  return (
    <div className="scenes" aria-label="Scenes">
      {SCENES.map((s) => {
        const Icon = SCENE_ICON[s.id];
        const running = runningScene === s.id;
        return (
          <button
            key={s.id}
            type="button"
            className={`scene${running ? " scene-running" : ""}`}
            disabled={!props.online || runningScene !== null}
            title={s.description}
            onClick={() => void runScene(s)}
          >
            {running ? (
              <span className="spinner" aria-label="pending" />
            ) : (
              <Icon size={16} aria-hidden="true" />
            )}
            <span className="scene-label">{s.label}</span>
            <span className="small muted scene-description">
              {s.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function BoardControls(props: {
  online: boolean;
  sender: ReturnType<typeof useCommandSender>;
}) {
  const [message, setMessage] = useState("");
  const shown = toDisplayText(message);
  const tooLong = shown.length > MESSAGE_MAX;
  const common = { online: props.online, sender: props.sender };
  return (
    <>
      <div className="control-group-heading alarm-heading">
        <span className="control-icon">
          <Cpu size={19} aria-hidden="true" />
        </span>
        <div>
          <h3>Board</h3>
          <span className="small muted">
            Message on the screen, or blink to find it
          </span>
        </div>
      </div>
      <form
        className="message-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!shown || tooLong || !props.online) return;
          void props.sender.send({
            action: "SHOW_MESSAGE",
            text: message,
            source: "dashboard",
          });
        }}
      >
        <input
          type="text"
          className={`message-input${tooLong ? " message-input-bad" : ""}`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Xin chào hội đồng!"
          aria-label="Message for the board screen"
          disabled={!props.online}
        />
        <span className={`small ${tooLong ? "message-count-bad" : "muted"}`}>
          {shown.length}/{MESSAGE_MAX}
        </span>
      </form>
      <p className="small muted message-preview">
        {shown ? `Shows: ${shown}` : "Accents are removed on the board."}
      </p>
      <div className="controls">
        <ActionButton
          action="SHOW_MESSAGE"
          label="Show"
          icon={Send}
          text={message}
          disabled={!shown || tooLong}
          {...common}
        />
        <ActionButton
          action="IDENTIFY"
          label="Identify"
          icon={Lightbulb}
          quiet
          {...common}
        />
      </div>
    </>
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
      <Scenes {...common} />
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
      <BoardControls {...common} />
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
                  {c.text && ` “${c.text}”`}
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
