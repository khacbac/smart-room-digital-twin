"use client";

import { latest, useTwin } from "@/hooks/useTwin";
import { useNow } from "@/hooks/useNow";
import { twinSource } from "@/lib/datasource";
import { toMs } from "@/lib/format";
import { Controls, useCommandSender } from "./Controls";
import { EventList } from "./EventList";
import { Header } from "./Header";
import { RoomTwin } from "./RoomTwin";
import { StatusStrip } from "./StatusStrip";
import { TrendCharts } from "./TrendCharts";
import { ValueCards } from "./ValueCards";

/** Online, but the newest telemetry is older than this → "Stale data". */
const STALE_AFTER_MS = 15_000;

export function Dashboard({ deviceCode }: { deviceCode: string }) {
  const twin = useTwin(deviceCode);
  const now = useNow(1000);
  const chartNow = useNow(5000); // moving the chart window every second would redraw for nothing
  const sender = useCommandSender(deviceCode, twin.commands);

  if (twin.status === "loading") return <div className="center muted">Connecting to {deviceCode}…</div>;
  if (twin.status === "error" || !twin.device) {
    return (
      <div className="center">
        <div className="card error-card">
          <h2>Cannot load the twin</h2>
          <p className="error">{twin.error}</p>
          <p className="muted small">Retrying…</p>
        </div>
      </div>
    );
  }

  const { device } = twin;
  const live = latest(twin);
  const reported = device.reported;
  const online = device.presence === "online";
  // Receive times, not the device's measuredAt: a slow simulator makes the device clock lag.
  const lastSeenAt = Math.max(twin.lastTelemetryAt ?? 0, toMs(device.lastSeenAt) ?? 0) || null;
  const stale = online && twin.lastTelemetryAt !== null && now - twin.lastTelemetryAt > STALE_AFTER_MS;

  // Actuators: the reported status is sent right after every change, telemetry every 2 s.
  const windowAngle = reported?.actuators.windowAngle ?? live?.windowAngle ?? null;
  const buzzer = reported?.actuators.buzzer ?? live?.buzzer ?? null;

  return (
    <div className="page">
      <Header
        deviceCode={device.code}
        deviceName={device.name}
        presence={device.presence}
        lastSeenAt={lastSeenAt}
        stale={stale}
        source={twinSource.name}
        now={now}
      />

      {twin.connection !== "live" && (
        <div className="banner" role="alert">
          {twin.connection === "reconnecting" ? "Live updates paused, reconnecting…" : "Connecting to live updates…"}
        </div>
      )}

      <ValueCards live={live} dhtFault={reported?.sensorFault.dht ?? false} dimmed={!online} />

      <StatusStrip
        edgeState={live?.edgeState ?? device.edgeState}
        windowAngle={windowAngle}
        buzzer={buzzer}
        status={reported}
        now={now}
        dimmed={!online}
      />

      <div className="grid">
        <div className="main">
          <RoomTwin
            online={online}
            view={{
              edgeState: live?.edgeState ?? device.edgeState,
              windowAngle,
              buzzer,
              windowOverride: reported?.override.window ?? false,
              buzzerOverride: reported?.override.buzzer ?? false,
              temperature: live?.temperature ?? null,
              humidity: live?.humidity ?? null,
              light: live?.light ?? null,
              airQuality: live?.airQuality ?? null,
              presence: live?.presence ?? null,
            }}
          />
          <TrendCharts telemetry={twin.telemetry} now={chartNow} />
        </div>
        <div className="side">
          <Controls commands={twin.commands} online={online} sender={sender} />
          <EventList events={twin.events} />
        </div>
      </div>
    </div>
  );
}
