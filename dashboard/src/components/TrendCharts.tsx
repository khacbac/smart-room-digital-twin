"use client";

import { useState } from "react";
import { Activity, Clock3 } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
    if (prev && t - prev.t > GAP_MS)
      out.push({
        t: prev.t + 1,
        temperature: null,
        humidity: null,
        airQuality: null,
      });
    out.push({
      t,
      temperature: r.temperature,
      humidity: r.humidity,
      airQuality: r.airQuality,
    });
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
  const tick = (t: number) =>
    new Date(t).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return (
    <figure className="chart">
      <figcaption>
        {props.title} <span className="muted">({props.unit})</span>
      </figcaption>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart
          data={props.points}
          margin={{ top: 10, right: 12, bottom: 0, left: -12 }}
        >
          <defs>
            <linearGradient
              id={`fill-${props.series}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={props.color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={props.color} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="var(--grid)"
            vertical={false}
            strokeDasharray="3 5"
          />
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
              strokeOpacity={0.45}
              ifOverflow="hidden"
            />
          ))}
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
            labelFormatter={(t) =>
              new Date(Number(t)).toLocaleTimeString([], { hour12: false })
            }
            formatter={(v) => [
              typeof v === "number" ? `${v.toFixed(1)} ${props.unit}` : "—",
              props.title,
            ]}
          />
          <Area
            type="monotone"
            dataKey={props.series}
            stroke={props.color}
            strokeWidth={2.5}
            fill={`url(#fill-${props.series})`}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}

export function TrendCharts({
  telemetry,
  now,
}: {
  telemetry: TelemetryRecord[];
  now: number;
}) {
  const [series, setSeries] = useState<Series>("temperature");
  const points = toPoints(telemetry);
  const domain: [number, number] = [now - HISTORY_MS, now];
  const options = {
    temperature: {
      title: "Temperature",
      unit: "°C",
      color: "var(--series-temp)",
      lines: TEMP_LINES,
      yDomain: ["auto", "auto"] as ["auto", "auto"],
    },
    humidity: {
      title: "Humidity",
      unit: "%",
      color: "var(--series-hum)",
      lines: HUMIDITY_LINES,
      yDomain: [0, 100] as [number, number],
    },
    airQuality: {
      title: "Air quality",
      unit: "AQ",
      color: "var(--series-aq)",
      lines: AQ_LINES,
      yDomain: [0, 1000] as [number, number],
    },
  };
  return (
    <section
      className="card trend-card"
      id="trends"
      aria-label="Sensor trends over the last 15 minutes"
    >
      <div className="card-head">
        <div>
          <h2>Room trends</h2>
          <p className="section-description">
            Small changes, a clearer picture.
          </p>
        </div>
        <span className="time-range">
          <Clock3 size={14} aria-hidden="true" />
          Last 15 min
        </span>
      </div>
      <div className="trend-tabs" role="group" aria-label="Choose sensor trend">
        {(Object.keys(options) as Series[]).map((key) => (
          <button
            type="button"
            key={key}
            aria-pressed={series === key}
            className={`trend-tab${series === key ? " trend-tab-active" : ""}`}
            onClick={() => setSeries(key)}
          >
            <span style={{ background: options[key].color }} />
            {options[key].title}
          </button>
        ))}
      </div>
      {points.length === 0 ? (
        <div className="chart-empty">
          <Activity size={28} aria-hidden="true" />
          <strong>Your room’s story starts here</strong>
          <p>Trends will appear as sensor readings arrive.</p>
        </div>
      ) : (
        <Chart
          {...options[series]}
          series={series}
          points={points}
          domain={domain}
        />
      )}
      <div className="chart-foot">
        <span>
          <span className="legend-dash" />
          Dashed lines mark alert thresholds
        </span>
        <span>Updates automatically</span>
      </div>
    </section>
  );
}
