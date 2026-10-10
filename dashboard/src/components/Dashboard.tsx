"use client";

import { useTwin } from "@/hooks/useTwin";
import { useNow } from "@/hooks/useNow";
import { twinSource } from "@/lib/datasource";
import { deriveRoomView, latest } from "@srdt/twin-core";
import { House, LoaderCircle, RefreshCw } from "lucide-react";
import { Controls, useCommandSender } from "./Controls";
import { EventList } from "./EventList";
import { Header } from "./Header";
import { RoomTwin } from "./RoomTwin";
import { StatusStrip } from "./StatusStrip";
import { TrendCharts } from "./TrendCharts";
import { ValueCards } from "./ValueCards";
import { Sidebar } from "./Sidebar";

export function Dashboard({ deviceCode }: { deviceCode: string }) {
  const twin = useTwin(deviceCode);
  const now = useNow(1000);
  const chartNow = useNow(5000); // moving the chart window every second would redraw for nothing
  const sender = useCommandSender(deviceCode, twin.commands);

  if (twin.status === "loading" || twin.status === "error" || !twin.device) {
    return (
      <div className="app-shell">
        <Sidebar deviceCode={deviceCode} online={false} />
        <main className="center">
          <div className="card connection-card" role="status">
            <span className="connection-illustration">
              <House size={34} aria-hidden="true" />
            </span>
            <span className="eyebrow">YOUR CONNECTED SPACE</span>
            <h1>
              {twin.status === "loading"
                ? "Getting your room ready"
                : "Let’s reconnect your room"}
            </h1>
            <p className="muted">
              {twin.status === "loading"
                ? `Connecting to ${deviceCode}. Your live readings will appear here.`
                : "We can’t reach your room right now. We’ll keep trying automatically."}
            </p>
            <div className="connection-progress">
              <LoaderCircle
                size={17}
                className="loading-icon"
                aria-hidden="true"
              />
              {twin.status === "loading"
                ? "Connecting to your room…"
                : "Trying to reconnect…"}
            </div>
            {twin.status === "error" && (
              <>
                <button
                  className="button"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  Try again
                </button>
                <details className="connection-details">
                  <summary>Connection details</summary>
                  <p>{twin.error}</p>
                  <p>Data source: {twinSource.name}</p>
                </details>
              </>
            )}
          </div>
        </main>
      </div>
    );
  }

  const { device } = twin;
  const live = latest(twin.telemetry);
  const reported = device.reported;
  const { online, lastSeenAt, stale, edgeState, windowAngle, buzzer, mlState, aiControl } =
    deriveRoomView(device, live, twin.lastTelemetryAt, now);

  return (
    <div className="app-shell">
      <Sidebar deviceCode={device.code} online={online} />
      <main className="page">
        <Header
          deviceName={device.name}
          presence={device.presence}
          lastSeenAt={lastSeenAt}
          stale={stale}
          now={now}
        />

        {twin.connection !== "live" && (
          <div className="banner" role="alert">
            {twin.connection === "reconnecting"
              ? "Live updates paused, reconnecting…"
              : "Connecting to live updates…"}
          </div>
        )}

        <ValueCards
          live={live}
          dhtFault={reported?.sensorFault.dht ?? false}
          dimmed={!online}
        />

        <StatusStrip
          edgeState={edgeState}
          windowAngle={windowAngle}
          buzzer={buzzer}
          status={reported}
          now={now}
          dimmed={!online}
          mlState={mlState}
          aiControl={aiControl}
        />

        <div className="grid">
          <div className="main">
            <RoomTwin
              online={online}
              roomName={
                device.name === device.code
                  ? "Your connected room"
                  : device.name
              }
              view={{
                edgeState,
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
            <Controls
              commands={twin.commands}
              online={online}
              sender={sender}
              windowAngle={windowAngle}
              buzzer={buzzer}
              override={reported?.override}
            />
            <EventList events={twin.events} />
          </div>
        </div>
        <footer className="page-footer">
          <span>Smart Room Digital Twin</span>
          <span>Connected spaces. Considered living.</span>
        </footer>
      </main>
    </div>
  );
}
