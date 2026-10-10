import {
  Droplets,
  Sun,
  Thermometer,
  UserRound,
  Wind,
  type LucideIcon,
} from "lucide-react";
import type { EdgeState, TelemetryRecord } from "@srdt/contracts";
import {
  AQ_LINES,
  HUMIDITY_LINES,
  STATE_LABEL,
  TEMP_LINES,
  fmt,
  levelFor,
} from "@srdt/twin-core";
import { STATE_COLOR } from "@/lib/format";

function Card(props: {
  label: string;
  value: string;
  unit?: string;
  level?: EdgeState | null;
  note: string;
  icon: LucideIcon;
  tone: string;
}) {
  const Icon = props.icon;
  return (
    <div className={`card value-card metric-${props.tone}`}>
      <div className="metric-head">
        <span className="value-label">{props.label}</span>
        <span className="metric-icon">
          <Icon size={19} aria-hidden="true" />
        </span>
      </div>
      <span
        className="value"
        style={props.level ? { color: STATE_COLOR[props.level] } : undefined}
      >
        {props.value}
        {props.unit && props.value !== "—" && (
          <span className="unit">{props.unit}</span>
        )}
      </span>
      <span
        className={`metric-note${props.level ? ` level-${props.level.toLowerCase()}` : ""}`}
      >
        <span className="metric-dot" aria-hidden="true" />
        {props.level ? STATE_LABEL[props.level] : props.note}
      </span>
    </div>
  );
}

export function ValueCards(props: {
  live: TelemetryRecord | null;
  dhtFault: boolean;
  dimmed: boolean;
}) {
  const { live } = props;
  const missing = props.dhtFault ? "Sensor fault" : "Waiting for reading";
  return (
    <section
      className={`values${props.dimmed ? " dimmed" : ""}`}
      aria-label="Current sensor readings"
    >
      <Card
        label="Temperature"
        value={fmt(live?.temperature)}
        unit="°C"
        icon={Thermometer}
        tone="peach"
        level={levelFor(live?.temperature ?? null, TEMP_LINES)}
        note={live?.temperature == null ? missing : "Below heat threshold"}
      />
      <Card
        label="Humidity"
        value={fmt(live?.humidity, 0)}
        unit="%"
        icon={Droplets}
        tone="blue"
        level={levelFor(live?.humidity ?? null, HUMIDITY_LINES)}
        note={live?.humidity == null ? missing : "Below high threshold"}
      />
      <Card
        label="Light level"
        value={fmt(live?.light, 0)}
        unit="lx"
        icon={Sun}
        tone="sand"
        note={live?.light == null ? "Waiting for reading" : "Ambient light"}
      />
      <Card
        label="Air quality"
        value={fmt(live?.airQuality, 0)}
        unit="AQ"
        icon={Wind}
        tone="sage"
        level={levelFor(live?.airQuality ?? null, AQ_LINES)}
        note={
          live?.airQuality == null
            ? "Waiting for reading"
            : "Below alert threshold"
        }
      />
      <Card
        label="Occupancy"
        value={!live ? "—" : live.presence ? "Detected" : "Quiet"}
        icon={UserRound}
        tone="lilac"
        note={
          !live
            ? "Waiting for reading"
            : live.presence
              ? "Motion detected"
              : "No motion detected"
        }
      />
    </section>
  );
}
