# AIoT Smart Environment & Safety System — Project Specification

> **Spec version:** 1.8 — 2026-09-29
> **Status:** Ready for build (Phase 0–7). Decisions in §0 are defaults; change them there first if needed, then update the affected sections.
>
> **Changes in 1.8:** the real AI provider is **Gemini** (`@google/genai`, default model `gemini-3.1-flash-lite`, structured JSON output) (D3, §9.2, §9.7). The §11.4 window uses the server receive time (`created_at`), because the simulator clock can drift minutes behind. The 429 for the AI cooldown has code `AI_COOLDOWN` and a `Retry-After` header (§9.6). `AI_COOLDOWN_SEC` default lowered from 120 to 30 so the demo can re-run an analysis quickly (§9.2).
>
> **Changes in 1.7:** §4.6 LDR formula fixed for 3.3 V: `resistance = 10000 * voltage / (3.3 - voltage)`. The old constant 2000 is Wokwi's 10 kΩ / 5 V and made light readings about 1.8× too high.
>
> **Changes in 1.6:** data retention via `pg_cron` (§10.5): telemetry 30 days, events 90 days (`supabase/migrations/0002_retention.sql`).
>
> **Changes in 1.5:** `wifiClient.setTimeout(3)` (core 2.x takes seconds, not ms), Mosquitto `autosave_interval 10` so a killed broker keeps the retained status, device keepalive stays 15 s (reasoning in §6.4).
>
> **Changes in 1.4:** `POST /ai/analyze` returns `202 { status }` (no id before success) and `409 AI_BUSY` while in flight, device publishes telemetry immediately on a state change (DANGER row is in the AI aggregate), `DEVICE_OFFLINE_AFTER_SEC=45` so offline detection stays within 60 s, window override cancelled by escalation into a "hold" state keeps the more open angle, implementation notes (tsup `noExternal`, 64-bit `ts`, PubSubClient buffer 1280, LEDC channel/timer mapping, LCD row width, `127.0.0.1` for MQTT, 409 timing in Phase 4).
>
> **Changes in 1.3:** commands fail fast when the backend's MQTT link is down and the timeout sweeper also covers `pending` (no stale replay), absolute `override.expiresAt` for the dashboard countdown, net task ↔ `loop()` interface (connect handshake, single `seq` owner, queue flush on disconnect), logical `actuators.buzzer`, Node 22 LTS, Arduino core 2.x pinned (D13), Supabase publishable/secret keys, Windows native-test toolchain, contracts package build, AI timing/cooldown clarifications, server event severities, minor fixes (LDR guard, broadcast send, chart append, MQTT 3.1.1).
>
> **Changes in 1.2:** live telemetry via Realtime Broadcast (D10), bucketed history RPC, presence/retained handling, command status race, AI danger trigger bypasses cooldown, non-blocking network task, native-testable `lib/edge_rules`, LCD state labels, Phase 0 gateway spike, several clarifications.

---

## 0. Decision Log

| ID | Decision | Default chosen | Affects |
|---|---|---|---|
| D1 | Simulator + broker connectivity | **Wokwi for VS Code + PlatformIO + Wokwi Private IoT Gateway + local Mosquitto**. Fallback: public broker (HiveMQ / EMQX) with a unique topic prefix, switched via config only. | §6.1, §4.5 |
| D2 | Manual command vs edge safety rules | **Manual command wins for a limited time (override, default 120 s).** Edge state/LEDs/events keep running. Override is cancelled when the state escalates. | §7.6 |
| D3 | Cloud AI provider | **Provider-agnostic interface. MVP ships a deterministic `mock` provider first**, one real LLM provider is added behind `AI_PROVIDER`: **Gemini** (`AI_PROVIDER=gemini`, default model `gemini-3.1-flash-lite`). | §11 |
| D4 | Dashboard data access | **Reads** (history + realtime) directly from Supabase with the anon key (RLS: select only). **Writes** (commands, manual AI trigger) only through the backend API. | §10.4, §12 |
| D5 | CSV logging | Backend logs **every valid telemetry message** to CSV (full resolution for ML). DB stores **downsampled** telemetry. | §9.5, §13 |
| D6 | AI suggested action | **Recommendation only, never auto-executed.** Dashboard shows an "Apply" button that sends a normal command with `source = "ai"`. | §11.5, §12 |
| D7 | Local display | **LCD 16x2 I2C** (not OLED). | §4.3, §7.7 |
| D8 | Offline telemetry buffering | **Out of MVP.** Telemetry produced while offline is dropped. | §15 |
| D9 | Auth | **None in MVP.** Backend binds to localhost and restricts CORS to the dashboard origin. | §17 |
| D10 | Live values on the dashboard | Backend re-broadcasts **every valid telemetry message** on a Supabase Realtime **Broadcast** channel (not persisted). Live cards use Broadcast; charts/history use the downsampled DB rows. | §9.3, §12.3 |
| D11 | Device network I/O | Wi-Fi/MQTT/NTP run in a **dedicated FreeRTOS task (core 0)**; sensors, rules and actuators run in `loop()` (core 1). They exchange data through FreeRTOS queues. | §6.4, §7.1 |
| D12 | Tooling | **Node.js 24 LTS** (Active LTS until 2028-04; 22 is in maintenance), **pnpm workspaces** (`server`, `dashboard`, `packages/contracts`), **Vitest** for backend tests, Supabase CLI for migrations. | §9, §18 |
| D13 | ESP32 Arduino core | **Arduino core 2.x** through the official PlatformIO `espressif32` platform (pinned). Core 3.x (pioarduino fork) only if a library forces it; then update §4.7 in one go. | §4.7 |

---

## 1. Project Overview

### 1.1 Project Name
**AIoT Smart Environment & Safety System**

### 1.2 Purpose
Build a complete AIoT system that monitors environmental conditions, performs local edge processing, sends telemetry through MQTT, stores data in Supabase, runs cloud AI analysis, and provides a custom web dashboard for realtime monitoring and device control.

The first version uses **Wokwi as the hardware simulator** instead of a physical circuit. The architecture must remain compatible with migration to a real ESP32-S3 device later with minimal changes.

### 1.3 Main Goals
- Simulate an ESP32-S3-based AIoT device in Wokwi.
- Collect environmental sensor data.
- Perform basic preprocessing and edge rules locally.
- Support Edge AI / TinyML in a later phase.
- Use MQTT for device-to-cloud communication.
- Use Node.js + TypeScript as the backend processing layer.
- Use Supabase PostgreSQL for persistent storage.
- Use Supabase Realtime for dashboard updates.
- Support cloud AI analysis using an external LLM/ML API.
- Build a custom Next.js dashboard.
- Support remote/manual control from the dashboard back to the ESP32.
- Export telemetry data to CSV for coursework and model training.

---

## 2. High-Level Architecture

```text
┌──────────────────────────────┐
│   Wokwi (VS Code extension)  │
│        ESP32-S3              │
│                              │
│ Sensors → Edge Logic → MQTT  │
│            │                 │
│            ├─ Edge Rules     │
│            └─ TinyML later   │
└──────────────┬───────────────┘
               │ MQTT (via Wokwi Private IoT Gateway)
               ▼
┌──────────────────────────────┐
│        MQTT Broker           │
│   Mosquitto (local, :1883)   │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐        ┌────────────────┐
│    Node.js + TypeScript      │───────▶│   Cloud AI     │
│          Backend             │        │ mock / LLM API │
│ - MQTT consumer              │        └────────────────┘
│ - Validation (Zod)           │
│ - Dedup + downsampling       │
│ - Device presence tracking   │
│ - Command routing + timeout  │
│ - AI scheduler               │
│ - CSV logging                │
│ - REST API                   │
└──────────────┬───────────────┘
               │ service role key
               ▼
┌──────────────────────────────┐
│       Supabase Cloud         │
│ - PostgreSQL (RLS on)        │
│ - Realtime                   │
└──────────────┬───────────────┘
               │ anon key (read only)
               ▼
┌──────────────────────────────┐
│     Next.js Dashboard        │
│ - Realtime values & charts   │
│ - Device status              │
│ - AI recommendations         │
│ - Manual controls ──────────────▶ Backend REST API → MQTT → ESP32
└──────────────────────────────┘
```

---

## 3. System Scope

### 3.1 In Scope
- ESP32-S3 simulation using Wokwi.
- Multiple environmental sensors.
- Local status display (LCD 16x2 I2C).
- LEDs, buzzer, and servo actuator.
- Wi-Fi connectivity in Wokwi.
- MQTT publish/subscribe with command acknowledgement.
- Backend service.
- Supabase integration.
- Realtime dashboard.
- Cloud AI analysis.
- Manual actuator control with time-limited override.
- CSV telemetry logging and export.
- Edge rule engine with hysteresis.
- TinyML integration in a later phase.

### 3.2 Out of Scope for Initial MVP
- Physical PCB design.
- Real production deployment.
- Large-scale multi-tenant device management.
- OTA firmware updates.
- Remote configuration of thresholds (thresholds are compile-time config in MVP).
- Offline telemetry buffering / replay (D8).
- Authentication and authorization (D9).
- Production-grade billing.
- Mobile application.
- High-availability MQTT cluster.
- Advanced MLOps pipeline.

---

## 4. Device Simulation

### 4.1 Main Controller
**ESP32-S3** (PlatformIO board: `esp32-s3-devkitc-1`, Wokwi part: `board-esp32-s3-devkitc-1`).

Reasons:
- Wi-Fi capable.
- Suitable for Edge AI / TinyML.
- Supported by Wokwi.
- Can later be replaced by a physical ESP32-S3 device.

### 4.2 Simulated Sensors

| Sensor / Input | Purpose | Sampling | Output unit |
|---|---|---|---|
| DHT22 | Temperature + humidity | **every 2 s** (DHT22 max rate is 0.5 Hz) | °C, %RH |
| Photoresistor (LDR module, analog out) | Ambient light | every 1 s | lux (estimated, see §4.6) |
| PIR | Human presence | every 1 s | boolean |
| Potentiometer | Simulated air quality | every 1 s | AQ index 0–1000 (see §4.6) |
| Push button | Local mute / clear override | edge-triggered | — |

### 4.3 Actuators

| Actuator | Purpose |
|---|---|
| Green LED | NORMAL state |
| Yellow LED | UNCOMFORTABLE (steady) / WARNING (blinking 2 Hz) |
| Red LED | DANGER state |
| Buzzer | Critical alert (DANGER: 500 ms on / 500 ms off) |
| Servo | Simulated window: 0° = closed, 90° = fully open |
| LCD 16x2 I2C (addr `0x27`) | Local status display |

### 4.4 Pin Map (proposed — `diagram.json` must match)

| Function | GPIO | Notes |
|---|---|---|
| LDR analog out | 1 | ADC1_CH0 (ADC2 is unusable while Wi-Fi is active) |
| Potentiometer wiper | 2 | ADC1_CH1 |
| DHT22 data | 15 | |
| PIR out | 16 | |
| Push button | 17 | `INPUT_PULLUP`, active LOW, 50 ms debounce |
| Servo signal | 18 | ESP32Servo |
| Buzzer | 21 | LEDC tone, 2 kHz |
| Green LED | 38 | via 220 Ω |
| Yellow LED | 39 | via 220 Ω |
| Red LED | 40 | via 220 Ω |
| LCD SDA / SCL | 8 / 9 | I2C |

Avoid: GPIO0/3/45/46 (strapping), 19/20 (USB), 26–37 (flash/PSRAM).

### 4.5 Wokwi Setup
- Use **Wokwi for VS Code** with PlatformIO; `wokwi.toml` points to the PlatformIO build output (`firmware.bin` / `firmware.elf`).
- Wi-Fi SSID: `Wokwi-GUEST`, no password.
- Enable the **Wokwi Private IoT Gateway** (per Wokwi docs) so the simulated ESP32 can reach the host machine. Inside the simulation the host is reachable as `host.wokwi.internal`, so the broker address is `host.wokwi.internal:1883`.
- **Fallback (D1):** set `MQTT_HOST` to a public broker and `MQTT_TOPIC_PREFIX` to a unique value (e.g. `aiot-<random6>`). No other code change allowed for this switch. On a public broker, anyone can read and publish to your topics.
- Verify the Wokwi VS Code license and gateway availability in **Phase 0** (spike, §19) before any other work. If the gateway is not available, switch to the D1 fallback right away.

### 4.6 Sensor Value Mapping

```text
airQuality = round(adcPot / 4095 * 1000)             // 0–1000, unitless "AQ index"

// Wokwi photoresistor formula adapted to ESP32 (12-bit ADC, 3.3 V supply)
voltage    = adcLdr / 4095 * 3.3
resistance = 10000 * voltage / (3.3 - voltage)       // module divider, 10 kΩ fixed resistor; guard: voltage >= 3.3 → light = 0; voltage <= 0 → light = 100000
light      = pow(RL10 * 1e3 * pow(10, GAMMA) / resistance, 1 / GAMMA)
             // RL10 = 50, GAMMA = 0.7; clamp result to 0…100000
```

Wokwi's Arduino example writes the divider as `2000 * voltage / (1 - voltage / 5)`, where 2000 = 10 kΩ / 5 V. Keep the 10 kΩ, not the 2000, when the supply changes.

If the Wokwi module's AO output turns out inverted (bright → low voltage), invert `adcLdr` (`4095 - adcLdr`) in `sensors.cpp`. Check this in Phase 1.

The mapping lives in `sensors.cpp` only. Replacing the potentiometer with a real MQ/CO2 sensor later means changing only this mapping.

### 4.7 Firmware Libraries

| Library | Use |
|---|---|
| `knolleary/PubSubClient` | MQTT. Call `setBufferSize(1280)` (default 256 B is too small; the buffer holds header + topic + payload, so it must exceed the 1024 B payload limit of §6.5). |
| `bblanchon/ArduinoJson` v7 | JSON encode/decode |
| `beegee-tokyo/DHTesp` | DHT22 |
| `madhephaestus/ESP32Servo` | Servo |
| `marcoschwartz/LiquidCrystal_I2C` | LCD |

PubSubClient only publishes at QoS 0. This is why commands require an application-level ack (§6.6).

Pin every library version and the platform version in `platformio.ini` (`lib_deps = name@x.y.z`, `platform = espressif32@x.y.z`) so the build stays reproducible.

Use an ESP32Servo release that supports the pinned core 2.x (D13). Record the chosen versions in `platformio.ini` during Phase 0.

**LEDC sharing:** ESP32Servo and the buzzer tone both use LEDC. Call `ESP32PWM::allocateTimer()` for the servo first, and drive the buzzer through the core 2.x LEDC API (`ledcSetup` / `ledcAttachPin` / `ledcWriteTone`) on an explicitly chosen channel and timer that the servo does not use, instead of `tone()`. On core 2.x the timer cannot be picked directly: it is derived from the channel (`timer = (channel / 2) % 4`). Default: servo on `ESP32PWM::allocateTimer(0)`, buzzer on LEDC channel 6 (timer 3). (If D13 ever switches to core 3.x: `ledcAttachChannel` / `ledcWriteTone`.)

---

## 5. Data Contracts

All MQTT payloads are UTF-8 JSON objects.

### 5.1 Common Fields

| Field | Type | Rule |
|---|---|---|
| `v` | int | Contract version. Currently `1`. Backend rejects unknown versions. |
| `deviceId` | string | `^[a-z0-9-]{3,32}$`. Must equal the `{deviceId}` in the topic. |
| `bootId` | string | 8 hex chars, random per boot (`esp_random()`). |
| `seq` | uint32 | Monotonic counter per boot, shared by telemetry and events. |
| `ts` | int64 \| null | Epoch **milliseconds** UTC from NTP (`pool.ntp.org`). `null` until NTP has synced once. |

**Dedup key:** `(deviceId, bootId, seq)`.

**Measurement time used by the backend (`measured_at`):** `ts` if non-null **and** within ±5 min of server time; otherwise the server receive time.

### 5.2 Enums

```text
EdgeState     : NORMAL | UNCOMFORTABLE | WARNING | DANGER
CommandAction : OPEN_WINDOW | CLOSE_WINDOW | BUZZER_ON | BUZZER_OFF | CLEAR_OVERRIDE | PING
CommandSource : dashboard | ai | api
CommandStatus : pending | sent | executed | rejected | failed | timeout
AckStatus     : executed | rejected | failed
RejectReason  : INVALID_PAYLOAD | UNSUPPORTED_VERSION | UNKNOWN_ACTION | VALUE_OUT_OF_RANGE
Severity      : info | warning | critical
RiskLevel     : low | medium | high | critical
AiTrigger     : schedule | danger_event | manual
```

### 5.3 Telemetry — `{prefix}/{deviceId}/telemetry`

Published every `TELEMETRY_INTERVAL_MS` (default 2000), **and immediately after every edge state change** (the periodic timer then restarts from that publish). QoS 0, not retained. The immediate publish goes out right after the `STATE_CHANGED` event, so the backend always has a row with the new state (§9.3 downsampling, §11.4).

```json
{
  "v": 1,
  "deviceId": "room-01",
  "bootId": "a1b2c3d4",
  "seq": 1532,
  "ts": 1790591200123,
  "temperature": 31.2,
  "humidity": 75.4,
  "light": 420.5,
  "airQuality": 680,
  "presence": true,
  "edgeState": "WARNING",
  "actuators": { "windowAngle": 0, "buzzer": false },
  "override": { "window": false, "buzzer": false }
}
```

Rules:
- `temperature`, `humidity` are `null` while the DHT22 is in fault (§7.2), **and after boot until the first valid DHT22 reading**. `light` and `airQuality` are always present.
- Telemetry is not published until each analog channel has at least one valid sample.
- Values are the **smoothed** values used by the rule engine (§7.2), rounded to 1 decimal.
- `actuators.buzzer` is the **logical** alarm state (`true` while the DANGER pattern or `BUZZER_ON` is active), not the pin level that toggles every 500 ms. The same holds in status and ack payloads, so the pattern itself never triggers a status publish.
- Ranges (backend validation): temperature −40…80, humidity 0…100, light 0…100000, airQuality 0…1000.

### 5.4 Status — `{prefix}/{deviceId}/status`

**Retained**, so the backend gets the latest status right after it (re)connects.

Published:
- on MQTT connect,
- every `STATUS_INTERVAL_MS` (default 30000) as a heartbeat,
- immediately after any actuator/override change (including after executing a command).

```json
{
  "v": 1,
  "deviceId": "room-01",
  "online": true,
  "bootId": "a1b2c3d4",
  "ts": 1790591200123,
  "fw": "0.1.0",
  "uptimeSec": 3605,
  "rssi": -55,
  "edgeState": "WARNING",
  "actuators": { "windowAngle": 0, "buzzer": false },
  "override": { "window": false, "buzzer": false, "expiresInSec": 0 },
  "sensorFault": { "dht": false }
}
```

**Last Will** (registered on connect, retained):

```json
{ "v": 1, "deviceId": "room-01", "online": false }
```

MQTT keepalive is 15 s, so the broker publishes the Last Will about 20–25 s after the device disappears.

The backend validates status with a **union on `online`**: `online: true` → full schema above; `online: false` → `{ v, deviceId, online: false }` (extra fields allowed and ignored).

### 5.5 Event — `{prefix}/{deviceId}/event`

QoS 0, not retained. Uses the same `seq` counter as telemetry.

```json
{
  "v": 1,
  "deviceId": "room-01",
  "bootId": "a1b2c3d4",
  "seq": 1533,
  "ts": 1790591200500,
  "type": "STATE_CHANGED",
  "severity": "critical",
  "message": "WARNING -> DANGER",
  "data": { "from": "WARNING", "to": "DANGER", "reasons": ["airQuality>=900"] }
}
```

| `type` | Severity | When | `data` |
|---|---|---|---|
| `BOOT` | info | First MQTT connect after boot | `{ fw, resetReason }` |
| `STATE_CHANGED` | info (→NORMAL/UNCOMFORTABLE), warning (→WARNING), critical (→DANGER) | Every edge state transition | `{ from, to, reasons[] }` |
| `SENSOR_FAULT` | warning | DHT22 invalid for > 10 s | `{ sensor: "dht" }` |
| `SENSOR_RECOVERED` | info | DHT22 valid again | `{ sensor: "dht" }` |
| `BUTTON_PRESSED` | info | Short or long press | `{ press: "short" \| "long" }` |
| `OVERRIDE_SET` | info | Override started | `{ actuator, value, durationSec, source }` |
| `OVERRIDE_CLEARED` | info | Override ended | `{ actuator, reason: "expired" \| "escalation" \| "command" \| "button" }` |
| `COMMAND_REJECTED` | warning | Command could not be acked (no parsable `commandId`) | `{ raw: "<first 128 chars>" }` |

Events are published on transitions only, never once per cycle.

### 5.6 Command — `{prefix}/{deviceId}/command`

Backend → device. **QoS 1, not retained.**

```json
{
  "v": 1,
  "commandId": "7f1c2a9e-4b1d-4a5e-9d7a-2b6c1f0e8a11",
  "action": "OPEN_WINDOW",
  "value": 90,
  "source": "dashboard",
  "ts": 1790591200000
}
```

| `action` | `value` | Device effect |
|---|---|---|
| `OPEN_WINDOW` | int 1–90, optional (default 90) | Servo to `value`°. Sets window override. |
| `CLOSE_WINDOW` | ignored | Servo to 0°. Sets window override. |
| `BUZZER_ON` | ignored | Buzzer on (DANGER pattern). Sets buzzer override. |
| `BUZZER_OFF` | ignored | Buzzer off (= mute). Sets buzzer override. |
| `CLEAR_OVERRIDE` | ignored | Clears all overrides. Edge rules take control again immediately. |
| `PING` | ignored | No effect; acks `executed`. Connectivity test. |

`commandId` is a UUID generated by the backend (= `commands.id`).

### 5.7 Command Ack — `{prefix}/{deviceId}/command/ack`

Device → backend, sent right after handling a command. QoS 0.

```json
{
  "v": 1,
  "deviceId": "room-01",
  "commandId": "7f1c2a9e-4b1d-4a5e-9d7a-2b6c1f0e8a11",
  "status": "executed",
  "reason": null,
  "ts": 1790591200350,
  "actuators": { "windowAngle": 90, "buzzer": false },
  "override": { "window": true, "buzzer": false, "expiresInSec": 120 }
}
```

Device-side rules:
- The device keeps the last **16** `commandId`s with their ack result. A duplicate (QoS 1 redelivery) is re-acked with the stored result and **not re-executed**.
- Invalid JSON, or no `commandId` → publish a `COMMAND_REJECTED` event (no ack possible).
- Otherwise validation failure → ack `rejected` with a `RejectReason`.

### 5.8 AI Analysis (stored in `ai_analysis`, not sent over MQTT)

**One naming set is used everywhere** (LLM output, DB, API, dashboard):

```json
{
  "riskLevel": "medium",
  "summary": "Temperature and humidity have been elevated for 10 minutes.",
  "recommendation": "Increase ventilation.",
  "suggestedAction": "OPEN_WINDOW"
}
```

- `summary`, `recommendation`: at most 280 chars each.
- `suggestedAction`: one of `OPEN_WINDOW | CLOSE_WINDOW | BUZZER_OFF | NONE`.

---

## 6. MQTT Design

### 6.1 Broker
- Default (D1): local **Mosquitto 2.x** on `:1883`, reached from Wokwi through the Private IoT Gateway.
- Dev config (`broker/mosquitto.conf`):
  ```conf
  listener 1883 127.0.0.1      # use 0.0.0.0 only if the gateway/broker runs in Docker/WSL
  allow_anonymous true         # local only, never exposed
  persistence true             # keep retained status across broker restarts
  persistence_location ./mosquitto-data/
  autosave_interval 10         # seconds; the default (1800) loses retained messages if the broker is killed
  ```
- Mosquitto only writes its database on a clean exit or every `autosave_interval`. Without the short interval, a broker killed by `taskkill /F` or by closing its window loses the retained status published since the last save.
- Fallback: public broker + unique `MQTT_TOPIC_PREFIX`.

### 6.2 Topics

`{prefix}` = `MQTT_TOPIC_PREFIX`, default `aiot`.

| Topic | Direction | QoS | Retained |
|---|---|---|---|
| `{prefix}/{deviceId}/telemetry` | device → backend | 0 | no |
| `{prefix}/{deviceId}/status` | device → backend (+ LWT) | 0 (LWT 1) | **yes** |
| `{prefix}/{deviceId}/event` | device → backend | 0 | no |
| `{prefix}/{deviceId}/command` | backend → device | 1 | no |
| `{prefix}/{deviceId}/command/ack` | device → backend | 0 | no |

### 6.3 Subscriptions
- **Device** subscribes to `{prefix}/{deviceId}/command` (QoS 1).
- **Backend** subscribes to `{prefix}/+/telemetry`, `{prefix}/+/status`, `{prefix}/+/event`, `{prefix}/+/command/ack`.

### 6.4 Client IDs and Connection
- Device client ID: `dev-{deviceId}`, `cleanSession = true`, keepalive 15 s. Wokwi runs slower than real time, so an idle client pings about every 20 s of wall-clock time, close to the broker's 22.5 s limit (1.5 × keepalive). 15 s is still kept, because the broker resets that timer on every packet from the client and telemetry goes out every 2 s.
- Backend client ID: `aiot-server-{random}`, keepalive 30 s, auto-reconnect (mqtt.js `reconnectPeriod` 2000 ms).
- Device reconnect: exponential backoff 1 s → 2 s → 4 s … capped at 30 s. Wi-Fi reconnect uses the same backoff.
- **The sensor/rule loop must never block on network (D11).** PubSubClient's `connect()` and `WiFiClient::connect()` are blocking, so all network work (Wi-Fi, NTP, MQTT connect/loop/publish) runs in a dedicated FreeRTOS task pinned to core 0 (`net_task`, stack ≥ 8 KB). `loop()` on core 1 pushes outgoing messages to a queue (depth 16, drop oldest when full) and pops received commands from another queue. The net task also sets `client.setSocketTimeout(3)` and `wifiClient.setTimeout(3)` so one attempt is bounded. On Arduino core 2.x (D13), `WiFiClient::setTimeout()` takes **seconds** (`_timeout = seconds * 1000`), so `setTimeout(3000)` would mean 3000 s.
- PubSubClient is not thread-safe: only the net task touches the MQTT client.

**Net task ↔ `loop()` interface:**

| Item | Owner / mechanism |
|---|---|
| `outQueue` (loop → net) | Items are `{ char topic[64]; char payload[1024]; uint16_t len; bool retain; }`. "Drop oldest" = when `xQueueSend` fails, `xQueueReceive` one item and send again. |
| `cmdQueue` (net → loop) | Raw command payloads (same item type, depth 4). Parsing, validation, dedup and ack building happen in `loop()`; the ack is pushed to `outQueue`. |
| `netOnline` | `std::atomic<bool>` written by the net task (true while MQTT is connected). Read by `loop()` for the LCD `NET`/`OFF` slot. |
| Connect handshake | After each successful MQTT connect (and subscribe), the net task sends a task notification to `loop()`. `loop()` then enqueues a status and, on the first connect since boot only, the `BOOT` event. The net task never builds payloads itself; the LWT payload is static. |
| `seq` | Incremented only in `loop()` when a telemetry/event payload is built. |
| Offline | While `netOnline` is false, `loop()` does not enqueue telemetry, events or status (D8), and the net task empties `outQueue` when the connection drops. This prevents a burst of stale messages on reconnect. |

### 6.5 Payload Limits
- Maximum payload size 1024 bytes. Backend drops larger messages and logs a warning.

### 6.6 Command Round Trip

```text
Dashboard ──POST /api/devices/room-01/commands──▶ Backend
Backend: insert commands row (status=pending)
Backend: MQTT publish command (QoS 1) ─ success ─▶ status=sent, sent_at=now()
                                                   (only WHERE status='pending')
Device : validate → execute → publish status (retained) → publish ack
Backend: on ack → status=executed|rejected|failed, acked_at=now(), reason
                                                   (only WHERE status IN ('pending','sent'))
Backend: no ack COMMAND_ACK_TIMEOUT_SEC (10 s) after created_at → status=timeout + server event COMMAND_TIMEOUT
                                                   (only WHERE status IN ('pending','sent'))
Supabase Realtime ─▶ Dashboard updates the command row and actuator state
```

- Device offline when the command is requested → backend still creates the row, then marks it `failed` with reason `DEVICE_OFFLINE`, without publishing. API returns `409`.
- Backend not connected to the broker (`client.connected === false`) → row marked `failed` with reason `BROKER_DISCONNECTED`, without publishing. API returns `503`. The backend never relies on the mqtt.js offline queue for commands, so a command can never be delivered after the broker comes back.
- Publish error → `failed` with reason `PUBLISH_ERROR`.
- `failed` reasons: `DEVICE_OFFLINE | BROKER_DISCONNECTED | PUBLISH_ERROR`, or the device's `RejectReason` / failure reason for `rejected` / `failed` acks.
- A late ack arriving after `timeout` is logged but does not change the status.
- **Race:** the ack can arrive before the `sent` update is written. Every status update is therefore a conditional update (as shown above), so a late `sent` never overwrites `executed`. If the ack wins, `sent_at` is still filled in by the publish callback (`update … set sent_at = coalesce(sent_at, now())`).

---

## 7. Edge Processing

### 7.1 Loop and Timing
Single non-blocking `loop()` scheduled with `millis()`:

| Task | Default interval | Config constant |
|---|---|---|
| Analog sensors + PIR | 1000 ms | `SAMPLE_INTERVAL_MS` |
| DHT22 | 2000 ms | `DHT_INTERVAL_MS` |
| Rule evaluation | 1000 ms (after each sample) | — |
| Telemetry publish | 2000 ms, plus immediately on state change (§5.3) | `TELEMETRY_INTERVAL_MS` |
| Status heartbeat | 30000 ms | `STATUS_INTERVAL_MS` |
| LCD refresh | 500 ms | `LCD_INTERVAL_MS` |
| Blink / buzzer pattern | 250 ms tick | — |

All constants live in `device/include/config.h`.

Network work (Wi-Fi, NTP, MQTT) is **not** part of this loop; it runs in the net task (§6.4, D11).

**Testability:** the smoothing, state machine and override logic live in `device/lib/edge_rules/` as plain C++ with **no Arduino includes**. Time is passed in as a `nowMs` argument, and actuator outputs are returned as a struct instead of being written to pins. `src/` wires it to the hardware. This lets `pio test -e native` build it (PlatformIO native tests cannot build code that includes `Arduino.h`).

### 7.2 Preprocessing
- **Invalid-value filtering:** discard NaN and out-of-range values (§5.3 ranges). A discarded sample keeps the previous smoothed value.
- **Sensor fault:** DHT22 invalid for > 10 s → `sensorFault.dht = true`, `temperature`/`humidity` become `null` in telemetry, a `SENSOR_FAULT` event is sent, the LCD shows `DHT ERR`. Temperature and humidity conditions are then **ignored** by the rules, and the state is computed from airQuality only.
- **Null semantics in rules:** a `null` input (fault, or no valid reading yet after boot) makes every ENTER condition on it **false** and every EXIT condition on it **true**. Before the first valid DHT22 reading the rules therefore run on airQuality only, without raising `SENSOR_FAULT` (the 10 s fault timer starts at boot).
- **Smoothing:** moving average over the last `SMOOTH_WINDOW` valid samples (default 3) for temperature, humidity, light, airQuality. Presence is raw.
- **Rules run on smoothed values.**
- Derived features (computed on the backend for AI/ML, not on the device in MVP): air-quality trend, temperature change rate, presence duration.

### 7.3 Edge States

| Level | State |
|---|---|
| 0 | NORMAL |
| 1 | UNCOMFORTABLE |
| 2 | WARNING |
| 3 | DANGER |

### 7.4 Thresholds (with hysteresis)

| State | Enter when (ANY) | Exit allowed when (ALL) |
|---|---|---|
| DANGER | temp ≥ 34.0 OR aq ≥ 900 | temp < 33.0 AND aq < 850 |
| WARNING | temp ≥ 31.0 OR aq ≥ 700 | temp < 30.0 AND aq < 650 |
| UNCOMFORTABLE | temp ≥ 29.0 OR hum ≥ 75 OR aq ≥ 500 | temp < 28.5 AND hum < 72 AND aq < 470 |
| NORMAL | none of the above | — |

All thresholds are constants in `config.h`. With these thresholds every input maps to exactly one state, so there is no gap.

### 7.5 State Evaluation Algorithm

```text
target = highest level whose ENTER condition is true (0 if none)

if target > current:
    current = target                          # escalate immediately
elif target < current:
    if EXIT(current) is true AND timeInState >= MIN_STATE_HOLD_MS (default 5000):
        current = current - 1                 # step down ONE level per evaluation
# else unchanged

on change: publish STATE_CHANGED event, apply actions (§7.6)
```

This means DANGER → NORMAL takes at least 3 evaluations, and each step must satisfy that level's exit condition. This prevents flapping at the thresholds.

### 7.6 Actions per State and Manual Override (D2)

| State | Green | Yellow | Red | Buzzer | Window (servo) |
|---|---|---|---|---|---|
| NORMAL | on | off | off | off | 0° (closed) |
| UNCOMFORTABLE | off | on (steady) | off | off | hold current |
| WARNING | off | blinking 2 Hz | off | off | hold current |
| DANGER | off | off | on | 500 ms on/off | 90° (open) |

**Override rules:**
1. A command on the window (`OPEN_WINDOW`/`CLOSE_WINDOW`) or buzzer (`BUZZER_ON`/`BUZZER_OFF`) sets an override **for that actuator only**, lasting `MANUAL_OVERRIDE_SEC` (default 120).
2. While an override is active, the edge engine does **not** drive that actuator. State, LEDs, LCD and events keep working normally.
3. An override ends when any of these happens:
   - it expires → `reason: "expired"`,
   - the state **escalates** above the level it had when the override was set (e.g. set in WARNING, then DANGER) → `reason: "escalation"`,
   - `CLEAR_OVERRIDE` is received → `reason: "command"`,
   - the button is long-pressed → `reason: "button"`.
4. When an override ends, the actuator immediately goes back to the value the current state requires. For "hold current" states (UNCOMFORTABLE, WARNING), the required window angle is the **last angle set by the edge engine** (not the angle set by the override). The edge engine keeps this `edgeWindowAngle` updated even while an override is active; at boot it is 0°.
   **Exception — escalation:** when a window override ends with `reason: "escalation"` and the new state is a "hold current" state, the required angle is `max(current angle, edgeWindowAngle)` and `edgeWindowAngle` is set to that value. A more open window is the safer side, so an escalation never closes a window the user opened (e.g. `OPEN_WINDOW` in NORMAL, then temperature rises to UNCOMFORTABLE → the window stays open).
5. LEDs are never overridable.

**Push button:**
- Short press (< 2 s): mute the buzzer (buzzer override OFF for `MANUAL_OVERRIDE_SEC`). Works offline.
- Long press (≥ 2 s): clear all overrides.

### 7.7 LCD 16x2 Layout

```text
Row 0: T31.2 H75 A680      (temperature, humidity, airQuality)
Row 1: WARNING  NET OV     (state label padded to 8 | "NET" online / "OFF" offline | "OV" when any override is active)
```

State labels (max 8 chars): `NORMAL`, `UNCOMF`, `WARNING`, `DANGER`.

Row 0 shows `T--.- H-- A680` before the first valid DHT22 reading, and `DHT ERR A680` during a DHT fault. Every row is padded with spaces to 16 chars so old characters are overwritten.

Row 0 must never exceed 16 chars. The worst case `T-12.5 H100 A1000` is 17, so when the formatted row is longer than 16, drop the temperature decimal (`T-12 H100 A1000`).

---

## 8. Edge AI / TinyML

### 8.1 Strategy
TinyML is not required for the MVP.

Implementation phases:
1. Rule engine (MVP).
2. Mock classifier behind the same interface (`edge_ai.h`: `EdgeState classify(const Features&)`).
3. Real TinyML model.

The rule engine always stays the **safety authority**. In Phase 7 the model's output is published as an extra telemetry field `mlState` and compared with the rule engine; it does not drive actuators unless a later decision says so.

### 8.2 Inputs (normalized to 0–1 by fixed ranges from §5.3)

```text
temperature, humidity, airQuality, light, presence
```

### 8.3 Outputs

```text
0 = NORMAL, 1 = UNCOMFORTABLE, 2 = WARNING, 3 = DANGER
```

### 8.4 Candidate Model

```text
Input: 5 features
Dense(16) + ReLU
Dense(8)  + ReLU
Dense(4)  + Softmax
Quantization: int8 (post-training)
```

### 8.5 Training Flow

```text
data/telemetry-*.csv  (labels = edge_state from the rule engine)
   ↓ ml/preprocess.py  (drop rows with null temp/hum, normalize, stratified split 70/15/15)
   ↓ ml/train.py       (TensorFlow/Keras)
   ↓ TFLite int8 model
   ↓ xxd → model_data.cc
   ↓ TensorFlow Lite Micro on ESP32-S3
```

Reported metrics: accuracy, per-class F1, confusion matrix, and agreement rate vs the rule engine.

Note: with rule-engine labels, the model learns to imitate the rules. For the coursework, state this explicitly or add manually labelled scenarios.

---

## 9. Backend Specification

### 9.1 Technology
- Node.js 24 LTS + TypeScript (strict)
- `mqtt` (mqtt.js v5), protocol **MQTT 3.1.1** (`protocolVersion: 4`, the default). Do not switch to MQTT 5 with `rap: true`: the `retain` flag would then stay set on live messages and presence (§9.3) would ignore them.
- `@supabase/supabase-js` v2 (service role key)
- **Fastify** (HTTP API)
- **Zod v3** (pinned major; validation of every MQTT payload and API body). On Zod v4, replace `.passthrough()` with `z.looseObject`.
- `csv-stringify` (CSV)
- `pino` (structured logging)
- AI provider SDK behind the `AiProvider` interface
- **Vitest** (unit tests), `tsx` (dev runner)
- Package manager: **pnpm workspaces** (D12). Zod contracts live in `packages/contracts` and are imported by both `server` and `dashboard`.
- `@aiot/contracts` ships TypeScript source (`"exports": { ".": "./src/index.ts" }`). The server runs it through `tsx` in dev and bundles it with `tsup` for `start` (set `noExternal: ['@aiot/contracts']`; tsup externalizes dependencies by default, and Node would then try to load the `.ts` source at runtime and crash); the dashboard sets `transpilePackages: ['@aiot/contracts']` in `next.config`.

### 9.2 Environment Variables (`server/.env.example`)

```bash
PORT=4000
HOST=127.0.0.1
CORS_ORIGIN=http://localhost:3100   # dashboard dev server port

MQTT_URL=mqtt://127.0.0.1:1883   # not "localhost": it can resolve to ::1 on Windows, and Mosquitto listens on 127.0.0.1 only
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_TOPIC_PREFIX=aiot

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=   # secret key (sb_secret_…) or legacy service_role JWT

AUTO_REGISTER_DEVICES=true
TELEMETRY_PERSIST_INTERVAL_SEC=5
DEVICE_OFFLINE_AFTER_SEC=45   # + 10 s sweep interval → offline shown within 60 s even without LWT (§9.4)
COMMAND_ACK_TIMEOUT_SEC=10

CSV_DIR=../data

AI_PROVIDER=mock          # mock | gemini
AI_API_KEY=               # Google AI Studio key, required for gemini
AI_MODEL=                 # default gemini-3.1-flash-lite
AI_INTERVAL_MIN=10
AI_WINDOW_MIN=10
AI_COOLDOWN_SEC=30        # one analysis per device per 30 s (DANGER has its own 30 s limit)
AI_TIMEOUT_MS=8000        # 2 attempts × 8 s stays inside the 20 s DANGER target (§19 Phase 6)
```

Config is validated with Zod at startup; the process exits on invalid config.

### 9.3 Ingestion Pipeline

```text
MQTT message
 → topic parse (prefix, deviceId, kind); unknown kind → drop
 → size check (≤ 1024 B)
 → JSON.parse; error → log warn, drop
 → Zod validate by kind; error → log warn with issues, drop
 → topic deviceId == payload deviceId, else drop
 → resolve device: device_code → devices.id
       unknown + AUTO_REGISTER_DEVICES=true → insert device (name = device_code)
       unknown + false → drop
 → presence.touch(device, packet)   (see "Presence" below)
 → route by kind (below)
```

**Presence (`device.service`, the only place that changes `devices.status`):**
- Skip entirely for the LWT (`status` with `online: false`) and for any message with `packet.retain = true`. Retained messages can be stale, for example a retained status replayed when the backend restarts.
- Otherwise: keep `lastSeenAt` in memory. If the in-memory state was `offline`/`unknown` → set `status = online`, write `last_seen_at`, insert server event `DEVICE_ONLINE`.
- **Throttled DB writes:** `devices.last_seen_at` / `edge_state` are written only when a value changes, or at most every 15 s. This avoids a `devices` UPDATE (and a Realtime push) every 2 s.
- The in-memory presence state is loaded from `devices` at startup.

| Kind | Handling |
|---|---|
| telemetry | Append to CSV (every valid message, D5). **Broadcast** to the dashboard (D10, below). Persist to DB per the downsampling rule below. Update `edge_state` (throttled, see Presence). |
| status | `online=false` (LWT) → mark offline + server event `DEVICE_OFFLINE` (only if not already offline). Otherwise update `devices.last_status`, `fw_version`, `boot_id`, `edge_state`. This update always runs, including for retained messages, because it carries actuator/override state. Before storing, the backend adds `override.expiresAt` (ISO) = receive time + `expiresInSec`, or `null` when `expiresInSec = 0`. For a retained message the receive time is not the publish time, so `expiresAt` is then set only if `ts` is valid (§5.1) and computed from `ts`; otherwise `null`. |
| event | Insert into `events` (`on conflict do nothing` for dedup). `STATE_CHANGED` to DANGER → trigger AI (§11.3). |
| command/ack | Update the matching `commands` row if its status is `sent`/`pending`. |

**Telemetry downsampling (per device):**
- Persist a message if ≥ `TELEMETRY_PERSIST_INTERVAL_SEC` has passed since the last persisted row, **or** `edgeState` differs from the last persisted row.
- Insert uses `on conflict (device_id, boot_id, seq) do nothing` (supabase-js: `upsert(row, { onConflict: 'device_id,boot_id,seq', ignoreDuplicates: true })`).

**Live broadcast (D10):**
- Channel `device:{deviceCode}`, event `telemetry`. The payload is the validated telemetry message plus `measuredAt` (ISO).
- Sent through the backend's Supabase client for every valid telemetry message. The backend subscribes to each `device:{deviceCode}` channel once, keeps it open, and uses `channel.send({ type: 'broadcast', … })`. Before the subscription is `SUBSCRIBED`, it uses `channel.httpSend(…)` (REST) instead of relying on the implicit REST fallback of an unsubscribed channel. It is fire-and-forget: a broadcast failure is logged and never blocks ingestion.
- The channel is public (no Realtime Authorization) in the MVP (D9).

### 9.4 Server-side Rules (MVP)
The backend does **not** automate actuators (edge-first). Its rules are:
1. **Offline detection:** every 10 s, devices that are online in the in-memory presence state with `lastSeenAt` older than `DEVICE_OFFLINE_AFTER_SEC` → offline + `DEVICE_OFFLINE` event. Uses the in-memory value because the DB `last_seen_at` is throttled.
2. **Command timeout:** every 2 s, `pending`/`sent` commands whose `created_at` is older than `COMMAND_ACK_TIMEOUT_SEC` → `timeout` + `COMMAND_TIMEOUT` event (conditional update, §6.6).
3. **AI scheduling** (§11.3).

**Server events** (`events.source = 'server'`):

| `event_type` | Severity | `payload` |
|---|---|---|
| `DEVICE_ONLINE` | info | `{ bootId }` |
| `DEVICE_OFFLINE` | warning | `{ reason: "lwt" \| "no_data" }` |
| `COMMAND_TIMEOUT` | warning | `{ commandId, action }` |
| `AI_FAILED` | warning | `{ trigger, error }` |

### 9.5 CSV Logger
- File per day: `${CSV_DIR}/telemetry-YYYY-MM-DD.csv` (UTC date), header written on file creation.
- Append-only, buffered writes, flushed at least every 5 s and on shutdown.
- Format in §13.2. `data/*.csv` is git-ignored.

### 9.6 REST API

Base: `http://127.0.0.1:4000`. JSON only. Errors return `{ "error": { "code": string, "message": string } }`.

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/health` | — | `200 { mqtt: "connected"\|"disconnected", supabase: "ok"\|"error" }` |
| GET | `/api/devices` | — | `200 Device[]` |
| GET | `/api/devices/:code` | — | `200 Device` / `404` |
| POST | `/api/devices/:code/commands` | `{ action: CommandAction, value?: number, source?: "dashboard"\|"ai" }` (`source` defaults to `"api"`; `value` validated per §5.6: `OPEN_WINDOW` 1–90, ignored otherwise) | `202 { commandId, status }` / `400` invalid / `404` device / `409 DEVICE_OFFLINE` / `429` / `503 BROKER_DISCONNECTED` |
| GET | `/api/devices/:code/commands` | `?limit=20` | `200 Command[]` (newest first) |
| GET | `/api/devices/:code/telemetry.csv` | `?from=ISO&to=ISO` (default last 24 h, max 31 days) | `200 text/csv` streamed from DB, fetched in pages of 1000 rows with keyset pagination on `(measured_at, id)` (PostgREST caps each response at 1000 rows) |
| POST | `/api/devices/:code/ai/analyze` | — | `202 { status: "started" }` / `404` device / `409 AI_BUSY` (analysis in flight) / `429 AI_COOLDOWN` (with `Retry-After`) |

- Command rate limit: 10 requests / minute / device → `429`.
- `ai/analyze` returns no id: the `ai_analysis` row only exists after a successful analysis (§11.5). The dashboard learns the result from the Realtime `ai_analysis` INSERT, or from the `AI_FAILED` server event.
- The dashboard reads history and realtime data directly from Supabase (D4). The API is used only for writes and CSV export.

### 9.7 Structure

```text
server/
├── src/
│   ├── index.ts                 # bootstrap, graceful shutdown (flush CSV, end MQTT)
│   ├── config/env.ts            # Zod-validated env
│   ├── mqtt/
│   │   ├── client.ts
│   │   ├── topics.ts
│   │   └── handlers.ts
│   ├── telemetry/
│   │   ├── telemetry.service.ts # downsampling
│   │   └── telemetry.repository.ts
│   ├── realtime/
│   │   └── broadcast.ts         # live telemetry broadcast (D10)
│   ├── devices/
│   │   ├── device.service.ts    # presence tracking (in-memory + throttled writes)
│   │   └── device.repository.ts
│   ├── events/
│   │   └── event.repository.ts
│   ├── commands/
│   │   ├── command.service.ts   # publish, ack, timeout
│   │   └── command.repository.ts
│   ├── ai/
│   │   ├── ai.service.ts        # triggers, cooldown, in-flight, retry, storage
│   │   ├── ai.repository.ts     # window reads, ai_analysis insert
│   │   ├── aggregate.ts
│   │   ├── prompts.ts
│   │   └── providers/
│   │       ├── provider.ts      # AiProvider interface
│   │       ├── mock.provider.ts
│   │       └── gemini.provider.ts
│   ├── rules/
│   │   └── server-rules.ts      # offline + timeout sweepers
│   ├── csv/
│   │   └── csv-logger.ts
│   └── api/
│       └── routes.ts
├── test/
├── .env.example
├── package.json
└── tsconfig.json

packages/contracts/           # Zod schemas + TS types for §5 (single source of truth)
├── src/
│   ├── telemetry.ts
│   ├── status.ts             # union on `online` (§5.4)
│   ├── event.ts
│   ├── command.ts
│   ├── ai.ts
│   └── index.ts
└── package.json              # name: @aiot/contracts
```

### 9.8 Contract Example (Zod)

```ts
const DeviceId = z.string().regex(/^[a-z0-9-]{3,32}$/);
const BootId = z.string().regex(/^[0-9a-f]{8}$/);
const EdgeState = z.enum(["NORMAL", "UNCOMFORTABLE", "WARNING", "DANGER"]);
const Actuators = z.object({ windowAngle: z.number().int().min(0).max(90), buzzer: z.boolean() });

export const Telemetry = z.object({
  v: z.literal(1),
  deviceId: DeviceId,
  bootId: BootId,
  seq: z.number().int().nonnegative(),
  ts: z.number().int().positive().nullable(),
  temperature: z.number().min(-40).max(80).nullable(),
  humidity: z.number().min(0).max(100).nullable(),
  light: z.number().min(0).max(100000),
  airQuality: z.number().min(0).max(1000),
  presence: z.boolean(),
  edgeState: EdgeState,
  actuators: Actuators,
  override: z.object({ window: z.boolean(), buzzer: z.boolean() }),
});

const StatusOnline = z.object({
  v: z.literal(1),
  deviceId: DeviceId,
  online: z.literal(true),
  bootId: BootId,
  ts: z.number().int().positive().nullable(),
  fw: z.string(),
  uptimeSec: z.number().int().nonnegative(),
  rssi: z.number().int(),
  edgeState: EdgeState,
  actuators: Actuators,
  override: z.object({ window: z.boolean(), buzzer: z.boolean(), expiresInSec: z.number().int().nonnegative() }),
  sensorFault: z.object({ dht: z.boolean() }),
});
const StatusOffline = z.object({ v: z.literal(1), deviceId: DeviceId, online: z.literal(false) }).passthrough();
export const Status = z.discriminatedUnion("online", [StatusOnline, StatusOffline]);
```

---

## 10. Supabase Specification

### 10.1 Services Used
- PostgreSQL, Realtime.
- Not used in MVP: Auth, Storage, Edge Functions.

### 10.2 Migration — `supabase/migrations/0001_init.sql`

```sql
-- devices -------------------------------------------------------------
create table public.devices (
  id            uuid primary key default gen_random_uuid(),
  device_code   text not null unique check (device_code ~ '^[a-z0-9-]{3,32}$'),
  name          text not null,
  status        text not null default 'unknown'
                check (status in ('online', 'offline', 'unknown')),
  edge_state    text check (edge_state in ('NORMAL','UNCOMFORTABLE','WARNING','DANGER')),
  fw_version    text,
  boot_id       text,
  last_status   jsonb,          -- latest status payload (actuators, override, sensorFault)
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- telemetry (downsampled) ----------------------------------------------
create table public.telemetry (
  id              bigint generated always as identity primary key,
  device_id       uuid not null references public.devices(id) on delete cascade,
  boot_id         text not null,
  seq             bigint not null,
  measured_at     timestamptz not null,   -- see §5.1
  device_ts       timestamptz,            -- raw device time, null if not synced
  temperature     numeric(5,2),
  humidity        numeric(5,2),
  light           numeric(10,1),
  air_quality     numeric(6,1),
  presence        boolean,
  edge_state      text not null check (edge_state in ('NORMAL','UNCOMFORTABLE','WARNING','DANGER')),
  window_angle    smallint,
  buzzer_on       boolean,
  override_active boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (device_id, boot_id, seq)
);
create index telemetry_device_measured_idx on public.telemetry (device_id, measured_at desc);

-- events ---------------------------------------------------------------
create table public.events (
  id          bigint generated always as identity primary key,
  device_id   uuid not null references public.devices(id) on delete cascade,
  source      text not null check (source in ('device', 'server')),
  boot_id     text,              -- null for server events
  seq         bigint,            -- null for server events
  event_type  text not null,     -- see §5.5 + DEVICE_ONLINE, DEVICE_OFFLINE, COMMAND_TIMEOUT, AI_FAILED
  severity    text not null check (severity in ('info', 'warning', 'critical')),
  message     text,
  payload     jsonb,
  measured_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (device_id, boot_id, seq)
);
create index events_device_created_idx on public.events (device_id, created_at desc);

-- commands -------------------------------------------------------------
create table public.commands (
  id          uuid primary key default gen_random_uuid(),   -- = commandId
  device_id   uuid not null references public.devices(id) on delete cascade,
  action      text not null check (action in
                ('OPEN_WINDOW','CLOSE_WINDOW','BUZZER_ON','BUZZER_OFF','CLEAR_OVERRIDE','PING')),
  value       integer,
  source      text not null check (source in ('dashboard', 'ai', 'api')),
  status      text not null default 'pending' check (status in
                ('pending','sent','executed','rejected','failed','timeout')),
  reason      text,
  ack_payload jsonb,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  acked_at    timestamptz
);
create index commands_device_created_idx on public.commands (device_id, created_at desc);
create index commands_open_idx on public.commands (status) where status in ('pending', 'sent');

-- ai_analysis ----------------------------------------------------------
create table public.ai_analysis (
  id               bigint generated always as identity primary key,
  device_id        uuid not null references public.devices(id) on delete cascade,
  trigger          text not null check (trigger in ('schedule', 'danger_event', 'manual')),
  provider         text not null,
  model            text,
  risk_level       text not null check (risk_level in ('low','medium','high','critical')),
  summary          text not null,
  recommendation   text not null,
  suggested_action text not null check (suggested_action in
                     ('OPEN_WINDOW','CLOSE_WINDOW','BUZZER_OFF','NONE')),
  input_snapshot   jsonb not null,   -- aggregate sent to the AI (§11.4)
  raw_response     jsonb,
  latency_ms       integer,
  created_at       timestamptz not null default now()
);
create index ai_analysis_device_created_idx on public.ai_analysis (device_id, created_at desc);

-- updated_at trigger -----------------------------------------------------
create function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger devices_set_updated_at before update on public.devices
  for each row execute function public.set_updated_at();

-- bucketed history for charts (PostgREST returns at most 1000 rows) ------
create function public.telemetry_bucketed(
  p_device_id uuid, p_from timestamptz, p_to timestamptz, p_bucket_sec int
) returns table (
  bucket      timestamptz,
  temperature numeric,
  humidity    numeric,
  light       numeric,
  air_quality numeric,
  edge_state  text          -- highest state seen in the bucket
)
language sql stable security invoker as $$
  select date_bin(make_interval(secs => p_bucket_sec), measured_at, p_from) as bucket,
         round(avg(temperature), 1), round(avg(humidity), 1),
         round(avg(light), 1),       round(avg(air_quality), 1),
         (array['NORMAL','UNCOMFORTABLE','WARNING','DANGER'])[
           max(array_position(array['NORMAL','UNCOMFORTABLE','WARNING','DANGER'], edge_state))]
  from public.telemetry
  where device_id = p_device_id and measured_at >= p_from and measured_at < p_to
  group by 1
  order by 1;
$$;
grant execute on function public.telemetry_bucketed(uuid, timestamptz, timestamptz, int) to anon, authenticated;

-- RLS: dashboard (anon) can only read; backend uses service role (bypasses RLS)
alter table public.devices     enable row level security;
alter table public.telemetry   enable row level security;
alter table public.events      enable row level security;
alter table public.commands    enable row level security;
alter table public.ai_analysis enable row level security;

create policy anon_read on public.devices     for select to anon, authenticated using (true);
create policy anon_read on public.telemetry   for select to anon, authenticated using (true);
create policy anon_read on public.events      for select to anon, authenticated using (true);
create policy anon_read on public.commands    for select to anon, authenticated using (true);
create policy anon_read on public.ai_analysis for select to anon, authenticated using (true);

-- Realtime
alter publication supabase_realtime
  add table public.devices, public.telemetry, public.events, public.commands, public.ai_analysis;
```

Migrations are applied with the Supabase CLI (`supabase link` then `supabase db push`). The seed is run once with `psql` or the SQL editor.

### 10.3 Seed — `supabase/seed.sql`

```sql
insert into public.devices (device_code, name)
values ('room-01', 'Smart Room 01')
on conflict (device_code) do nothing;
```

### 10.4 Access Rules
- **Service role key:** backend only, never in the dashboard or firmware.
- **Anon key:** dashboard, select only (RLS).
- Newer Supabase projects issue **secret** (`sb_secret_…`) and **publishable** (`sb_publishable_…`) keys instead of the legacy `service_role` / `anon` JWTs. They map to the same roles (RLS still uses `anon`), and supabase-js accepts either, so only the env values change. The env names stay `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Phase 0 result (2026-09-28):** this project issues the new format. `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `sb_publishable_…` and `SUPABASE_SERVICE_ROLE_KEY` = `sb_secret_…`. The secret key is server-only: Supabase rejects `sb_secret_…` keys in browser requests, so it must never reach the dashboard.
- Devices have no Supabase credentials at all.

### 10.5 Data Volume
At a 5 s persist interval, one device produces about 17k telemetry rows/day (about 3–5 MB/day with indexes if it runs 24/7). The free tier's 500 MB database would fill in a few months, so old rows are deleted.

**Retention** (`supabase/migrations/0002_retention.sql`): a `pg_cron` job (`aiot-retention`, daily 03:15 UTC) deletes `telemetry` older than **30 days** (`measured_at`) and `events` older than **90 days** (`created_at`). Indexes on `telemetry(measured_at)` and `events(created_at)` support it. `commands` and `ai_analysis` are small and kept. The full-resolution history stays in the backend's CSV files (D5), which ML training uses, so deleting DB rows loses no training data.

Realtime quota: the live broadcast is ~1.3M messages/month per side if the backend and a dashboard run 24/7, which is close to the free-tier monthly message quota. This is fine for normal dev/demo sessions. Do not leave the full stack running unattended for weeks. Also note that free projects pause after a period of inactivity.

---

## 11. Cloud AI

### 11.1 Purpose
Contextual reasoning that is too complex or too expensive for the ESP32: longer-term risk patterns, human-readable summaries, and recommendations.

### 11.2 Provider Interface

```ts
interface AiProvider {
  name: string;
  model: string | null;
  // Parsed JSON as returned; the service validates it against §5.8 and retries once (§11.5).
  analyze(input: AiInput, opts: { timeoutMs: number }): Promise<unknown>;
}
```

- `mock` provider: deterministic. It maps the aggregate to a risk level with fixed rules and builds template text. Used for development, tests, and the demo when no API key is set.
- LLM provider: selected by `AI_PROVIDER`, key in `AI_API_KEY`, model in `AI_MODEL`. It must request structured JSON output.

### 11.3 Triggers
| Trigger | Rule |
|---|---|
| `schedule` | Every `AI_INTERVAL_MIN` per **online** device, only if ≥ 10 telemetry rows exist in the window. |
| `danger_event` | Immediately on a `STATE_CHANGED` event to DANGER. |
| `manual` | `POST /api/devices/:code/ai/analyze`. |

- Cooldown: at most one analysis per device per `AI_COOLDOWN_SEC`. During cooldown, `manual` → `429` and `schedule` is skipped.
- **`danger_event` bypasses the cooldown** so a DANGER transition always gets an analysis. It has its own limit: at most one `danger_event` analysis per device per `AI_COOLDOWN_SEC`.
- Every successful analysis, whatever its trigger (including `danger_event`), starts the shared cooldown for `schedule` and `manual`. A failed analysis (`AI_FAILED`) does not start it.
- At most one in-flight analysis per device. A `danger_event` that arrives while another analysis is in flight is queued (depth 1) and runs right after it. A `manual` request while an analysis is in flight → `409 AI_BUSY`; a `schedule` run is skipped.

### 11.4 AI Input (aggregate, never raw samples)
Built from the `telemetry` and `events` tables over the last `AI_WINDOW_MIN`, selected and time-weighted by `created_at` (server receive time; the simulator's `ts` can drift behind real time):

```json
{
  "deviceId": "room-01",
  "windowMinutes": 10,
  "samples": 118,
  "temperature": { "avg": 31.8, "min": 29.9, "max": 34.1 },
  "humidity": { "avg": 78, "min": 74, "max": 82 },
  "airQuality": { "avg": 720, "max": 950, "trendPerMin": 18.5 },
  "presenceMinutes": 9,
  "stateSeconds": { "NORMAL": 0, "UNCOMFORTABLE": 120, "WARNING": 380, "DANGER": 100 },
  "warningEvents": 3,
  "dangerEvents": 1,
  "current": { "edgeState": "DANGER", "windowAngle": 90, "buzzer": true, "overrideActive": false },
  "trigger": "danger_event"
}
```

`trendPerMin` is the linear regression slope of airQuality over the window.

- For `danger_event`, the backend waits ~1 s before aggregating so the DANGER telemetry row is included. The device publishes that row right after the event (§5.3), and the backend persists it immediately because `edgeState` changed (§9.3).
- `current` is always taken from the **latest valid telemetry held in memory** (not from the DB), so it reflects the newest state even if a DB write is slow.
- If `samples < 2` (e.g. DANGER right after boot), the stats are built from the samples that exist; `trendPerMin` is `null` and missing stats are `null`. The mock and the prompt must handle `null`. `schedule` still requires ≥ 10 rows.

### 11.5 Output Handling
- The response is validated against the §5.8 Zod schema. If invalid: retry once, then give up.
- On failure or timeout (`AI_TIMEOUT_MS`): no row in `ai_analysis`; a server event `AI_FAILED` (severity `warning`) is written instead.
- On success: insert into `ai_analysis` (Realtime pushes it to the dashboard).
- `suggestedAction` is **never executed automatically** (D6).
- The prompt (`prompts.ts`) must state that edge rules already handle safety, and that the AI only explains and recommends.

---

## 12. Dashboard Specification

### 12.1 Technology
- Next.js (App Router) + TypeScript
- `@supabase/supabase-js` (anon key)
- Recharts
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL`

### 12.2 Main Screen (single device, `room-01`, MVP)

```text
AIOT SMART ROOM                         Device: room-01   ● Online   (last seen 2 s ago)

┌ Temperature ┐ ┌ Humidity ┐ ┌ Light ┐ ┌ Air Quality ┐ ┌ Presence ┐
│  31.2 °C    │ │  75 %    │ │ 420 lx│ │    680      │ │   Yes    │
└─────────────┘ └──────────┘ └───────┘ └─────────────┘ └──────────┘

Edge State: WARNING            Window: 0° (closed)   Buzzer: off   Override: none

Cloud AI — Risk: MEDIUM (2 min ago, trigger: schedule)
  Temperature and humidity have been elevated for 10 minutes.
  Recommendation: Increase ventilation.        [ Apply: OPEN_WINDOW ]   [ Analyze now ]

Controls:
  [ Open Window ] [ Close Window ] [ Buzzer On ] [ Buzzer Off ] [ Clear Override ]
  Recent commands: CLOSE_WINDOW · executed · 0.4 s   |   OPEN_WINDOW · timeout

Charts (range: 15 min | 1 h | 24 h):
  - Temperature over time
  - Humidity over time
  - Air quality over time (state bands in the background)

Recent events: 18:01:15 DANGER (airQuality>=900) ...

[ Export CSV ]
```

### 12.3 Data Loading
- **Initial load:** device row (lookup by `device_code` to get its `id`), the latest telemetry row, chart data for the selected range, the last 20 commands, 20 events, and the latest `ai_analysis`.
- **Chart data** comes from the `telemetry_bucketed` RPC (§10.2) so a response stays under the 1000-row PostgREST cap:

  | Range | Bucket | Max points |
  |---|---|---|
  | 15 min | 5 s | 180 |
  | 1 h | 10 s | 360 |
  | 24 h | 120 s | 720 |

- **Live values (D10):** subscribe to Broadcast channel `device:{deviceCode}`, event `telemetry` → update the value cards and presence. This is the path that meets the < 3 s requirement.
- **Postgres Changes subscriptions:**
  - `telemetry` INSERT (filter `device_id=eq.<id>`) → append to charts **only in the 15 min range**. For 1 h / 24 h, re-fetch the bucketed RPC when a new bucket starts, so raw 5 s points never mix with averaged buckets.
  - `devices` UPDATE (filter **`id=eq.<id>`**) → online status, actuators, override (`last_status`)
  - `commands` INSERT/UPDATE (filter `device_id=eq.<id>`) → command list, button pending state
  - `events` INSERT (filter `device_id=eq.<id>`) → event list
  - `ai_analysis` INSERT (filter `device_id=eq.<id>`) → AI card
- On realtime reconnect, re-run the initial load.
- Override countdown: derived from `last_status.override.expiresAt` (absolute time set by the backend, §9.3) and counted down locally. Do not use `devices.updated_at`: it also changes on presence/edge-state writes. If `expiresAt` is `null` while an override is active, show "Override: window" without a countdown.
- "Last seen … ago": use the newest of the last broadcast `measuredAt` and `devices.last_seen_at` (the DB value is throttled to 15 s).

### 12.4 Manual Control Flow

```text
Button → POST /api/devices/room-01/commands
       → button shows "pending" until the command row becomes executed/rejected/failed/timeout
       → toast with the result
       → actuator state is updated from devices.last_status (not assumed optimistically)
```

- While a command is `pending`/`sent`, the buttons for the same actuator are disabled.
- Controls are disabled while the device is offline.
- "Apply" on the AI card sends the command with `source: "ai"`.

### 12.5 UI States
| Condition | UI |
|---|---|
| Device `offline` | Grey badge "Offline", controls disabled, values dimmed |
| Latest telemetry (broadcast or DB, whichever is newer) older than 15 s while device online | "Stale data" warning badge |
| No telemetry yet | Empty state "Waiting for data…" |
| `temperature`/`humidity` null | Show "—" and "Sensor fault" tag |
| Backend API error | Toast with error message; controls re-enabled |
| Supabase realtime disconnected | Banner "Live updates paused, reconnecting…" |

---

## 13. CSV Logging

### 13.1 Requirement
- Continuous logging of every valid telemetry message by the backend (§9.5).
- On-demand export of persisted (downsampled) telemetry from the DB via `GET /api/devices/:code/telemetry.csv`.

### 13.2 CSV Format (same columns for both)

```csv
timestamp,device_id,temperature,humidity,light,air_quality,presence,edge_state,window_angle,buzzer_on,override_active
2026-09-28T18:01:00.000Z,room-01,29.1,70.0,400.0,310,true,UNCOMFORTABLE,0,false,false
2026-09-28T18:01:05.000Z,room-01,29.4,71.0,380.0,350,true,UNCOMFORTABLE,0,false,false
2026-09-28T18:01:10.000Z,room-01,31.8,78.0,360.0,720,true,WARNING,0,false,false
2026-09-28T18:01:15.000Z,room-01,34.1,82.0,350.0,930,true,DANGER,90,true,false
```

- `timestamp` = `measured_at` in ISO 8601 UTC.
- `device_id` = device code.
- Null values = empty field.

### 13.3 Uses
- Coursework submission.
- Historical analysis.
- TinyML training.
- Data mining experiments.
- Model evaluation.

---

## 14. Device States and Rules — Summary
The authoritative definitions are §7.3–§7.6. In short:

| State | Enter (ANY) | LEDs | Buzzer | Window | Event |
|---|---|---|---|---|---|
| NORMAL | none of below | green | off | close 0° | STATE_CHANGED (info) |
| UNCOMFORTABLE | temp ≥ 29 OR hum ≥ 75 OR aq ≥ 500 | yellow steady | off | hold | STATE_CHANGED (info) |
| WARNING | temp ≥ 31 OR aq ≥ 700 | yellow blink | off | hold | STATE_CHANGED (warning) |
| DANGER | temp ≥ 34 OR aq ≥ 900 | red | pattern | open 90° | STATE_CHANGED (critical) |

The exit conditions (hysteresis), the step-down rule, and the override rules apply as defined in §7.4–§7.6.

---

## 15. Offline Behavior

The device must remain safe when Wi-Fi or MQTT is unavailable.

When offline:
- Sensor sampling, smoothing and edge rules continue unchanged.
- LEDs, buzzer and servo logic continue. Overrides keep counting down; the button still works.
- The LCD shows `OFF` in the network slot.
- Wi-Fi and MQTT reconnect run in the net task with backoff (§6.4), so they never stall the edge loop.
- Telemetry and events produced while offline are **dropped** (D8). On reconnect, the device publishes the retained status, then a `BOOT` event only if this is the first connect since boot.
- Commands sent while the device is offline are refused by the backend (`409`), so there is no stale command replay.

Cloud AI is never required for safety actions.

---

## 16. Error Handling

### Device
| Case | Handling |
|---|---|
| Invalid sensor value | Discard sample, keep previous smoothed value (§7.2) |
| DHT22 timeout / fault > 10 s | `SENSOR_FAULT`, null temp/hum, rules on airQuality only |
| Wi-Fi / MQTT disconnect | Non-blocking backoff reconnect; edge logic unaffected |
| NTP not synced | `ts: null`; retry NTP every 60 s. Check sync with `getLocalTime(&tm, 0)` (default timeout is 5 s, which would block). `ts` ms comes from `gettimeofday()`: compute `(int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000`. Core 2.x (IDF 4.4) has a 32-bit `time_t`, so `tv.tv_sec * 1000` without the cast overflows. |
| Malformed command | `COMMAND_REJECTED` event, or ack `rejected` with reason |
| Duplicate command | Re-ack the stored result, no re-execution |

### Backend
| Case | Handling |
|---|---|
| MQTT disconnect | mqtt.js auto-reconnect; `/health` reports `disconnected`; subscriptions restored on reconnect; new commands fail fast with `503 BROKER_DISCONNECTED` (§6.6) |
| Invalid JSON / schema error | Drop, log warn with topic + Zod issues (payload truncated to 256 chars) |
| Duplicate message | `on conflict do nothing` on the dedup key |
| Supabase error | Log error; retry up to 3 times with backoff 0.5/1/2 s, then drop (CSV still has the data) |
| AI timeout / invalid output | Retry once, then `AI_FAILED` event |
| Command timeout | `timeout` status + `COMMAND_TIMEOUT` event |
| Shutdown (SIGINT/SIGTERM) | Flush CSV, close MQTT, exit within 5 s |

### Dashboard
See §12.5.

---

## 17. Security

### MVP (local development)
- Secrets only in environment variables; commit `.env.example` files, never `.env`.
- The Supabase service role key is used only by the backend.
- RLS enabled; anon role limited to `select`.
- Backend binds to `127.0.0.1`; CORS limited to `CORS_ORIGIN`; command rate limit (§9.6).
- The Mosquitto anonymous listener is only for the local machine and never port-forwarded.
- On a public broker (D1 fallback), assume all traffic is public: no secrets in payloads.

### Later (production-like)
- MQTT username/password and TLS (8883), per-device credentials and ACLs.
- Dashboard authentication (Supabase Auth) and per-user RLS.
- Command authorization and audit.

---

## 18. Repository Structure

```text
smart-room/
├── specs/
│   └── aiot-smart-room-spec.md
├── README.md                 # setup + run instructions for every part
├── .gitignore                # .env, data/*.csv, node_modules, .pio, .next, broker/mosquitto-data
├── package.json              # pnpm workspace root (D12)
├── pnpm-workspace.yaml       # server, dashboard, packages/*
├── device/
│   ├── platformio.ini        # [env:esp32-s3] + [env:native] (tests)
│   ├── wokwi.toml
│   ├── diagram.json
│   ├── include/
│   │   └── config.h          # pins, thresholds, intervals, broker, prefix
│   ├── lib/
│   │   └── edge_rules/       # pure C++, no Arduino (§7.1): smoothing, state machine, override
│   ├── test/
│   │   └── test_edge_rules/  # Unity tests, run with `pio test -e native`
│   └── src/
│       ├── main.cpp
│       ├── sensors.cpp / .h
│       ├── actuators.cpp / .h
│       ├── display.cpp / .h
│       ├── net_task.cpp / .h     # FreeRTOS task: Wi-Fi + NTP + MQTT (D11)
│       ├── commands.cpp / .h     # parse, validate, dedup, ack
│       └── edge_ai.cpp / .h      # Phase 7
├── broker/
│   └── mosquitto.conf
├── packages/
│   └── contracts/            # §9.7, shared Zod schemas
├── server/                   # §9.7
├── dashboard/
│   ├── .env.example
│   ├── package.json
│   └── src/
├── supabase/
│   ├── migrations/0001_init.sql
│   ├── migrations/0002_retention.sql
│   └── seed.sql
├── ml/
│   ├── requirements.txt
│   ├── preprocess.py
│   ├── train.py
│   └── export_model.py
├── data/                     # CSV output (git-ignored, keep .gitkeep)
└── docs/
    └── architecture.md
```

---

## 19. Development Phases

### Phase 0 — Connectivity Spike (½ day)
Goal: remove the biggest risk (D1) before writing real code.
Deliverables: a minimal ESP32-S3 PlatformIO sketch in Wokwi for VS Code that joins `Wokwi-GUEST` and publishes one message to the local Mosquitto through the Private IoT Gateway (`host.wokwi.internal:1883`); notes in `README.md` on the license and the gateway setup that worked.
Also in Phase 0 (toolchain check):
- Pin `platform = espressif32@x.y.z` (core 2.x, D13) and every `lib_deps` version. The sketch includes all five libraries so a version conflict shows up now.
- `pio test -e native` runs one trivial Unity test. On Windows this needs a host `gcc`/`g++` in `PATH` (e.g. MSYS2 `mingw-w64-ucrt-x86_64-gcc`); document it in `README.md`.
- Node 24 LTS + pnpm installed; Supabase project created; record which key format it issues (§10.4).

Success criteria:
- `mosquitto_sub -t 'aiot/#' -v` on the host receives the message.
- A `mosquitto_pub` to the device topic is received by the sketch.
- If either fails and cannot be fixed in the time box → switch to the D1 fallback (public broker) and record it in §0.

### Phase 1 — Wokwi Hardware Simulation
Deliverables: ESP32-S3 PlatformIO project, `diagram.json` per §4.4, all sensors and actuators, LCD, serial logs, `config.h`.
Success criteria:
- Every sensor prints a plausible value on serial when its Wokwi control is changed.
- Every actuator can be driven from a serial test routine.
- The simulation runs for 10 minutes without reset.

### Phase 2 — Edge Rule Engine
Deliverables: smoothing, sensor fault handling, state machine with hysteresis (§7.4–7.5), actions (§7.6), button, LCD layout.
Success criteria:
- Demo steps 1–3 (§20) behave as expected **with Wi-Fi disabled**.
- Holding airQuality around 900 ±20 does not make the state flap (hysteresis works).
- Unit-testable rule logic: `lib/edge_rules` compiles and is tested on native (`pio test -e native`), covering escalation, step-down with hold time, hysteresis, null inputs, and override set/expire/escalation.
- LED blink and buzzer pattern stay regular (no visible stall) while Wi-Fi/MQTT are reconnecting.

### Phase 3 — MQTT Communication
Deliverables: Wi-Fi, NTP, MQTT with LWT, telemetry/status/event publish, command subscribe + ack + dedup, `net_task` with queues and backoff reconnect (D11), Mosquitto config with persistence.
Success criteria:
- `mosquitto_sub -t 'aiot/#' -v` shows telemetry every 2 s and a retained status.
- A `mosquitto_pub` command executes and is acked within 1 s.
- Stopping the broker → edge logic continues, LCD shows `OFF`; restarting it → the device reconnects by itself within 30 s, and the retained status is still present (broker persistence).

### Phase 4 — Backend + Supabase
Deliverables: migration + seed, Fastify backend, ingestion pipeline, downsampling, dedup, presence tracking, command service + timeout, CSV logger, REST API, `.env.example`.
Success criteria:
- Telemetry rows appear in Supabase every ~5 s, and immediately on a state change.
- Killing the simulation → the device is marked offline within 60 s.
- `POST /commands` → the row goes `pending → sent → executed`; with the simulation stopped **and the device marked offline** (LWT, ~20–25 s), the API returns `409`. Before that, the command ends as `timeout`.
- With Mosquitto stopped, `POST /commands` returns `503`; after Mosquitto restarts, that command is **not** delivered to the device.
- The CSV file grows every 2 s; the export endpoint returns valid CSV.
- Restarting the backend while the device is offline does **not** mark it online (retained status is ignored for presence).
- Unit tests (Vitest) for Zod contracts, downsampling, dedup, presence transitions, and the `sent`/ack race.

### Phase 5 — Dashboard
Deliverables: main screen (§12.2), realtime subscriptions, charts, controls, UI states (§12.5), CSV export button.
Success criteria:
- Value cards start changing without refresh less than 3 s after a sensor change in Wokwi (live broadcast, D10). The smoothed value settles after `SMOOTH_WINDOW` samples, which is about 6 s for temperature/humidity. Charts follow at the persist interval (~5 s).
- Close Window from the dashboard moves the servo and the UI shows `executed`.
- Offline/stale states display correctly.

### Phase 6 — Cloud AI
Deliverables: aggregation, provider interface, mock provider, one LLM provider, triggers + cooldown, storage, AI card.
Success criteria:
- A DANGER transition produces an `ai_analysis` row within 20 s and it is shown on the dashboard, **even if a scheduled/manual analysis ran less than `AI_COOLDOWN_SEC` earlier**.
- With `AI_PROVIDER=mock` the full flow works without network access to the AI provider.
- An invalid or timed-out AI response produces an `AI_FAILED` event, and the backend keeps running.

### Phase 7 — TinyML
Deliverables: dataset preparation, training, int8 TFLite conversion, TFLM inference on ESP32, `mlState` in telemetry, comparison report.
Success criteria:
- The ESP32 produces a local classification, with inference under 50 ms.
- Works without cloud connectivity.
- The report shows accuracy, F1, confusion matrix and agreement vs the rule engine.

---

## 20. Demo Scenario

In Wokwi: set temperature/humidity on the DHT22 part, air quality with the potentiometer.

### Step 1 — Normal
Input: temperature 26.5, humidity 65, airQuality 300.
Expected: `NORMAL`, green LED on, buzzer off, window 0°, dashboard shows NORMAL.

### Step 2 — Warning
Input: temperature 31.5, airQuality 720.
Expected: `WARNING`, yellow LED blinking, `STATE_CHANGED` (warning) event in the dashboard event list, values updated within 3 s.

### Step 3 — Danger
Input: temperature 34.5, airQuality 950.
Expected: `DANGER`, red LED on, buzzer pattern, servo 90°, `STATE_CHANGED` (critical) event, AI analysis (trigger `danger_event`) shown on the dashboard.

### Step 4 — Remote Control (manual override)
User clicks **Close Window** (the state is still DANGER).
Expected:
```text
Dashboard → Backend (command pending → sent)
→ MQTT → ESP32: servo 0°, window override ON (120 s), LCD shows "OV"
→ ack executed + retained status → Backend → Supabase → Dashboard
Dashboard: command "executed", Window 0°, Override: window (120 s)
Red LED + buzzer continue (only the window is overridden)
```

### Step 5 — Mute and Override End
- Short-press the button → buzzer muted (buzzer override), `BUTTON_PRESSED` + `OVERRIDE_SET` events.
- Click **Clear Override** (or wait 120 s) → the window reopens to 90° and the buzzer resumes, because the state is still DANGER.

### Step 6 — Recovery
Input: temperature 26.0, airQuality 300.
Expected: the state steps down DANGER → WARNING → UNCOMFORTABLE → NORMAL (at least 5 s per level). At NORMAL the window closes and the green LED is on.

### Step 7 — Offline Safety
Stop Mosquitto, then raise airQuality to 950.
Expected: the device still goes to DANGER, and buzzer, red LED and servo act. The LCD shows `OFF`. Within 60 s the dashboard shows the device Offline. After Mosquitto restarts, the device reconnects and the dashboard returns to Online.

---

## 21. MVP Acceptance Criteria

The MVP is complete when all of the following are demonstrated:

- [x] Wokwi ESP32-S3 reads DHT22, LDR, PIR, potentiometer and button.
- [x] Device controls LEDs, buzzer, servo and LCD according to §7.6.
- [x] Edge rules with hysteresis work while offline (demo Step 7).
- [x] ESP32 connects to MQTT and reconnects automatically.
- [x] Backend validates, deduplicates and stores telemetry in Supabase (downsampled).
- [x] CSV logging works, and the CSV export endpoint works.
- [x] Dashboard displays realtime data, updated less than 3 s after a sensor change.
- [x] User can remotely control the window and the buzzer; override behaves per §7.6.
- [x] Device acks commands, and the dashboard shows the final command status, including timeout.
- [x] Online/offline status is correct within 60 s.
- [x] At least one AI analysis flow works end-to-end (mock provider is acceptable, one real provider is preferred).
- [x] Only `sensors.cpp` and `config.h` contain simulator-specific values, so replacing Wokwi with a physical ESP32-S3 does not touch the other modules.

---

## 22. Future Improvements

- Real ESP32-S3 hardware; real CO2 / MQ sensor.
- Offline telemetry buffering and replay.
- Remote threshold configuration (retained config topic).
- More rooms/devices; device provisioning; OTA firmware.
- Authentication, per-device MQTT credentials, TLS.
- Notification system (email / push on DANGER).
- Mobile app.
- TimescaleDB / time-series optimization, data retention jobs.
- Anomaly detection, predictive ventilation, energy optimization.
- Multi-agent AI system; RAG-based environmental assistant.
- Advanced TinyML model; edge/cloud model comparison.

---

## 23. Technology Stack

```text
Device Simulation : Wokwi for VS Code (+ Private IoT Gateway)
MCU               : ESP32-S3 (esp32-s3-devkitc-1)
Firmware          : C++ / Arduino framework (core 2.x, D13) / PlatformIO
Device libs       : PubSubClient, ArduinoJson 7, DHTesp, ESP32Servo, LiquidCrystal_I2C

Messaging         : MQTT 3.1.1
Broker            : Mosquitto 2.x (local); public broker as fallback

Backend           : Node.js 24 LTS + TypeScript, Fastify
Validation        : Zod
MQTT Client       : mqtt.js v5
Logging           : pino
CSV               : csv-stringify

Database          : Supabase PostgreSQL (RLS on)
Realtime          : Supabase Realtime

Dashboard         : Next.js (App Router) + TypeScript
Charts            : Recharts

Cloud AI          : AiProvider interface — mock + Gemini (@google/genai)
Edge AI           : TensorFlow Lite Micro (Phase 7)

Data Export       : CSV
ML Training       : Python 3.11 + TensorFlow
```

---

## 24. Design Principles

1. **Edge-first safety.** Critical actions must not depend on cloud connectivity. Manual override is time-limited and cancelled on escalation.
2. **MQTT for device communication.** Do not use Supabase as a replacement for the MQTT message bus.
3. **Backend as orchestration layer.** Devices never hold Supabase credentials. The dashboard never writes to the DB directly.
4. **Contracts are the source of truth.** §5 defines every payload. The Zod schemas in `packages/contracts` mirror it and are shared by backend and dashboard, and firmware must match.
5. **Cloud AI for contextual reasoning.** Aggregate before sending; AI only recommends, never acts.
6. **Supabase for persistence and realtime application data.**
7. **Simulator-to-hardware compatibility.** Wokwi-specific logic is isolated in `sensors.cpp` + `config.h`.
8. **Incremental development.** IoT first, then cloud AI, then TinyML.
9. **Observable system.** Every state transition, override, command and AI call is logged (events / commands / ai_analysis tables and backend logs).

---

## 25. Implementation Order

```text
 0. Connectivity spike: Wokwi → gateway → local Mosquitto (Phase 0)
 1. Wokwi ESP32-S3 project + diagram.json (pin map §4.4)
 2. Sensor + actuator abstraction, config.h
 3. lib/edge_rules (native tests first) → wire to hardware: override + button + LCD
 4. net_task: Wi-Fi + NTP + MQTT (LWT, telemetry, status, event) via queues
 5. Command handling + ack + dedup on device
 6. Mosquitto config (persistence), verify with mosquitto_sub / mosquitto_pub
 7. Supabase migration (incl. RPC + trigger) + seed
 8. pnpm workspace + packages/contracts
 9. Backend: ingestion → presence → persistence → live broadcast
10. Backend: CSV logger
11. Backend: command service + REST API
12. Dashboard: read + broadcast + realtime → controls
13. Cloud AI: aggregation → mock provider → LLM provider → dashboard card
14. TinyML: dataset → train → deploy → compare
```

Each step is independently testable before moving on.
