import type { EdgeState, TelemetryRecord } from "@srdt/contracts";
import { STATE_COLOR, fmt } from "@/lib/format";
import { AQ_LINES, HUMIDITY_LINES, TEMP_LINES, levelFor } from "@/lib/thresholds";

function Card(props: { label: string; value: string; unit?: string; level?: EdgeState | null; tag?: string }) {
  return (
    <div className="card value-card">
      <span className="value-label">{props.label}</span>
      <span className="value" style={props.level ? { color: STATE_COLOR[props.level] } : undefined}>
        {props.value}
        {props.unit && props.value !== "—" && <span className="unit">{props.unit}</span>}
      </span>
      {props.tag && <span className="tag">{props.tag}</span>}
    </div>
  );
}

export function ValueCards(props: { live: TelemetryRecord | null; dhtFault: boolean; dimmed: boolean }) {
  const { live } = props;
  if (!live) return <div className="card empty">Waiting for telemetry…</div>;
  // null temperature/humidity: DHT fault, or no valid reading since boot (§5.3)
  const dhtTag = props.dhtFault ? "Sensor fault" : "No reading yet";
  return (
    <section className={`values${props.dimmed ? " dimmed" : ""}`} aria-label="Current values">
      <Card
        label="Temperature"
        value={fmt(live.temperature)}
        unit="°C"
        level={levelFor(live.temperature, TEMP_LINES)}
        tag={live.temperature === null ? dhtTag : undefined}
      />
      <Card
        label="Humidity"
        value={fmt(live.humidity, 0)}
        unit="%"
        level={levelFor(live.humidity, HUMIDITY_LINES)}
        tag={live.humidity === null ? dhtTag : undefined}
      />
      <Card label="Light" value={fmt(live.light, 0)} unit="lx" />
      <Card label="Air quality" value={fmt(live.airQuality, 0)} unit="AQ" level={levelFor(live.airQuality, AQ_LINES)} />
      <Card label="Presence" value={live.presence ? "Yes" : "No"} />
    </section>
  );
}
