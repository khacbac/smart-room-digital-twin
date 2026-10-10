import type { EdgeState, ReportedState } from "@srdt/contracts";
import { STATE_LABEL, mlText as describeMl, overrideText, windowLabel } from "@srdt/twin-core";
import { STATE_COLOR } from "@/lib/format";
import {
  ShieldCheck,
  ShieldAlert,
  Volume2,
  PanelsTopLeft,
  Sparkles,
  Hand,
} from "lucide-react";

export function StatusStrip(props: {
  edgeState: EdgeState | null;
  windowAngle: number | null;
  buzzer: boolean | null;
  status: ReportedState | null;
  now: number;
  dimmed: boolean;
  /** §8 TinyML: model state from the latest telemetry (undefined = device sends none). */
  mlState?: EdgeState | null;
  aiControl?: boolean;
}) {
  const state = props.edgeState;
  const mlText = describeMl(props.mlState, props.aiControl ?? false);
  return (
    <section
      className={`card strip${props.dimmed ? " dimmed" : ""}`}
      aria-label="Device state"
    >
      <div
        className="strip-state"
        style={state ? { color: STATE_COLOR[state] } : undefined}
      >
        {state === "NORMAL" ? (
          <ShieldCheck size={24} aria-hidden="true" />
        ) : (
          <ShieldAlert size={24} aria-hidden="true" />
        )}
        <div>
          <span className="value-label">Room condition</span>
          <strong>{state ? STATE_LABEL[state] : "Awaiting data"}</strong>
        </div>
      </div>
      <dl className="strip-items">
        <div>
          <dt>
            <PanelsTopLeft size={14} aria-hidden="true" /> Window
          </dt>
          <dd>{windowLabel(props.windowAngle)}</dd>
        </div>
        <div>
          <dt>
            <Volume2 size={14} aria-hidden="true" /> Alarm
          </dt>
          <dd>
            {props.buzzer == null ? "—" : props.buzzer ? "Sounding" : "Off"}
          </dd>
        </div>
        <div>
          <dt>
            <Hand size={14} aria-hidden="true" /> Control mode
          </dt>
          <dd>{overrideText(props.status?.override, props.now)}</dd>
        </div>
        {mlText !== null && (
          <div>
            <dt>
              <Sparkles size={14} aria-hidden="true" /> Room intelligence
            </dt>
            <dd
              style={
                props.mlState
                  ? { color: STATE_COLOR[props.mlState] }
                  : undefined
              }
              title="On-device AI: active means it controls the window and alarm; safety rules remain in effect."
            >
              {mlText}
            </dd>
          </div>
        )}
        {props.status && (
          <div className="strip-meta">
            <dt>Connection</dt>
            <dd>
              fw {props.status.fw} · RSSI {props.status.rssi} dBm
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
