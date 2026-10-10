"use client";

import { useState } from "react";
import {
  Box,
  ImageIcon,
  PanelsTopLeft,
  UserRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { EdgeState } from "@srdt/contracts";
import { STATE_COLOR, STATE_LABEL, fmt, windowLabel } from "@/lib/format";

// All live indicators mirror reported device state. The photo is illustrative.
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

export function RoomTwin({
  view,
  online,
  roomName,
}: {
  view: TwinView;
  online: boolean;
  roomName: string;
}) {
  const [mode, setMode] = useState<"photo" | "twin">("photo");
  const accent = view.edgeState ? STATE_COLOR[view.edgeState] : "var(--muted)";
  const angle = view.windowAngle ?? 0;
  const sashWidth = Math.max(3, 89 * Math.cos((angle * Math.PI) / 180));
  const shade =
    view.light == null
      ? 0
      : 0.28 * (1 - Math.min(1, Math.max(0, view.light / 300)));
  const haze =
    view.airQuality == null
      ? 0
      : 0.2 * Math.min(1, Math.max(0, (view.airQuality - 300) / 700));
  return (
    <section
      className={`card twin${online ? "" : " twin-offline"}`}
      id="room"
      aria-label="Room digital twin"
    >
      <div className="card-head">
        <div>
          <h2>Your space</h2>
          <p className="section-description">
            A closer look at your connected room.
          </p>
        </div>
        <div className="tabs" role="group" aria-label="Room view">
          <button
            type="button"
            className={`tab${mode === "photo" ? " tab-active" : ""}`}
            aria-pressed={mode === "photo"}
            onClick={() => setMode("photo")}
          >
            <ImageIcon size={14} aria-hidden="true" />
            Room
          </button>
          <button
            type="button"
            className={`tab${mode === "twin" ? " tab-active" : ""}`}
            aria-pressed={mode === "twin"}
            onClick={() => setMode("twin")}
          >
            <Box size={14} aria-hidden="true" />
            Live twin
          </button>
        </div>
      </div>
      <div className={`room-scene scene-${mode}`}>
        {mode === "photo" ? (
          <>
            <img
              className="room-photo"
              src="/images/room-interior.jpg"
              width={1400}
              height={934}
              alt="An illustrative bright living room with a neutral sofa, natural wood and greenery"
            />
            <span className="scene-caption">
              <ImageIcon size={12} aria-hidden="true" />
              Illustrative room
            </span>
            <a
              className="photo-credit"
              href="https://unsplash.com/photos/living-room-with-white-sofa-and-glass-window-4YGsYQf7DNQ"
              target="_blank"
              rel="noreferrer"
            >
              Photo: Spacejoy / Unsplash
            </a>
          </>
        ) : (
          <svg
            viewBox="0 0 680 350"
            role="img"
            aria-label={`Live room: ${view.edgeState ? STATE_LABEL[view.edgeState] : "unknown"}, window ${view.windowAngle == null ? "unknown" : `${angle} degrees`}, alarm ${view.buzzer == null ? "unknown" : view.buzzer ? "on" : "off"}`}
          >
            <defs>
              <linearGradient id="room-wall" x2="0" y2="1">
                <stop stopColor="#f3eee6" />
                <stop offset="1" stopColor="#e5ddd0" />
              </linearGradient>
              <linearGradient id="room-floor" x2="0" y2="1">
                <stop stopColor="#e2cfb6" />
                <stop offset="1" stopColor="#cbb190" />
              </linearGradient>
              <linearGradient id="window-sky" x2="0" y2="1">
                <stop stopColor="#c3dfdf" />
                <stop offset="1" stopColor="#edf4df" />
              </linearGradient>
            </defs>
            <rect width="680" height="350" fill="#f4f1eb" />
            <path d="M70 40H600V235H70Z" fill="url(#room-wall)" />
            <path d="M70 40L20 10V275L70 235Z" fill="#d4cbbb" />
            <path d="M600 40L660 10V275L600 235Z" fill="#e3dbce" />
            <path d="M70 235H600L660 330H20Z" fill="url(#room-floor)" />
            <g stroke="#bea582" opacity=".4">
              <path d="M85 235L45 330M160 235L140 330M250 235L240 330M345 235V330M440 235L450 330M530 235L550 330M590 235L625 330M45 280H630" />
            </g>
            {/* Window sash narrows as the actual servo opens it. */}
            <g transform="translate(422 64)">
              <rect
                width="120"
                height="121"
                rx="2"
                fill="url(#window-sky)"
                stroke="#8c9d91"
                strokeWidth="7"
              />
              <path
                d="M5 100Q35 62 65 100Q90 74 118 94V118H5Z"
                fill="#aac5a0"
              />
              <rect
                x="4"
                y="4"
                width={sashWidth}
                height="113"
                fill="#e4f0e8"
                fillOpacity=".62"
                stroke="#8c9d91"
                strokeWidth="3"
                style={{ transition: "width 600ms ease" }}
              />
              <path d="M95 130H122" stroke="#a69681" strokeWidth="3" />
            </g>
            {/* Framed art, lamp and a furnished room. */}
            <rect
              x="194"
              y="65"
              width="105"
              height="82"
              fill="#fcf8ef"
              stroke="#aa9071"
              strokeWidth="5"
            />
            <circle cx="229" cy="95" r="17" fill="#d3a67e" />
            <path d="M198 142Q229 104 250 129Q275 98 296 142" fill="#a4b39a" />
            <path d="M365 113V240" stroke="#917f67" strokeWidth="4" />
            <ellipse cx="365" cy="242" rx="21" ry="5" fill="#917f67" />
            <path d="M338 114L348 82H381L391 114Z" fill="#f8f3e4" />
            <ellipse cx="264" cy="283" rx="142" ry="34" fill="#ece5d7" />
            <rect
              x="133"
              y="171"
              width="193"
              height="75"
              rx="14"
              fill="#b5bda5"
            />
            <rect
              x="133"
              y="204"
              width="193"
              height="46"
              rx="10"
              fill="#9ea88e"
            />
            <rect
              x="126"
              y="187"
              width="25"
              height="61"
              rx="8"
              fill="#a9b398"
            />
            <rect
              x="312"
              y="187"
              width="25"
              height="61"
              rx="8"
              fill="#a9b398"
            />
            <rect
              x="160"
              y="179"
              width="43"
              height="37"
              rx="6"
              fill="#eadfc9"
              transform="rotate(-8 180 198)"
            />
            <rect
              x="262"
              y="178"
              width="42"
              height="39"
              rx="6"
              fill="#d4a688"
              transform="rotate(8 280 198)"
            />
            <path
              d="M147 249V258M314 249V258"
              stroke="#826a51"
              strokeWidth="5"
            />
            <ellipse cx="274" cy="273" rx="53" ry="15" fill="#ae8b67" />
            <path
              d="M239 280L234 304M309 280L314 304"
              stroke="#8c7154"
              strokeWidth="5"
            />
            <rect
              x="258"
              y="253"
              width="24"
              height="12"
              rx="3"
              fill="#f0e6d3"
            />
            <g transform="translate(561 228)">
              <path d="M-14 0L-9 31H10L15 0" fill="#bc936e" />
              <path
                d="M0 2V-58M0-25Q-36-55-19-60Q-6-63 0-25M0-13Q36-43 22-48Q9-50 0-13M0-41Q-18-76-5-81Q11-73 0-41"
                fill="#7b9770"
                stroke="#708963"
                strokeWidth="2"
              />
            </g>
            {/* Device LEDs preserve the firmware's state mapping. */}
            <g transform="translate(91 100)">
              <rect
                x="-9"
                y="-12"
                width="27"
                height="74"
                rx="7"
                fill="#faf7ef"
                stroke="#c8c4b7"
              />
              <circle
                cx="4"
                cy="3"
                r="5"
                fill={
                  view.edgeState === "DANGER"
                    ? "var(--state-danger)"
                    : "#d8d9cd"
                }
              />
              <circle
                cx="4"
                cy="25"
                r="5"
                fill={
                  view.edgeState === "WARNING" ||
                  view.edgeState === "UNCOMFORTABLE"
                    ? "var(--state-uncomfortable)"
                    : "#d8d9cd"
                }
                className={view.edgeState === "WARNING" ? "blink" : undefined}
              />
              <circle
                cx="4"
                cy="47"
                r="5"
                fill={
                  view.edgeState === "NORMAL"
                    ? "var(--state-normal)"
                    : "#d8d9cd"
                }
              />
            </g>
            <g transform="translate(342 168)">
              <circle r="11" fill="#eee8db" stroke="#b8ae9e" />
              <path d="M-4-3H0L4-6V6L0 3H-4Z" fill="#928b7d" />
              {view.buzzer && (
                <path
                  d="M15-8Q25 0 15 8M20-12Q35 0 20 12"
                  fill="none"
                  stroke="var(--state-danger)"
                  strokeWidth="2"
                  className="waves"
                />
              )}
            </g>
            {view.presence && (
              <g transform="translate(420 225)" fill="#667f72">
                <circle cy="-15" r="10" />
                <rect x="-12" width="24" height="34" rx="10" />
                <path
                  d="M-6 31V56M6 31V56"
                  stroke="#667f72"
                  strokeWidth="7"
                  strokeLinecap="round"
                />
              </g>
            )}
            <rect
              width="680"
              height="350"
              fill="#243428"
              opacity={shade}
              pointerEvents="none"
            />
            <rect
              width="680"
              height="350"
              fill="#b68979"
              opacity={haze}
              pointerEvents="none"
            />
          </svg>
        )}
        <div className="room-overlay">
          <div>
            <span className="room-eyebrow">
              {mode === "twin" ? "LIVE DIGITAL TWIN" : "YOUR CONNECTED SPACE"}
            </span>
            <h3>{roomName}</h3>
          </div>
          <span className="room-state" style={{ color: accent }}>
            <span className="dot" aria-hidden="true" />
            {online
              ? view.edgeState
                ? STATE_LABEL[view.edgeState]
                : "Awaiting data"
              : "Offline"}
          </span>
        </div>
        {mode === "twin" && (
          <span className="twin-reading">
            {fmt(view.temperature)} °C · {fmt(view.humidity, 0)} % ·{" "}
            {fmt(view.light, 0)} lx · {fmt(view.airQuality, 0)} AQ
          </span>
        )}
      </div>
      <div className="room-facts">
        <div>
          <PanelsTopLeft size={18} aria-hidden="true" />
          <span>
            <small>Window{view.windowOverride ? " · manual" : ""}</small>
            <strong>{windowLabel(view.windowAngle)}</strong>
          </span>
        </div>
        <div>
          {view.buzzer ? (
            <Volume2 size={18} aria-hidden="true" />
          ) : (
            <VolumeX size={18} aria-hidden="true" />
          )}
          <span>
            <small>Alarm{view.buzzerOverride ? " · manual" : ""}</small>
            <strong>
              {view.buzzer == null
                ? "Unknown"
                : view.buzzer
                  ? "Sounding"
                  : "Off"}
            </strong>
          </span>
        </div>
        <div>
          <UserRound size={18} aria-hidden="true" />
          <span>
            <small>Occupancy</small>
            <strong>
              {view.presence == null
                ? "Unknown"
                : view.presence
                  ? "Motion detected"
                  : "No motion"}
            </strong>
          </span>
        </div>
      </div>
    </section>
  );
}
