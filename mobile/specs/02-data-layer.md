# 02. Lớp dữ liệu

Nguồn dữ liệu duy nhất là backend (`server/src/api/routes.ts`):

| Endpoint | Mobile dùng để |
|---|---|
| `GET /api/devices/:code/stream` | Toàn bộ dữ liệu live (SSE): khung đầu là `snapshot`, sau đó `device`/`telemetry`/`event`/`command` |
| `POST /api/devices/:code/commands` | Gửi lệnh. `202 {commandId, status}` · `400` · `404` · `409 DEVICE_OFFLINE` · `429 RATE_LIMITED` · `503 BROKER_DISCONNECTED` |
| `GET /api/devices` | Danh sách thiết bị cho màn Settings |
| `GET /health` | Nút "Test connection" trong Settings: `{ mqtt, storage: {driver, ok}, streamClients }` |
| `POST /api/devices/:code/assistant` | (M5) voice, xem `05-voice-assistant.md` |

Không gọi `GET /api/devices/:code` riêng: SSE đã gửi snapshot ở mỗi lần (re)connect.

## 1. `TwinSource` cho React Native

`src/lib/datasource/rn-sse.ts` implement `TwinSource` (interface ở `@srdt/twin-core`, đã có trong
`dashboard/src/lib/datasource/types.ts`) bằng `react-native-sse`. Hành vi phải giống `backend-sse.ts` của dashboard:

| Tình huống | Hành vi |
|---|---|
| Mở stream | `onConnection("connecting")` lần đầu, `"reconnecting"` nếu đã từng live |
| Nhận `snapshot` | `onConnection("live")`, rồi `onMessage(snapshot)` |
| Nhận event khác | `JSON.parse(data)` → `onMessage({type, data})`. Parse lỗi thì bỏ message đó, log `console.warn`, **không** đóng stream |
| Lỗi mạng / server đóng | Đóng hẳn, `onConnection("reconnecting"/"connecting")`, mở lại sau backoff |
| HTTP 404 (sai mã thiết bị) | `onError("Device <code> not found on <url>")`, vẫn retry (thiết bị có thể được auto-register sau) |
| Không kết nối được (backend tắt, sai IP) | `onError("Cannot reach <url>. …")` với gợi ý theo §5 |
| `unsubscribe()` | Huỷ timer, `es.removeAllEventListeners()`, `es.close()` |

Khác dashboard: tự quản reconnect bằng backoff `1 s → 2 s → 4 s → 8 s → 10 s` (tối đa 10 s), reset khi nhận
snapshot. Tắt cơ chế tự reconnect của thư viện (`pollingInterval: 0`) để chỉ có một vòng retry. Lý do: trên điện
thoại mạng hay chập chờn (Wi-Fi ↔ 4G), cần kiểm soát được.

Stream im lặng: server không gửi heartbeat SSE. Nếu đang `live` mà **60 s** không có message nào (telemetry đến mỗi
2–5 s khi thiết bị online), coi là stream chết: đóng và mở lại. Thiết bị offline thì không có telemetry, nhưng
reconnect chỉ tốn một snapshot, chấp nhận được.

### Vòng đời theo app (`features/twin/twin-stream.tsx`)

Component không có UI, mount một lần trong `app/_layout.tsx`:

- Subscribe khi app `active` **và** đã có `apiBaseUrl` + `deviceCode` trong settings.
- `AppState` chuyển sang `background` → unsubscribe sau **30 s** (không giữ kết nối khi người dùng rời app lâu,
  tiết kiệm pin; quay lại nhanh trong 30 s thì giữ nguyên).
- Quay lại `active` → subscribe lại; snapshot mới thay toàn bộ state, không mất gì.
- Đổi `apiBaseUrl`/`deviceCode` trong Settings → unsubscribe, reset state về `loading`, subscribe lại.
- Kéo để làm mới (pull-to-refresh) ở Home/Activity → `reconnectAtom` (đóng và mở lại ngay, bỏ qua backoff).

## 2. State: Jotai atoms

Nguyên tắc (giống `.claude/rules/mobile-atomic-state.md` của request-app): mỗi atom một việc, component chỉ đọc atom
nó cần, logic tính toán nằm trong atom suy ra hoặc trong `twin-core`, không nằm trong component.

### 2.1 Atom gốc (`features/twin/_atoms/state.ts`)

| Atom | Kiểu | Ghi khi |
|---|---|---|
| `twinStatusAtom` | `"loading" \| "ready" \| "error"` | snapshot đầu → `ready`; lỗi khi chưa có device → `error` |
| `twinErrorAtom` | `string \| null` | `onError` |
| `connectionAtom` | `ConnectionState` | `onConnection` |
| `deviceAtom` | `DeviceRecord \| null` | snapshot, `device` |
| `telemetryAtom` | `TelemetryRecord[]` (cũ → mới, 15 phút) | snapshot, `telemetry` |
| `eventsAtom` | `EventRecord[]` (mới → cũ, 20) | snapshot, `event` |
| `commandsAtom` | `CommandRecord[]` (mới → cũ, 20) | snapshot, `command` |
| `lastTelemetryAtAtom` | `number \| null` | giờ **nhận** telemetry mới nhất |

Ghi state: `twin-stream.tsx` giữ một `TwinState` (kiểu của twin-core) trong ref, mỗi message gọi
`applyMessage(prev, msg, Date.now())`, rồi **chỉ ghi atom nào có reference đổi** (`next.events !== prev.events`…).
Nhờ vậy telemetry 2 s/lần không làm render lại danh sách event, và ngược lại. Dùng `store.set` của Jotai store mặc
định (không qua hook) để không render lại `twin-stream.tsx`.

### 2.2 Atom suy ra (`features/twin/_atoms/derived.ts`)

| Atom | Từ | Dùng ở |
|---|---|---|
| `latestTelemetryAtom` | `telemetryAtom` | metric cards, room twin |
| `onlineAtom` | `deviceAtom` | mọi nút điều khiển, dim UI |
| `edgeStateAtom` | latest ?? device | status card, hero, tab badge |
| `actuatorsAtom` | `{ windowAngle, buzzer }`: `reported.actuators` ?? latest | room twin, controls |
| `overrideAtom` | `device.reported.override` | status card, controls (đếm ngược) |
| `mlAtom` | `{ mlState, aiControl }` từ latest | status card |
| `deviceMetaAtom` | `{ name, code, fw, rssi, uptimeSec, sensorFault }` | header, settings |

`stale` và `lastSeenAt` phụ thuộc thời gian nên **không** là atom: component tính bằng `deriveRoomView` +
`useNow(1000)` ngay chỗ hiển thị (header), để chỉ header tick mỗi giây. Atom suy ra trả về cùng reference khi giá
trị không đổi (dùng `selectAtom` với hàm so sánh nông cho object) để tránh render thừa.

## 3. Gửi lệnh

### 3.1 API client (`lib/api/client.ts`)

- `fetch` với timeout **8 s** (`AbortController`).
- Lỗi mạng/timeout → `ApiError(0, "BACKEND_UNREACHABLE", "Cannot reach <url>")`.
- Không phải 2xx → đọc `{ error: { code, message } }` → `ApiError(status, code, message)`.
- `baseUrl` đọc từ `apiBaseUrlAtom` lúc gọi (không cache).

### 3.2 Mutation (`features/controls/_atoms/mutations.ts`)

`sendCommandAtom` (write-only), body `{ action, value?, source: "dashboard" }`.

> `source` dùng `"dashboard"` vì `CommandRequest` chỉ nhận `"dashboard" | "ai"`. Muốn phân biệt app với web thì phải
> thêm `"mobile"` vào `CommandSource` trong contracts **và** firmware (§5.2 của spec gốc). Không làm ở phạm vi này;
> xem câu hỏi mở Q3.

Luồng (port từ `useCommandSender` trong `dashboard/src/components/Controls.tsx`):

1. Thêm `action` vào `requestingAtom` (mảng action đang gửi HTTP). Rung `light`.
2. `POST`. Thành công → nhận `{commandId, status}`:
   - Nếu `commandsAtom` đã có record đó với status cuối (ack về trước khi HTTP trả) → toast kết quả ngay.
   - Nếu status là `pending`/`sent` → thêm `commandId` vào `awaitedCommandsAtom`.
3. Lỗi → toast lỗi theo `apiErrorText(code)` của twin-core, rung `error`:

   | Code | Text |
   |---|---|
   | `DEVICE_OFFLINE` | Device is offline |
   | `BROKER_DISCONNECTED` | Backend is not connected to the MQTT broker |
   | `RATE_LIMITED` | Too many commands, wait a moment |
   | `BACKEND_UNREACHABLE` | Can't reach the backend. Check Settings |
   | khác | `message` của server |
4. Luôn bỏ `action` khỏi `requestingAtom`.
5. Mutation **không throw** ra component; trả `commandId` hoặc `null`.

Theo dõi kết quả: một effect (`awaitedCommandsEffect`, dùng `jotai-effect` hoặc `store.sub` trong `twin-stream`)
nghe `commandsAtom`; record nào trong `awaitedCommandsAtom` chuyển sang status cuối thì toast
(`executed` → success + rung `success`; `rejected`/`failed`/`timeout` → error + rung `error`) và bỏ khỏi danh sách.
Text dùng `resultText()` của twin-core, ví dụ "Open window completed in 0.8 s".

### 3.3 Khoá nút (`features/controls/_atoms/ui.ts`)

`busyFamily(action)`: true khi có request đang gửi **hoặc** command đang mở (`pending`/`sent`) thuộc nhóm xung đột
(`window` / `buzzer` / `all`, luật `conflicts()` của twin-core). Ví dụ đang mở cửa sổ thì nút Close và "Resume
automatic" bị khoá, nút buzzer vẫn bấm được. Nút còn bị khoá khi `!online`.

## 4. Settings lưu máy (`features/settings/_atoms/settings.ts`)

`atomWithStorage` + adapter MMKV (đồng bộ, không nhấp nháy giá trị mặc định khi mở app).

| Atom | Mặc định | Kiểm tra |
|---|---|---|
| `apiBaseUrlAtom` | `extra.apiBaseUrl` (`http://10.0.2.2:4000`) | `http(s)://host[:port]`, bỏ `/` cuối |
| `deviceCodeAtom` | `extra.deviceCode` (`room-01`) | regex `DeviceId` của contracts `^[a-z0-9-]{3,32}$` |
| `themePreferenceAtom` | `"system"` | `system` / `light` / `dark` |
| `voiceLocaleAtom` (M5) | `"vi-VN"` | `vi-VN` / `en-US` |
| `voiceSpeakRepliesAtom` (M5) | `true` | |

Sửa URL/mã thiết bị không lưu ngay khi gõ: có nút **Save**, lưu xong thì `twin-stream` kết nối lại (§1).

## 5. Thông báo lỗi kết nối

Khi chưa từng kết nối được (`twinStatusAtom = "error"`), màn chặn (connection gate, `04-screens.md` §2) hiện gợi ý
theo URL đang dùng:

| URL chứa | Gợi ý |
|---|---|
| `127.0.0.1` / `localhost` | "On a phone, 127.0.0.1 is the phone itself. Use 10.0.2.2 on the emulator, or your computer's LAN IP." (trừ khi đang dùng `adb reverse`) |
| `10.0.2.2` | "10.0.2.2 only works on the Android emulator." |
| IP LAN | "Is the server running with HOST=0.0.0.0, and is the phone on the same Wi-Fi?" |

## 6. Toast

`toastAtom` (hàng đợi tối đa 3), `pushToast(tone, text)`; success/info tự tắt sau 4 s, error 7 s (giống dashboard).
`toast-host.tsx` hiện ở trên tab bar, trượt lên bằng Reanimated, vuốt ngang để tắt.

## 7. Hiệu năng

- Telemetry đến mỗi 2 s: chỉ `latestTelemetryAtom`/`telemetryAtom` đổi; chart vẽ lại tối đa mỗi **5 s**
  (`useNow(5000)` giống dashboard), trừ khi đang chạm để xem giá trị.
- `telemetryAtom` tối đa 1000 điểm (`HISTORY_MAX`); chart lấy mẫu xuống tối đa ~300 điểm theo bề rộng trước khi
  tạo path.
- Danh sách event/command tối đa 20 mục: `ScrollView` là đủ, không cần FlashList.
