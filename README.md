# Smart Room Digital Twin

Base cho dự án digital twin của smart room: **thiết bị (ESP32/Wokwi) ⇄ MQTT ⇄ backend ⇄ dashboard**.
Luồng gửi/nhận tín hiệu và điều khiển từ dashboard đã chạy end-to-end. Phần **database/cloud
(Google Cloud, Firestore, Firebase Hosting) chưa làm**: hiện backend lưu tạm trong RAM, và đã chừa sẵn
chỗ + mock cho team cloud (xem [`docs/cloud.md`](docs/cloud.md)).

Dựng từ project `../smart-room` (firmware, contracts, luồng MQTT/command giữ nguyên, đã test ở đó);
bỏ Supabase, AI, CSV. Số `§` trong code trỏ tới spec gốc: [`docs/reference/aiot-smart-room-spec.md`](docs/reference/aiot-smart-room-spec.md).

```
 ESP32 (Wokwi)              Mosquitto            backend (Node/Fastify)             dashboard (Next.js)
 hoặc fake-device            :1883                :4000                              :3100
 ───────────────  telemetry/status/event/ack  ──────────────────────  REST snapshot + SSE live  ──────────
                 ─────────────▶ broker ─────────▶  twin state         ─────────────────────────▶
                 ◀──────────── command (QoS 1) ◀─  command service    ◀──── POST /commands ──────
                                                   storage: memory  (sau này: Firestore / GCP)
```

Chi tiết luồng: [`docs/architecture.md`](docs/architecture.md).

## Cấu trúc

| Thư mục | Nội dung | Trạng thái |
|---|---|---|
| `device/` | Firmware ESP32-S3 (PlatformIO + Wokwi): cảm biến, edge rules, MQTT, command. `lib/link`: link gateway ⇄ node; `env:node` = firmware mạch node (không Wi-Fi, uplink qua UART1); `env:gateway` = mạch gateway (Wi-Fi + MQTT, bridge sang node qua UART1) | ✅ copy từ smart-room, prefix MQTT đổi sang `srdt`; 🟡 `lib/link` theo protocol v0.2 (đã chốt), `env:node` và `env:gateway` đã chạy trong Wokwi (mỗi mạch với link-sim ở đầu kia, và 2 mạch với nhau qua `splice`); chưa chạy trên mạch thật |
| `broker/` | Config Mosquitto local | ✅ |
| `packages/contracts/` | `@srdt/contracts`: Zod schema MQTT (§5) + record/stream types backend ⇄ dashboard (`twin.ts`) | ✅ 27 test |
| `server/` | Backend: MQTT ingest, presence, command round trip (ack/timeout), REST + SSE, `scripts/fake-device.ts` | ✅ 8 test |
| `server/src/storage/` | Interface storage + driver `memory` (chạy được) + `firestore` (stub) | 🟡 Firestore chờ team cloud |
| `tools/link-sim/` | Fake gateway / fake node cho phương án 2 mạch: link frame qua serial / TCP / MQTT tunnel, bridge sang broker; `splice` nối 2 mạch thật ([docs](docs/link-protocol.md#62-usb-serial-tới-pc-mỗi-người-dev-một-mình)) | 🟡 nháp, 23 test |
| `dashboard/` | Next.js 16 static export: value cards, **room twin (SVG)**, chart 15 phút, controls, events | ✅ nguồn `backend`; 🟡 nguồn `firestore` là placeholder |
| `cloud/` | Mock config Firebase Hosting / Firestore rules + indexes, Dockerfile cho Cloud Run | 🟡 mock, chưa deploy |
| `docs/` | Kiến trúc, hướng dẫn cloud, spec gốc, [link gateway ⇄ node](docs/link-protocol.md) (v0.2, đã chốt) | |

## Yêu cầu

Node 24 + pnpm 10, Mosquitto 2.x. Firmware: VS Code + PlatformIO + Wokwi (giống `../smart-room/README.md`).

## Chạy local

```sh
pnpm install
cp server/.env.example server/.env              # mặc định STORAGE_DRIVER=memory
cp dashboard/.env.example dashboard/.env.local

cd broker && mosquitto -c mosquitto.conf -v     # terminal 1
pnpm dev:server                                 # terminal 2 → http://127.0.0.1:4000
pnpm dev:dashboard                              # terminal 3 → http://localhost:3100
```

Thiết bị, chọn một trong hai:

- **Không cần Wokwi:** `pnpm --filter @srdt/server fake-device` (terminal 4). Gõ `hot` / `smoke` / `calm` + Enter
  để đẩy giá trị lên WARNING/DANGER hoặc về NORMAL.
- **Wokwi:** `cd device && pio run -e esp32-s3`, rồi trong VS Code mở `device/` → `F1 → Wokwi: Start Simulator`.
- **Mạch node (2 mạch):** `cd device && pio run -e node -t upload`, nối adapter USB-UART vào GPIO4 (RX) / GPIO5 (TX) + GND,
  rồi `pnpm --filter @srdt/link-sim fake-gateway --link serial:COMx` ([docs/link-protocol.md](docs/link-protocol.md) §6.2).
- **Mạch node trong Wokwi:** `cd device && pio run -e node-wokwi`, `F1 → Wokwi: Select Config File` → `device/wokwi/node/wokwi.toml`
  → `Wokwi: Start Simulator`, rồi `pnpm --filter @srdt/link-sim fake-gateway --link rfc2217:127.0.0.1:4002`
  (serial monitor dành cho link; bản `*-wokwi` chép console sang link, fake-gateway in thành `node| …`).
- **Mạch gateway (2 mạch):** `pio run -e gateway -t upload`, cùng chân GPIO4/5, rồi
  `pnpm --filter @srdt/link-sim fake-node --link serial:COMx`. Trong Wokwi: `pio run -e gateway-wokwi`, config
  `device/wokwi/gateway/wokwi.toml` và `fake-node --link rfc2217:127.0.0.1:4001` (console gateway hiện thành `gw| …`).
- **Cả 2 mạch trong Wokwi, nối với nhau:** build `node-wokwi` + `gateway-wokwi`, chạy node trong một VS Code window và
  gateway trong window thứ hai (`code -n device/wokwi/gateway`), rồi `pnpm --filter @srdt/link-sim splice` (4002 ⇄ 4001, in cả
  `node| …` và `gw| …`; stdin `cut 20` để rút dây).

Kiểm tra nhanh bằng curl:

```sh
curl -s 127.0.0.1:4000/health
curl -s 127.0.0.1:4000/api/devices/room-01                     # snapshot
curl -sN 127.0.0.1:4000/api/devices/room-01/stream             # SSE live
curl -s -X POST 127.0.0.1:4000/api/devices/room-01/commands -H 'content-type: application/json' \
  -d '{"action":"OPEN_WINDOW","value":45,"source":"dashboard"}'  # 202 { commandId, status: "sent" }
mosquitto_sub -h 127.0.0.1 -t 'srdt/#' -v                      # xem toàn bộ MQTT
```

Test: `pnpm test` (contracts + server + link-sim), `pnpm typecheck`, `cd device && pio test -e native` (firmware).

## API backend

| Method | Path | |
|---|---|---|
| GET | `/health` | trạng thái MQTT, storage driver, số client SSE |
| GET | `/api/devices` | danh sách `DeviceRecord` |
| GET | `/api/devices/:code` | `TwinSnapshot` (device + telemetry 15 phút + 20 event + 20 command) |
| GET | `/api/devices/:code/stream` | SSE: `snapshot` trước, sau đó `device` / `telemetry` / `event` / `command` |
| POST | `/api/devices/:code/commands` | `{ action, value?, source? }` → `202` / `409 DEVICE_OFFLINE` / `429` / `503 BROKER_DISCONNECTED` |
| GET | `/api/devices/:code/commands?limit=` | lịch sử command |

Action: `OPEN_WINDOW` (value 1–90), `CLOSE_WINDOW`, `BUZZER_ON`, `BUZZER_OFF`, `CLEAR_OVERRIDE`, `PING`.
Lệnh từ dashboard là **manual override 120 s**; hết hạn (hoặc `CLEAR_OVERRIDE`) thì edge rules điều khiển lại.

## Đã kiểm tra (2026-09-30)

- [x] `pnpm test`: 35/35 (27 contracts + 8 server), `pnpm typecheck` sạch, `next build` (static export) OK
- [x] Mosquitto + backend + fake device: device online, telemetry qua SSE mỗi 2 s, `OPEN_WINDOW 45` → `sent` → `executed` (~3 ms)
- [x] Dashboard (Chrome headless, desktop + mobile 390 px, light/dark): twin hiện góc cửa 45°, buzzer on, nhãn "manual", đếm ngược override
- [x] `env:gateway-wokwi` trong Wokwi + `fake-node` (rfc2217): HELLO, Wi-Fi, MQTT, NTP → TIME; `die 20` → node lost → offline status → node up; tắt Mosquitto → mqtt down, backoff 1–16 s, reconnect đúng 1 lần `mqtt up`; command từ dashboard → `forwarded` → node `executed`
- [x] 2 mạch thật trong Wokwi (`node-wokwi` :4002 ⇄ `splice` ⇄ `gateway-wokwi` :4001): dashboard online, telemetry từ cảm biến ảo của node, mở/đóng cửa từ dashboard → servo quay; `cut 20` → cả 2 mạch báo mất link sau 15 s, dashboard offline, nối lại → online; đổi cảm biến ảo của node → WARNING/DANGER lên dashboard
- [ ] Chưa chạy lại với Wokwi trong repo này (firmware giống hệt smart-room, chỉ đổi prefix `srdt` và dòng LCD khởi động)
- [ ] Firestore / Firebase Hosting / Cloud Run: chưa làm, xem `docs/cloud.md`

## Việc tiếp theo gợi ý

1. Team cloud: implement `server/src/storage/firestore/` + (tuỳ chọn) `dashboard/src/lib/datasource/firestore.ts`.
2. Auth cho dashboard/API (Firebase Auth) trước khi public backend.
3. Broker có TLS + user/password khi rời máy local (HiveMQ Cloud / EMQX / Mosquitto trên VM).
4. Twin 3D (three.js) thay `RoomTwin.tsx`, dữ liệu vào giữ nguyên `TwinView`.
5. LED RGB trạng thái cho `env:gateway` ([docs/link-protocol.md](docs/link-protocol.md) §5.5), rồi M3: cắm UART giữa 2 mạch thật.
