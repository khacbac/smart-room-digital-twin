import type { EdgeState } from "@srdt/contracts";
import { STATE_COLOR, STATE_LABEL, fmt } from "@/lib/format";

// The digital twin view: a drawing of the room driven only by the device's reported
// state and latest telemetry. Nothing here decides anything; it mirrors the device.
// Swap this for a 3D scene (three.js / react-three-fiber) later without changing the data.

export interface TwinView {
  edgeState: EdgeState | null;
  windowAngle: number | null;
  buzzer: boolean | null;
  windowOverride: boolean;
  buzzerOverride: boolean;
  temperature: number | null;
  humidity: number | null;
  light: number | null;
  airQuality: number | null;
  presence: boolean | null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** LEDs as the edge rules drive them (device/lib/edge_rules: green NORMAL, yellow UNCOMFORTABLE/WARNING blinking, red DANGER). */
function leds(state: EdgeState | null) {
  return {
    green: state === "NORMAL",
    yellow: state === "UNCOMFORTABLE" || state === "WARNING",
    yellowBlink: state === "WARNING",
    red: state === "DANGER",
  };
}

export function RoomTwin({ view, online }: { view: TwinView; online: boolean }) {
  const state = view.edgeState;
  const accent = state ? STATE_COLOR[state] : "var(--border)";
  const led = leds(state);
  // Darker room when there is little light (0 lx → 0.45 shade, ≥ 300 lx, a lit room → none).
  const shade = view.light == null ? 0 : 0.45 * (1 - clamp01(view.light / 300));
  // Haze for bad air (≤ 300 → none, 1000 → 0.35).
  const haze = view.airQuality == null ? 0 : 0.35 * clamp01((view.airQuality - 300) / 700);
  const angle = view.windowAngle ?? 0;
  // Window sash seen from inside: it narrows as it swings open around the left hinge.
  const sashWidth = 90 * Math.cos((angle * Math.PI) / 180);

  return (
    <section className={`card twin${online ? "" : " twin-offline"}`} aria-label="Room digital twin">
      <div className="card-head">
        <h2>Room twin</h2>
        <span className="twin-state" style={{ color: accent }}>
          {state ? STATE_LABEL[state] : "—"}
        </span>
      </div>
      <svg viewBox="0 0 420 250" role="img" aria-label={`Room state ${state ?? "unknown"}, window ${angle} degrees`}>
        {/* room */}
        <rect x="10" y="10" width="400" height="190" rx="8" className="twin-wall" />
        <rect x="10" y="200" width="400" height="40" rx="4" className="twin-floor" />
        <rect x="10" y="10" width="400" height="230" rx="8" fill="none" stroke={accent} strokeWidth="3" />

        {/* window (right wall) */}
        <g transform="translate(280 40)">
          <rect width="100" height="90" className="twin-sky" />
          <rect
            x="5"
            y="5"
            width={Math.max(2, sashWidth)}
            height="80"
            className="twin-sash"
            style={{ transition: "width 600ms ease" }}
          />
          <rect width="100" height="90" fill="none" className="twin-frame" />
          <text x="50" y="108" textAnchor="middle" className="twin-label">
            window {angle}°{view.windowOverride ? " · manual" : ""}
          </text>
        </g>

        {/* status LEDs + buzzer (left wall, like the breadboard) */}
        <g transform="translate(40 40)">
          <rect x="-12" y="-12" width="44" height="104" rx="8" className="twin-panel" />
          <circle cx="10" cy="8" r="9" fill={led.red ? "var(--state-danger)" : "var(--led-off)"} />
          <circle
            cx="10"
            cy="40"
            r="9"
            fill={led.yellow ? "var(--state-uncomfortable)" : "var(--led-off)"}
            className={led.yellowBlink ? "blink" : undefined}
          />
          <circle cx="10" cy="72" r="9" fill={led.green ? "var(--state-normal)" : "var(--led-off)"} />
        </g>
        <g transform="translate(110 60)">
          <circle r="14" className="twin-panel" />
          <text textAnchor="middle" y="5" className="twin-icon">
            ♪
          </text>
          {view.buzzer && (
            <g className="waves" fill="none" stroke="var(--state-danger)" strokeWidth="2">
              <path d="M20 -10 Q28 0 20 10" />
              <path d="M26 -16 Q38 0 26 16" />
            </g>
          )}
          <text y="34" textAnchor="middle" className="twin-label">
            buzzer {view.buzzer ? "on" : "off"}
            {view.buzzerOverride ? " · manual" : ""}
          </text>
        </g>

        {/* sensor node */}
        <g transform="translate(150 120)">
          <rect width="110" height="52" rx="6" className="twin-panel" />
          <text x="8" y="20" className="twin-mono">
            {fmt(view.temperature)}°C {fmt(view.humidity, 0)}%
          </text>
          <text x="8" y="40" className="twin-mono">
            {fmt(view.light, 0)}lx AQ{fmt(view.airQuality, 0)}
          </text>
        </g>

        {/* occupant (PIR) */}
        {view.presence && (
          <g transform="translate(95 140)" className="twin-person">
            <circle cy="0" r="10" />
            <rect x="-11" y="12" width="22" height="36" rx="9" />
          </g>
        )}

        {/* ambient overlays */}
        <rect x="10" y="10" width="400" height="230" rx="8" fill="#000" opacity={shade} pointerEvents="none" />
        <rect x="10" y="10" width="400" height="230" rx="8" fill="var(--series-aq)" opacity={haze} pointerEvents="none" />
      </svg>
    </section>
  );
}
