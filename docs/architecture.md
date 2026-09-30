# Kiến trúc & luồng tín hiệu

## Thành phần

| Thành phần | Vai trò | Nguồn sự thật cho |
|---|---|---|
| Device (`device/`) | Đọc cảm biến, **tự quyết định** trạng thái (edge rules) và điều khiển LED/buzzer/servo, kể cả khi mất mạng | edge state, actuator |
| Broker (Mosquitto) | Trung chuyển MQTT; giữ `status` retained + LWT | — |
| Backend (`server/`) | Client MQTT duy nhất được gửi lệnh; validate mọi message bằng `@srdt/contracts`; presence; vòng đời command; phát live cho dashboard | presence, trạng thái command |
| Storage (`server/src/storage/`) | Lưu device / telemetry (đã downsample) / event / command. Hiện: RAM | lịch sử |
| Dashboard (`dashboard/`) | Chỉ hiển thị (mirror) và gửi lệnh qua backend | — |

"Digital twin" ở đây = `DeviceRecord.reported` (status mới nhất thiết bị báo lên) + telemetry mới nhất.
Dashboard không bao giờ tự giả định actuator đã đổi: nó chờ status/ack thật từ thiết bị.

## Topic MQTT (prefix `srdt`, §6.2)

| Topic | Hướng | QoS / retain | Payload (`packages/contracts`) |
|---|---|---|---|
| `srdt/{id}/telemetry` | device → backend | 0 | `Telemetry`, mỗi 2 s + ngay khi đổi state |
| `srdt/{id}/status` | device → backend | 1, retained | `StatusOnline` khi đổi + mỗi 30 s; LWT `{online:false}` |
| `srdt/{id}/event` | device → backend | 0 | `DeviceEvent` (BOOT, STATE_CHANGED, OVERRIDE_SET…) |
| `srdt/{id}/command` | backend → device | 1 | `CommandMessage` |
| `srdt/{id}/command/ack` | device → backend | 0 | `CommandAck` |

Đổi prefix: `MQTT_TOPIC_PREFIX` ở **cả** `device/include/config.h` và `server/.env`.

## Uplink: thiết bị → dashboard

```
MQTT message
  → server/src/mqtt/handlers.ts   topic → size ≤ 1 KB → JSON → Zod → deviceId khớp topic → dedup (bootId, seq)
  → DeviceService.touch            presence online (retained/LWT không tính), DEVICE_ONLINE event
  → theo loại:
      telemetry → TelemetryService   hub.publish (mọi message) + storage.telemetry.append (downsample 5 s / đổi state)
      status    → DeviceService      reported state + override.expiresAt → hub + storage.devices.put
      event     → EventService       hub + storage.events.append
      ack       → CommandService     transition pending|sent → executed|rejected|failed → hub
  → RealtimeHub (SSE) → dashboard useTwin() reducer → component
```

Offline: LWT (~20–25 s sau khi device chết) hoặc 45 s không có dữ liệu (sweep 10 s) → `DEVICE_OFFLINE`.

## Downlink: dashboard → thiết bị (§6.6)

```
Controls → POST /api/devices/room-01/commands
  → CommandService.create     rate limit 10/phút → record pending (stream) →
                              503 nếu backend mất broker, 409 nếu device không online
  → MQTT publish QoS 1 → PUBACK → transition pending → sent (stream) → HTTP 202
  → device: validate → execute (override 120 s) → status (retained) → ack
  → ack → transition → executed/rejected (stream) → dashboard toast
  → không có ack sau 10 s → timeout + COMMAND_TIMEOUT event
```

Mọi đổi trạng thái command là **compare-and-set** (`CommandStore.transition`), nên ack đến trước PUBACK
vẫn giữ `executed`, và ack trễ không ghi đè `timeout`.

## Chỗ cắm cho phần cloud

```
server/src/storage/
  types.ts                 ← interface duy nhất services dùng (DeviceStore, TelemetryStore, EventStore, CommandStore)
  memory/                  ← driver đang dùng
  firestore/               ← stub, STORAGE_DRIVER=firestore
dashboard/src/lib/datasource/
  types.ts                 ← TwinSource: subscribe(code) → StreamMessage
  backend-sse.ts           ← đang dùng
  firestore.ts             ← placeholder, NEXT_PUBLIC_DATA_SOURCE=firestore
cloud/firebase/            ← firebase.json (Hosting → dashboard/out), firestore.rules, indexes (mock)
cloud/gcp/                 ← Dockerfile backend cho Cloud Run / VM (mock)
```

Chi tiết: [`cloud.md`](cloud.md).
