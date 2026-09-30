import type { EdgeState, ReportedState } from "@srdt/contracts";
import { STATE_COLOR, STATE_LABEL, countdown, toMs, windowLabel } from "@/lib/format";

function overrideText(override: ReportedState["override"] | undefined, now: number): string {
  if (!override || (!override.window && !override.buzzer)) return "none";
  const which = [override.window && "window", override.buzzer && "buzzer"].filter(Boolean).join(" + ");
  const expires = toMs(override.expiresAt);
  // expiresAt is null for a retained status without a valid ts (§9.3): no countdown then
  if (expires === null) return which;
  const left = (expires - now) / 1000;
  return left > 0 ? `${which} (${countdown(left)})` : `${which} (ending…)`;
}

export function StatusStrip(props: {
  edgeState: EdgeState | null;
  windowAngle: number | null;
  buzzer: boolean | null;
  status: ReportedState | null;
  now: number;
  dimmed: boolean;
}) {
  const state = props.edgeState;
  return (
    <section className={`card strip${props.dimmed ? " dimmed" : ""}`} aria-label="Device state">
      <div className="strip-state" style={state ? { background: STATE_COLOR[state] } : undefined}>
        <span className="value-label">Edge state</span>
        <strong>{state ? STATE_LABEL[state] : "—"}</strong>
      </div>
      <dl className="strip-items">
        <div>
          <dt>Window</dt>
          <dd>{windowLabel(props.windowAngle)}</dd>
        </div>
        <div>
          <dt>Buzzer</dt>
          <dd>{props.buzzer == null ? "—" : props.buzzer ? "alarm on" : "off"}</dd>
        </div>
        <div>
          <dt>Override</dt>
          <dd>{overrideText(props.status?.override, props.now)}</dd>
        </div>
        {props.status && (
          <div className="strip-meta">
            <dt>Device</dt>
            <dd>
              fw {props.status.fw} · RSSI {props.status.rssi} dBm
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
