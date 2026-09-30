# Phần cloud (Google Cloud / Firebase): hướng dẫn cho team

> Trạng thái: **chưa làm**. Mọi thứ trong tài liệu này là đề xuất + mock, team cloud chỉnh lại cho đúng.
> Code hiện tại chạy hoàn toàn local với storage trong RAM.

## 1. Tách bạch trách nhiệm

- **Chỉ backend ghi DB** (Admin SDK). Dashboard chỉ đọc.
- **Chỉ backend gửi lệnh tới thiết bị** (qua MQTT). Dashboard luôn `POST /api/devices/:code/commands`,
  kể cả khi đọc dữ liệu từ Firestore. Không cho browser ghi collection `commands` để "trigger" lệnh.
- Services backend không import SDK cloud nào: chỉ dùng interface trong `server/src/storage/types.ts`.

## 2. Mô hình dữ liệu Firestore đề xuất

Các shape đã có sẵn trong `packages/contracts/src/twin.ts` (camelCase, timestamp ISO string, id string).

| Collection | Document id | Type | Ghi chú |
|---|---|---|---|
| `devices/{code}` | device code (`room-01`) | `DeviceRecord` | `reported` = status mới nhất; `lastSeenAt` chỉ ghi ≤ 1 lần / 15 s |
| `devices/{code}/telemetry/{id}` | `{bootId}-{seq}` | `TelemetryRecord` | id cố định ⇒ ghi trùng là idempotent; đã downsample ~1 doc / 5 s |
| `devices/{code}/events/{id}` | `{bootId}-{seq}` hoặc uuid | `EventRecord` | |
| `commands/{id}` | uuid | `CommandRecord` | có field `deviceCode`; `transition()` = transaction |

Chi phí ước lượng: 1 device chạy 24/7 ≈ 17 280 telemetry doc/ngày. Cân nhắc TTL policy
(ví dụ telemetry 30 ngày, events 90 ngày như spec gốc §10.5) hoặc gom theo phút.

Index cần: xem `cloud/firebase/firestore.indexes.json` (commands theo `deviceCode + createdAt`, và
`status + createdAt` cho sweep timeout).

## 3. Việc cần làm ở backend

1. `pnpm --filter @srdt/server add firebase-admin`
2. Implement `server/src/storage/firestore/firestore.storage.ts` (đã có comment gợi ý từng method).
   Giữ đúng contract trong `types.ts`, đặc biệt `CommandStore.transition` phải là transaction.
3. `server/.env`: `STORAGE_DRIVER=firestore`, `GCP_PROJECT_ID=…`, credential qua
   `GOOGLE_APPLICATION_CREDENTIALS` (local) hoặc service account của Cloud Run.
4. Viết test cho driver mới: có thể chạy lại `server/test/flow.test.ts` với Firestore emulator
   (`firebase emulators:start --only firestore`).

## 4. Deploy

| Phần | Đề xuất | Lưu ý |
|---|---|---|
| Dashboard | **Firebase Hosting** (`pnpm build:dashboard` → `dashboard/out`, `cloud/firebase/firebase.json`) | `NEXT_PUBLIC_API_BASE_URL` được nhúng lúc build ⇒ build lại khi đổi URL backend |
| Backend | **Cloud Run** (`cloud/gcp/Dockerfile.server`) hoặc Compute Engine VM | Backend giữ kết nối MQTT + presence trong RAM ⇒ Cloud Run cần `min-instances=1`, `max-instances=1`, CPU always allocated. SSE cần timeout request dài (Cloud Run tối đa 60 phút, EventSource tự reconnect) |
| Broker | Managed MQTT (HiveMQ Cloud, EMQX Cloud) hoặc Mosquitto trên VM | Bật TLS (8883) + user/password; firmware cần `WiFiClientSecure` + CA; đổi `MQTT_URL` ở backend |
| CORS | `CORS_ORIGIN=http://localhost:3100,https://<project>.web.app` | nhiều origin, cách nhau bằng dấu phẩy |

Thứ tự gợi ý: Firestore driver (chạy backend local + Firestore thật) → Hosting dashboard →
backend lên Cloud Run → broker cloud + TLS → Auth.

## 5. Dashboard đọc từ Firestore (tuỳ chọn)

Không bắt buộc: dashboard đọc qua backend (REST + SSE) vẫn chạy tốt khi backend lên cloud.
Nếu muốn đọc thẳng Firestore (ví dụ để có lịch sử dài hơn 15 phút mà không viết thêm API):

1. `pnpm --filter @srdt/dashboard add firebase`, config qua `NEXT_PUBLIC_FIREBASE_*`.
2. Implement `dashboard/src/lib/datasource/firestore.ts`: biến các `onSnapshot` thành `StreamMessage`
   (gợi ý chi tiết trong file). Component không phải sửa.
3. `NEXT_PUBLIC_DATA_SOURCE=firestore`.

Lưu ý: Firestore chỉ có telemetry đã downsample (~5 s). Nếu cần value card cập nhật 2 s, giữ SSE cho
telemetry và dùng Firestore cho phần còn lại.

## 6. Bảo mật (chưa có gì, cần trước khi public)

- API backend chưa có auth: thêm verify Firebase ID token (header `Authorization: Bearer`) cho
  `POST /commands` và `/stream` (EventSource không gửi header ⇒ dùng token qua query hoặc cookie).
- `firestore.rules` hiện là mock "chỉ đọc khi đã đăng nhập".
- Broker local đang `allow_anonymous true`, chỉ nghe `127.0.0.1`: không mở port này ra ngoài.
