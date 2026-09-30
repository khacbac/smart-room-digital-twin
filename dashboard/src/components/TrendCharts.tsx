"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EdgeState, TelemetryRecord } from "@srdt/contracts";
import { HISTORY_MS } from "@/hooks/useTwin";
import { STATE_COLOR } from "@/lib/format";
import { AQ_LINES, HUMIDITY_LINES, TEMP_LINES } from "@/lib/thresholds";

// Last 15 minutes, from what the data source has sent (snapshot + live messages).
// Longer ranges (1 h / 24 h) need the cloud storage and a query API: see docs/cloud.md.

interface Point {
  t: number;
  temperature: number | null;
  humidity: number | null;
  airQuality: number | null;
}

type Series = "temperature" | "humidity" | "airQuality";

const GAP_MS = 20_000;

/** Null points where data is missing, so the line breaks instead of bridging an outage. */
function toPoints(telemetry: TelemetryRecord[]): Point[] {
  const out: Point[] = [];
  for (const r of telemetry) {
    const t = Date.parse(r.receivedAt); // receive time: the simulator's clock can lag
    const prev = out[out.length - 1];
    if (prev && t - prev.t > GAP_MS) out.push({ t: prev.t + 1, temperature: null, humidity: null, airQuality: null });
    out.push({ t, temperature: r.temperature, humidity: r.humidity, airQuality: r.airQuality });
  }
  return out;
}

function Chart(props: {
  title: string;
  unit: string;
  series: Series;
  color: string;
  points: Point[];
  domain: [number, number];
  lines: readonly { value: number; state: EdgeState }[];
  yDomain: [number | "auto", number | "auto"];
}) {
  const tick = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <figure className="chart">
      <figcaption>
        {props.title} <span className="muted">({props.unit})</span>
      </figcaption>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={props.points} margin={{ top: 6, right: 12, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={props.domain}
            allowDataOverflow
            tickFormatter={tick}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            stroke="var(--grid)"
            minTickGap={40}
          />
          <YAxis
            domain={props.yDomain}
            tick={{ fill: "var(--muted)", fontSize: 11 }}
            stroke="var(--grid)"
            width={48}
            allowDecimals={false}
          />
          {props.lines.map((l) => (
            <ReferenceLine
              key={l.value}
              y={l.value}
              stroke={STATE_COLOR[l.state]}
              strokeDasharray="4 4"
              strokeOpacity={0.7}
              ifOverflow="hidden"
            />
          ))}
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}
            labelFormatter={(t) => new Date(Number(t)).toLocaleTimeString([], { hour12: false })}
            formatter={(v) => [typeof v === "number" ? `${v.toFixed(1)} ${props.unit}` : "—", props.title]}
          />
          <Line
            type="monotone"
            dataKey={props.series}
            stroke={props.color}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}

export function TrendCharts({ telemetry, now }: { telemetry: TelemetryRecord[]; now: number }) {
  const points = toPoints(telemetry);
  const domain: [number, number] = [now - HISTORY_MS, now];
  return (
    <section className="card" aria-label="Last 15 minutes">
      <div className="card-head">
        <h2>Last 15 minutes</h2>
      </div>
      {points.length === 0 && <p className="muted small">No telemetry yet.</p>}
      <Chart
        title="Temperature"
        unit="°C"
        series="temperature"
        color="var(--series-temp)"
        points={points}
        domain={domain}
        lines={TEMP_LINES}
        yDomain={["auto", "auto"]}
      />
      <Chart
        title="Humidity"
        unit="%"
        series="humidity"
        color="var(--series-hum)"
        points={points}
        domain={domain}
        lines={HUMIDITY_LINES}
        yDomain={[0, 100]}
      />
      <Chart
        title="Air quality"
        unit="AQ"
        series="airQuality"
        color="var(--series-aq)"
        points={points}
        domain={domain}
        lines={AQ_LINES}
        yDomain={[0, 1000]}
      />
    </section>
  );
}
