# Mobile spec: mục lục và các quyết định đã chốt

Bộ spec cho app Android `@srdt/mobile`. Viết ngày 2026-10-10, dựa trên code thật của `dashboard/`, `server/` và
`packages/contracts/` ở commit `56233fe`. Khi code đổi mà spec chưa đổi thì **code là sự thật**, sửa spec cho khớp.

| File | Nội dung |
|---|---|
| [`01-architecture.md`](01-architecture.md) | Stack, vị trí trong monorepo, `packages/twin-core`, cấu trúc thư mục, cấu hình, build APK |
| [`02-data-layer.md`](02-data-layer.md) | SSE trên React Native, Jotai atoms, gửi lệnh, lỗi, Settings lưu máy |
| [`03-design-system.md`](03-design-system.md) | Token màu (sáng/tối) lấy từ dashboard, chữ, khoảng cách, icon, motion, haptics, a11y |
| [`04-screens.md`](04-screens.md) | Điều hướng, từng màn hình, mọi trạng thái (loading/offline/stale/empty/lỗi), copy |
| [`05-voice-assistant.md`](05-voice-assistant.md) | Điều khiển bằng giọng nói: STT → backend → LLM (function calling) → lệnh → TTS |
| [`06-roadmap.md`](06-roadmap.md) | Milestone M1–M5, tiêu chí xong (DoD), kế hoạch test, rủi ro, câu hỏi mở |

## Quyết định đã chốt

| # | Quyết định | Lý do ngắn |
|---|---|---|
| D1 | Thư mục `mobile/` ở root, package `@srdt/mobile`, thêm vào `pnpm-workspace.yaml` | Giống `server/`, `dashboard/` |
| D2 | Expo SDK 55, expo-router, **dev client** (không dùng Expo Go), React Native 0.83, React 19.2 | Cùng stack với request-app, copy được config; voice cần native module |
| D3 | Chỉ Android. Không cấu hình iOS (không chặn, nhưng không test) | Yêu cầu đề bài |
| D4 | NativeWind v4 + `tokens.js` (CommonJS), token lấy từ `dashboard/src/app/globals.css` | Giống request-app; app và dashboard đồng bộ màu |
| D5 | Jotai, mỗi phần của twin một atom | Telemetry 2 s/lần; chỉ component nào cần mới render lại |
| D6 | Không dùng React Query | Chỉ có một luồng SSE; snapshot đi cùng stream. REST chỉ dùng để gửi lệnh, `/health`, `/api/devices` |
| D7 | SSE bằng `react-native-sse` | RN không có `EventSource`; thư viện JS thuần, chạy trên XHR |
| D8 | Room twin + chart: `react-native-svg` + `d3-shape`/`d3-scale`, viết tay | Port gần 1-1 `RoomTwin.tsx` (SVG); chart giống dashboard, nhẹ |
| D9 | Icon `lucide-react-native` | Cùng bộ icon với dashboard (`lucide-react`) |
| D10 | Tách logic thuần dùng chung vào `packages/twin-core` | Ngưỡng, nhãn trạng thái, reducer twin, luật xung đột lệnh phải giống nhau ở hai app |
| D11 | URL backend + mã thiết bị nhập trong app (Settings), lưu bằng MMKV; mặc định lấy từ `EXPO_PUBLIC_*` | IP LAN đổi liên tục; emulator dùng `10.0.2.2` |
| D12 | Voice: STT trên điện thoại bằng dịch vụ nhận diện của Android (`expo-speech-recognition`) → `POST /api/devices/:code/assistant` → LLM ở **server** → `CommandService` với `source: "ai"` → TTS (`expo-speech`) | Key LLM không nằm trong APK; lệnh đi qua validate/rate limit có sẵn; dashboard thấy lệnh AI |
| D13 | LLM mặc định Gemini (project đã có key, `ml/generate_data.py`), sau interface `AssistantModel` để đổi provider | Không khoá vào một nhà cung cấp |
| D14 | Copy UI tiếng Anh như dashboard; voice hiểu cả tiếng Việt và tiếng Anh | Đồng bộ với dashboard; xem câu hỏi mở Q1 ở `06-roadmap.md` |
| D15 | Light + dark theo hệ thống, cho phép ép trong Settings | Dashboard đã có dark mode (`prefers-color-scheme`) |

## Trạng thái triển khai (2026-10-10)

M0–M5 đã có code (`packages/twin-core`, `mobile/`, `server/src/assistant/`). Chỗ code khác spec ban đầu (code là
sự thật):

| Spec ghi | Code làm | Vì sao |
|---|---|---|
| Metro: `extraNodeModules` + `disableHierarchicalLookup` (§5 của 01) | Config mặc định của Expo + `blockList` chặn `dashboard/`, `server/`, `device/`, `ml/` | SDK 55 tự hiểu pnpm workspace (isolated); tắt hierarchical lookup làm hỏng cách pnpm đặt dependency bắc cầu |
| pnpm mặc định "như request-app" | Request-app thật ra dùng `node-linker=hoisted`; repo này giữ isolated, chỉ thêm `react-native-css-interop` làm dependency trực tiếp | Babel của NativeWind chèn import `react-native-css-interop/jsx-runtime`, phải resolve được từ `mobile/` |
| `react-native-mmkv` (v3) | v4 + `react-native-nitro-modules` | Bản `expo install` chọn cho SDK 55 |
| `@gorhom/bottom-sheet` cho voice sheet | `features/voice/components/voice-sheet.tsx` là overlay trong layout tabs (bật bằng `voiceOpenAtom`), panel tự vẽ + Reanimated | Ít dependency native hơn; không cần snap points. Route `transparentModal` (và cả `Modal`) trên Android không che được tab bar |
| Tab bar mặc định + nút mic nổi | `components/tab-bar.tsx` tự vẽ (2 tab · mic · 2 tab) | Kiểm soát vị trí nút mic và badge |
| `jotai-effect` cho theo dõi lệnh | `store.sub(commandsAtom)` trong `twin-stream.tsx` | Một dependency ít hơn |
| Gemini qua `@google/genai` | `fetch` tới REST `generateContent` với `responseSchema` | Không thêm dependency cho server; dễ giả lập trong test |
| `expo-speech-recognition` bản mới nhất | Ghim `3.1.3` (dist-tag `sdk-55`) | 57.x cần Expo SDK 57, lỗi biên dịch Kotlin |
| — | `components/touchable.tsx` thay `Pressable` có style dạng hàm | NativeWind làm mất `style={({ pressed }) => …}` |
| Sheet chọn thiết bị trong Settings | Danh sách mở ngay dưới ô "Device code" | Đơn giản hơn, đủ cho vài thiết bị |

## Nguyên tắc không đổi so với dashboard

1. App **chỉ phản chiếu** trạng thái thiết bị. Không bao giờ tự giả định actuator đã đổi: chờ `status`/`ack` thật
   (cùng nguyên tắc ở `docs/architecture.md` §1).
2. Lệnh **luôn** đi qua backend (`POST /api/devices/:code/commands`). App không nói chuyện MQTT.
3. Ngưỡng màu chỉ để **tô màu**, không quyết định trạng thái; nguồn sự thật là `device/include/config.h`.
4. `@srdt/contracts` là schema chung. Mobile không định nghĩa lại kiểu dữ liệu đã có trong đó.

## Thuật ngữ

| Từ | Nghĩa |
|---|---|
| Twin | `DeviceRecord` (có `reported` = status mới nhất) + telemetry 15 phút + 20 event + 20 command |
| Edge state | `NORMAL` / `UNCOMFORTABLE` / `WARNING` / `DANGER`, thiết bị tự tính |
| Override | Chế độ tay (manual) sau khi có lệnh; hết sau 2 phút, có `expiresAt` để đếm ngược |
| ML state | Trạng thái do model TinyML trên thiết bị tính (`mlState`), `aiControl` = model đang điều khiển |
| Stale | Thiết bị online nhưng telemetry mới nhất cũ hơn 15 s |
| Open command | Lệnh có status `pending` hoặc `sent` (chưa có kết quả cuối) |
