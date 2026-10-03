# Phần cloud (Google Cloud / Firebase): hướng dẫn cho team

> Trạng thái: §3 (Firestore driver) **xong** — đã chạy thật, cách chạy + checklist ở §3.
> §4–6 **chưa làm**, vẫn là đề xuất + mock. Mặc định vẫn là storage trong RAM;
> bật cloud bằng `STORAGE_DRIVER=firestore`.

## 1. Tách bạch trách nhiệm

- **Chỉ backend ghi DB** (Admin SDK). Dashboard chỉ đọc.
- **Chỉ backend gửi lệnh tới thiết bị** (qua MQTT). Dashboard luôn `POST /api/devices/:code/commands`,
  kể cả khi đọc dữ liệu từ Firestore. Không cho browser ghi collection `commands` để "trigger" lệnh.
- Services backend không import SDK cloud nào: chỉ dùng interface trong `server/src/storage/types.ts`.

## 2. Mô hình dữ liệu Firestore

Các shape đã có sẵn trong `packages/contracts/src/twin.ts` (camelCase, timestamp ISO string, id string).

| Collection | Document id | Type | Ghi chú |
|---|---|---|---|
| `devices/{code}` | device code (`room-01`) | `DeviceRecord` | `reported` = status mới nhất; `lastSeenAt` chỉ ghi ≤ 1 lần / 15 s |
| `devices/{code}/telemetry/{id}` | `{bootId}-{seq}` | `TelemetryRecord` | id cố định ⇒ ghi trùng là idempotent; đã downsample ~1 doc / 5 s |
| `devices/{code}/events/{id}` | `{bootId}-{seq}` hoặc uuid | `EventRecord` | |
| `commands/{id}` | uuid | `CommandRecord` | có field `deviceCode`; `transition()` = transaction |

### Hạn mức & chi phí

Firestore free tier (gói Spark): **20 000 writes / 50 000 reads / ngày**. Chỉ cần Firestore nên
không phải lên Blaze.

Số đo thật, 1 device, đo bằng listener Firestore trong 3–4 phút (không instrument backend):

| Nguồn write | Trước khi sửa | Sau khi sửa |
|---|---|---|
| `telemetry.append` (`TELEMETRY_PERSIST_INTERVAL_SEC=15`) | 5 280 /ngày | 5 400 /ngày |
| `devices.put` | **8 640 /ngày** | **1 080 /ngày** |
| events + commands (lúc idle) | 0 | 0 |
| **Tổng** | **13 920 /ngày/device** | **6 480 /ngày/device** |

Trước khi sửa, `devices.put` tốn nhiều hơn cả telemetry — 1 device đã ăn 70 % hạn mức.
Nguyên nhân và cách sửa: §3.5 bẫy #4. Sau khi sửa, 3 device vẫn nằm dưới trần.

Còn `TELEMETRY_PERSIST_INTERVAL_SEC` thì giữ 5 cho chế độ `memory`, đổi sang **15** cho chế độ cloud
(5 giây ⇒ ~17 280 writes/ngày, gần chạm trần chỉ với 1 device).

Downsample chỉ ảnh hưởng **bản lưu**, không ảnh hưởng UI: SSE vẫn đẩy telemetry mỗi 2 s nên value
card và room twin không chậm đi, chỉ chart lịch sử thưa hơn.

Không dùng TTL policy: TTL của Firestore yêu cầu field kiểu `Timestamp`, mà ta cố ý lưu timestamp
dạng ISO string (xem §3.4). Với quy mô đồ án thì không cần.

Index cần: xem `cloud/firebase/firestore.indexes.json` (commands theo `deviceCode + createdAt`, và
`status + createdAt` cho sweep timeout).

## 3. Firestore driver

### 3.0 Cách chạy

```bash
# một lần: service account cần role Cloud Datastore User (§3.5 bẫy #5)
cd cloud/firebase && firebase deploy --only firestore:rules,firestore:indexes

# server/.env
STORAGE_DRIVER=firestore
GCP_PROJECT_ID=<project-id>
GOOGLE_APPLICATION_CREDENTIALS=../cloud/firebase/service-account.json
TELEMETRY_PERSIST_INTERVAL_SEC=15

pnpm dev:server                                 # Node >= 24
pnpm --filter @srdt/server fake-device          # hoặc chạy firmware thật
curl -s 127.0.0.1:4000/health                   # -> "storage":{"driver":"firestore","ok":true}
```

Test: `pnpm test` (driver `memory`, luôn chạy) và
`pnpm --filter @srdt/server test:firestore` (thêm driver `firestore` qua emulator, cần JDK >= 21).

### 3.1 Phạm vi đã chốt

| | |
|---|---|
| **Làm** | Implement `server/src/storage/firestore/` + rules + indexes + test với emulator |
| **Backend chạy ở** | Local (máy dev), ghi/đọc Firestore thật trên cloud |
| **Dashboard** | Không đổi một dòng — vẫn đọc qua backend REST + SSE (`NEXT_PUBLIC_DATA_SOURCE=backend`) |
| **Không làm lần này** | Cloud Run / Firebase Hosting / broker MQTT cloud / Firebase Auth / sửa firmware |
| **Gói Firebase** | Spark (free) là đủ — chỉ cần Firestore, không cần Cloud Run nên không cần Blaze |

Lý do chọn phạm vi này: `server/src/storage/types.ts` đã là seam sạch, nên Firestore là một
**drop-in driver** — không đụng tới MQTT, command, API hay dashboard. Rủi ro thấp nhất, và đã
đủ để hệ thống có "cloud database" thật.

### 3.2 Định nghĩa Done

- [x] `STORAGE_DRIVER=firestore pnpm dev:server` + `fake-device` → data hiện trong Firestore Console
- [x] Lệnh từ API/dashboard → `commands/{uuid}` đi `pending → sent → executed`
- [x] **Kill backend rồi chạy lại** → `devices.load()` khôi phục device, chart 15 phút vẫn còn lịch sử
      (đây chính là thứ driver `memory` không làm được — giá trị demo của cả bước này)
- [x] Bộ test contract pass trên **cả hai** driver (`memory` + `firestore` qua emulator)
- [x] `firebase deploy --only firestore:rules,firestore:indexes` chạy được

### 3.3 Checklist thi hành

#### Bước 0 — Firebase project (thao tác trên Console, ~15 phút)

- [x] console.firebase.google.com → **Add project** → tắt Google Analytics
- [x] **Build → Firestore Database → Create database** → mode **Production** → region `asia-southeast1`
- [x] **Project settings → Service accounts → Generate new private key**
      → lưu `cloud/firebase/service-account.json`
- [x] `cp cloud/firebase/.firebaserc.example cloud/firebase/.firebaserc` → điền project id
- [x] Thêm `cloud/firebase/service-account.json` vào `.gitignore`
- [x] `npm i -g firebase-tools && firebase login` (cần cho deploy rules + emulator ở Bước 4)
- [x] **IAM:** cấp role `Cloud Datastore User` cho service account
      `firebase-adminsdk-…@<project>.iam.gserviceaccount.com`
      — Console → IAM & Admin → IAM → Grant access. Không có bước này thì key sinh ra
      token hợp lệ nhưng mọi query trả `7 PERMISSION_DENIED` (xem §3.5 bẫy #5)

#### Bước 1 — Deps + config

- [x] `pnpm --filter @srdt/server add firebase-admin`
      — **phải cài bằng Node ≥ 22** (repo yêu cầu 24): `@google-cloud/firestore` là
      optionalDependency, Node 20 không thoả `engines` nên pnpm bỏ qua và runtime báo
      `Cannot find module '@google-cloud/firestore'`
- [x] `server/src/config/env.ts`: thêm `FIRESTORE_DATABASE_ID` (optional, mặc định `(default)`)
- [x] `server/src/config/env.ts`: `.superRefine()` — `STORAGE_DRIVER=firestore` mà thiếu
      `GCP_PROJECT_ID` thì fail ngay lúc boot, không để throw giữa chừng khi đã nhận MQTT
- [x] `server/.env.example`: thêm `GOOGLE_APPLICATION_CREDENTIALS=../cloud/firebase/service-account.json`
      (đường dẫn tương đối tính từ `server/` — cwd của `pnpm dev:server`)
      và ghi chú `TELEMETRY_PERSIST_INTERVAL_SEC=15` cho chế độ cloud

#### Bước 2 — Implement driver

File: `server/src/storage/firestore/firestore.storage.ts` (thay toàn bộ stub).

- [x] Khởi tạo:
      ```ts
      initializeApp({ credential: applicationDefault(), projectId });
      const db = getFirestore(app, databaseId);
      db.settings({ ignoreUndefinedProperties: true });   // bắt buộc — xem §3.5 bẫy #3
      ```
- [x] `devices.list` — `collection("devices").get()`, sort theo `code` ở JS cho khớp memory
- [x] `devices.get` / `devices.put` — `doc(code).get()` / `.set(record)` (`set` = replace toàn bộ)
- [x] `telemetry.append` — `devices/{code}/telemetry/{bootId}-{seq}`.`set()`
- [x] `telemetry.recent` — `where("measuredAt",">=",iso).orderBy("measuredAt","desc").limit(n)`
      rồi **`.reverse()`**
- [x] `events.append` — `devices/{code}/events/{id}`.`set()`
- [x] `events.recent` — `orderBy("createdAt","desc").limit(n)`
- [x] `commands.insert` — `randomUUID()` làm doc id, `.set()`
- [x] `commands.transition` — `db.runTransaction`
- [x] `commands.get` — `doc(id).get()`
- [x] `commands.listOpenBefore` — `where("status","in",["pending","sent"]).where("createdAt","<",iso)`
- [x] `commands.recent` — `where("deviceCode","==",code).orderBy("createdAt","desc").limit(n)`
- [x] `ping` — `collection("devices").limit(1).get()` → `true`, catch → `false`
- [x] `close` — `app.delete()`
- [x] `driver` — đổi từ `"firestore (stub)"` sang `"firestore"`
- [x] `pnpm --filter @srdt/server typecheck` sạch

#### Mapping đầy đủ

| Method | Firestore | Ghi chú |
|---|---|---|
| `devices.list` | `collection("devices").get()` | sort ở JS |
| `devices.get/put` | `doc(code)` get / set | |
| `telemetry.append` | `devices/{code}/telemetry/{bootId}-{seq}` | id cố định ⇒ **idempotent**, MQTT gửi trùng không nhân đôi |
| `telemetry.recent` | range + `orderBy desc` + `limit` + reverse | khớp semantics `slice(-limit)` của memory: N mẫu *mới nhất* trong cửa sổ, trả oldest-first |
| `events.append` | `devices/{code}/events/{id}` | |
| `events.recent` | `orderBy("createdAt","desc")` | newest first |
| `commands.insert` | doc id = `randomUUID()` | §3.5 bẫy #1 |
| `commands.transition` | `runTransaction` | §3.5 bẫy #2 |
| `commands.listOpenBefore` | `in` + range trên `createdAt` | dùng composite index có sẵn |
| `commands.recent` | `deviceCode ==` + `orderBy createdAt desc` | dùng composite index có sẵn |

#### Bước 3 — Rules + indexes

- [x] `cloud/firebase/firestore.rules` → **deny-all** (`allow read, write: if false;`)
      — dashboard đọc qua SSE nên không client nào cần quyền; Admin SDK bypass rules
- [x] `cloud/firebase/firestore.indexes.json` — **đã kiểm tra: không cần sửa**
- [x] `cd cloud/firebase && firebase deploy --only firestore:rules,firestore:indexes`

#### Bước 4 — Test với emulator

- [x] Thêm block `emulators` (firestore port 8080) vào `cloud/firebase/firebase.json`
- [x] Tách `server/test/storage.contract.test.ts` — viết theo interface `Storage`, chạy qua cả hai driver
      - memory: luôn chạy
      - firestore: chỉ chạy khi có `FIRESTORE_EMULATOR_HOST`, ngược lại `describe.skip`
        ⇒ `pnpm test` ở máy không cài emulator vẫn xanh
- [x] Case: `telemetry.append` trùng id ⇒ không nhân đôi
- [x] Case: `telemetry.recent` đúng thứ tự + đúng cutoff `since`
- [x] Case: `transition` từ status sai ⇒ `null`
- [x] Case: hai `transition` đồng thời ⇒ chỉ một thắng
- [x] Case: `listOpenBefore` lọc đúng `pending|sent` + `createdAt <`
- [x] Script `test:firestore` chạy `firebase emulators:exec --only firestore 'vitest run'`
      — emulator cần **JDK ≥ 21** trên PATH
- [x] `pnpm test` xanh, `pnpm --filter @srdt/server test:firestore` xanh

#### Bước 5 — Chạy thật end-to-end

- [x] `.env`: `STORAGE_DRIVER=firestore`, `GCP_PROJECT_ID=…`, `TELEMETRY_PERSIST_INTERVAL_SEC=15`
- [x] `pnpm dev:server` + `pnpm --filter @srdt/server fake-device` → data lên Console
- [x] Bấm nút trên dashboard → xem `commands/{uuid}` đổi status trong Console
- [x] **Restart backend** → lịch sử chart còn nguyên
- [x] Đo writes thật bằng listener Firestore (§2) → bẫy #4 đúng, đã sửa

#### Bước 6 — Docs

- [x] §3 của file này: tick hết checklist, đổi "plan + checklist" thành hướng dẫn chạy
- [x] `README.md`: bảng cấu trúc `server/src/storage/` 🟡 → ✅
- [x] `README.md` mục "Việc tiếp theo": bỏ gạch đầu dòng Firestore
- [x] Trạng thái đầu file: §3 **xong**

---

### 3.4 Quyết định kỹ thuật

**Timestamp giữ nguyên ISO string**, không convert sang Firestore `Timestamp`.
ISO string so sánh từ điển = so sánh thời gian, nên `orderBy` và range query vẫn đúng, và record
đọc ra khớp `@srdt/contracts` nguyên vẹn, không cần converter hai chiều. Đánh đổi duy nhất là không
dùng được TTL policy — với quy mô đồ án thì không cần.

**Doc id có ý nghĩa, không dùng auto-id.** `{bootId}-{seq}` cho telemetry/event làm cho việc ghi trùng
(MQTT at-least-once) trở thành idempotent miễn phí. `randomUUID()` cho command là **bắt buộc**, xem §3.5 bẫy #1.

**Không có fallback khi Firestore lỗi.** Service đã bọc try/catch và log (xem `telemetry.service.ts`,
`event.service.ts`) — twin state trong RAM vẫn là nguồn sự thật cho presence, nên mất một write chỉ
mất một điểm lịch sử, không làm chết luồng realtime. Đúng như comment trong `storage/types.ts`.

### 3.5 Năm cái bẫy


**#1 — `commands.insert` BẮT BUỘC dùng `randomUUID()`, không được dùng auto-id của Firestore.**
`command.service.ts:handleAck` chặn bằng `UUID_RE.test(ack.commandId)`. Auto-id Firestore là 20 ký tự
alphanumeric ⇒ **mọi ack sẽ bị vứt, mọi lệnh sẽ timeout**. Lỗi im lặng, rất khó debug nếu không biết trước.

**#2 — `transition` phải giữ nguyên `id`/`deviceCode`/`createdAt` và trả về record đã merge.**
Memory làm `Object.assign(row, patch, { id, deviceCode, createdAt })`. Transaction phải:
`get` → nếu không tồn tại hoặc `status ∉ from` ⇒ `null` → ngược lại `tx.update(ref, patch)` →
trả về `{ ...current, ...patch }`. Đây là chỗ chống race "ack về trước PUBACK" ở `deliver()`
(link protocol §6.6) — sai là mất ack.

**#3 — `EventRecord.data` là `z.record(z.string(), z.unknown())`.**
Firestore từ chối `undefined` và **nested array**. `ignoreUndefinedProperties: true` xử lý vế đầu;
vế sau firmware hiện không sinh ra, và `event.service.ts` đã bọc try/catch nên cùng lắm mất 1 event
+ 1 dòng log, không chết backend. Chấp nhận được.

**#4 — `devices.put` tốn nhiều hơn telemetry. Đã đo, đã sửa.**
`device.service.ts` throttle `lastSeenAt` 15 s (`SEEN_WRITE_INTERVAL_MS`), nhưng `saveStatus()` gọi
`commit()` **mỗi status message**, mà `reported` chứa `uptimeSec`/`rssi`/`ts` nên lần nào cũng khác.
Kết quả đo: 1 write mỗi 10 s = **8 640 writes/ngày/device**, nhiều hơn cả telemetry đã downsample.

Cách sửa: tách "đẩy SSE" khỏi "ghi store" trong `commit()`, đúng kiểu `Downsampler` làm với telemetry.
Dashboard vẫn nhận mọi thay đổi tức thì; store chỉ ghi mỗi `DEVICE_PERSIST_INTERVAL_SEC` (mặc định 60),
trừ thay đổi **durable** thì ghi ngay: presence flip, offline, bootId mới (reboot), đổi firmware,
đổi edge state. 8 640 → **1 080 writes/ngày**. Test giữ hành vi này: `flow.test.ts`
"streams every device change but writes the document on a throttle".

**#5 — Service account mới sinh key không chắc đã có quyền Firestore.**
`Generate new private key` chỉ tạo key, không cấp role. Key vẫn lấy được access token bình thường,
nên lỗi chỉ lộ ra ở query đầu tiên: `7 PERMISSION_DENIED: Missing or insufficient permissions`,
kèm log `cannot load devices from storage`. Cấp `Cloud Datastore User` (hoặc
`Firebase Admin SDK Administrator Service Agent`) cho service account là xong — xem Bước 0.

### 3.6 File đã đụng tới

| File | Thay đổi |
|---|---|
| `server/package.json` | + `firebase-admin`, + script `test:firestore` |
| `server/src/config/env.ts` | + `FIRESTORE_DATABASE_ID`, + `DEVICE_PERSIST_INTERVAL_SEC`, + `superRefine` |
| `server/src/storage/firestore/firestore.storage.ts` | implement (thay stub) |
| `server/test/storage.contract.test.ts` | mới — bộ test dùng chung hai driver |
| `server/.env.example` | + credential, ghi chú interval |
| `cloud/firebase/firestore.rules` | deny-all |
| `cloud/firebase/firebase.json` | + block `emulators` |
| `cloud/firebase/.firebaserc` | mới, gitignored |
| `server/src/storage/memory/memory.storage.ts` | telemetry/event ghi trùng id ⇒ thay tại chỗ, cho khớp Firestore |
| `server/src/devices/device.service.ts` | throttle ghi device doc (§3.5 bẫy #4) |
| `server/test/flow.test.ts` | + test throttle ghi device doc |
| `server/src/storage/index.ts` | truyền `FIRESTORE_DATABASE_ID` xuống driver |
| `.gitignore` | + `cloud/firebase/service-account.json`, + `*-debug.log` |
| `docs/cloud.md` (file này), `README.md` | cập nhật trạng thái |

Không đụng: `dashboard/`, `device/`, `packages/contracts/`, `server/src/{mqtt,commands,devices,events,telemetry,api}/`.

### 3.7 Ước lượng

| Bước | Ước lượng | Thực tế |
|---|---|---|
| 0–1 Setup | ~30 phút | đúng, cộng thêm 2 cái bẫy: role IAM và Node >= 22 |
| 2 Driver | ~2–3 giờ | nhanh hơn — interface `Storage` map thẳng sang Firestore |
| 3–4 Rules + test | ~1.5 giờ | đúng |
| 5–6 Chạy thật + docs | ~1 giờ | lâu hơn — bẫy #4 phải sửa code chứ không chỉ đo |

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
