# 06. Roadmap, kiểm thử, rủi ro

## 1. Milestone

Mỗi milestone là một (hoặc vài) commit chạy được. Không bắt đầu milestone sau khi milestone trước chưa đạt DoD.

### M0: `packages/twin-core` + chuyển dashboard sang dùng

- Tạo package (`01-architecture.md` §3), chuyển logic thuần từ dashboard, viết test vitest.
- Dashboard đổi import, thêm `transpilePackages`.
- **DoD:** `pnpm -r typecheck` và `pnpm -r test` xanh; `pnpm build:dashboard` thành công; mở dashboard với
  fake-device, mọi thứ hiển thị và điều khiển như trước.

### M1: Dựng app + lớp dữ liệu

- Tạo `mobile/` bằng `create-expo-app`, cấu hình theo `01-architecture.md` (Metro monorepo, NativeWind, tokens,
  font, `app.config.ts`, `eas.json`), thêm vào workspace và script root.
- `rn-sse.ts`, `twin-stream.tsx`, atoms (`02-data-layer.md` §1–2), Settings tối thiểu (URL + mã thiết bị + Save).
- Màn Home dạng thô: in tên thiết bị, presence, số đo mới nhất, trạng thái kết nối.
- **DoD:** `pnpm mobile:android` chạy trên emulator; với `pnpm dev:server` + `fake-device`, Home cập nhật mỗi 2 s;
  tắt server thì hiện reconnecting, bật lại thì tự live; đổi URL trong Settings thì kết nối lại; cho app vào nền
  > 30 s rồi mở lại vẫn live.

### M2: UI hoàn chỉnh Home + Controls

- Component dùng chung (`03-design-system.md` §5), theme sáng/tối.
- Home đầy đủ: header, room hero (port SVG + animation), status card, metric grid + sparkline, quick actions.
- Controls đầy đủ: angle dial, alarm (có xác nhận), resume auto, recent commands; mutation + toast + haptics.
- Connection gate và mọi trạng thái ở `04-screens.md` §2.
- **DoD:** so sánh cạnh dashboard: cùng số, cùng nhãn, cùng màu trạng thái ở mọi edge state (dùng chế độ roaming của
  fake-device để đi qua đủ trạng thái); mở/đóng cửa, bật/tắt còi, resume chạy end-to-end, toast đúng kết quả; thiết
  bị offline thì nút khoá; dark mode không có chỗ nào sai màu.

### M3: Trends + Activity + Settings đầy đủ

- Chart có ngưỡng, ngắt đoạn, chạm-kéo xem giá trị, tóm tắt min/avg/max.
- Activity (events/commands, badge tab).
- Settings đầy đủ (chọn thiết bị, test connection, theme, thông tin thiết bị).
- **DoD:** chart khớp dashboard trong cùng 15 phút; kéo trên chart mượt (không giật trên emulator); badge Activity
  xuất hiện khi có event warning và mất khi mở tab.

### M4: Hoàn thiện + APK

- Icon, adaptive icon, splash, tên app; rà a11y (TalkBack đọc được các thẻ chính); reduced motion.
- Chạy trên **điện thoại thật** qua LAN (`HOST=0.0.0.0`).
- Build APK profile `preview`; cập nhật `README.md` gốc (mục chạy mobile) và `docs/architecture.md` (thêm mobile
  vào sơ đồ).
- **DoD:** cài APK lên điện thoại thật, chạy được với backend trong LAN; cập nhật mobile/README.md với hướng dẫn
  chạy.

### M5: Voice assistant

- Server: contracts `assistant.ts`, module `server/src/assistant/`, endpoint, test, script eval (`05-voice-assistant.md`
  §2–3).
- App: dev client có `expo-speech-recognition`, voice sheet, nút mic, cài đặt Voice.
- **DoD:** test server xanh; eval ≥ 90% đúng action; trên điện thoại thật nói tiếng Việt "mở cửa sổ một nửa" → cửa
  sổ (Wokwi hoặc fake-device) mở 45° và thẻ kết quả chuyển ✓ trong < 4 s kể từ lúc nói xong; dashboard hiện lệnh với
  nguồn AI; "bật còi" luôn hỏi xác nhận.

## 2. Kiểm thử

| Lớp | Cách |
|---|---|
| `twin-core` | vitest: `applyMessage` (snapshot thay hết, telemetry trùng id bị bỏ, cắt lịch sử 15 phút, upsert event/command), `levelFor`, `conflicts`, `deriveRoomView` (stale, lastSeenAt), `countdown`, `ago` |
| Server assistant | vitest (`05-voice-assistant.md` §3.5) |
| Mobile | `tsc --noEmit`; kiểm thủ công trên emulator theo checklist bên dưới. Không viết component test trong phạm vi này |

Checklist thủ công (mỗi milestone chạy phần liên quan), dùng `fake-device` (có chế độ roaming đi qua mọi trạng thái):

1. Mở app khi backend tắt → gate Error + gợi ý đúng URL.
2. Bật backend → tự vào Home, không cần bấm gì.
3. Đổi edge state NORMAL → WARNING → DANGER: màu, LED, nhấp nháy, rung warning.
4. Mở cửa 45° → toast "completed", room twin animate, control mode đếm ngược 2:00.
5. Gửi 11 lệnh trong 1 phút → toast "Too many commands".
6. Dừng fake-device → sau ~45 s presence Offline, nút khoá, thẻ mờ.
7. Telemetry dừng nhưng thiết bị vẫn online → "Stale data" sau 15 s.
8. Bật/tắt Wi-Fi điện thoại → banner reconnecting → live lại.
9. Dark mode hệ thống ↔ light.
10. Cỡ chữ hệ thống lớn nhất → không vỡ layout chính.

Argent (công cụ điều khiển emulator cho agent) hiện chưa cài; cài (`npx @swmansion/argent@latest init -y`) để agent tự
chạy checklist trên emulator và chụp màn hình.

## 3. Rủi ro

| Rủi ro | Ảnh hưởng | Cách xử lý |
|---|---|---|
| SSE trên Android bị buffer (OkHttp/network inspector trong debug giữ response) | Không nhận message live | Kiểm ở M1 ngay; nếu bị: tắt network inspector của dev tools cho URL stream, hoặc thử bản release; phương án cuối: polling `GET /api/devices/:code` mỗi 2 s qua cùng interface `TwinSource` |
| pnpm symlink + Expo autolinking / Metro | Build hỏng, trùng React | Làm theo `01-architecture.md` §5; request-app đã chạy được với pnpm. Cùng lắm `node-linker=hoisted` (phải hỏi trước) |
| React 19.2 (mobile) vs 19.3 (dashboard) | Trùng bản React trong bundle | `extraNodeModules` trỏ vào `mobile/node_modules`; `blockList` chặn `dashboard/` |
| Nhận diện tiếng Việt cần mạng, chất lượng tuỳ máy | Voice nghe sai | Hiện chữ tạm thời để người dùng thấy; ô gõ chữ thay thế; prompt chịu được lỗi chính tả |
| LLM chậm / hết quota | Voice treo | Timeout 10 s, rate limit, provider `rules` để demo offline |
| LLM ra lệnh sai | Cửa sổ/còi chạy ngoài ý muốn | Chỉ 5 action, kẹp value, bỏ lệnh vô nghĩa, `BUZZER_ON` phải xác nhận, override tự hết sau 2 phút, edge rules trên thiết bị vẫn là lớp an toàn cuối |
| Không có auth | Ai trong LAN cũng điều khiển được | Ngoài phạm vi (giống dashboard); ghi trong README |

## 4. Câu hỏi mở

| # | Câu hỏi | Mặc định nếu không ai trả lời |
|---|---|---|
| Q1 | Giao diện app tiếng Anh (như dashboard) hay tiếng Việt? | Tiếng Anh; voice hiểu cả hai |
| Q2 | Có cần push notification khi phòng sang DANGER lúc app đang tắt không? | Không làm: cần FCM + server gửi push, là một khối việc riêng |
| Q3 | Có cần phân biệt lệnh từ app với lệnh từ dashboard (`source: "mobile"`) không? | Không: dùng `"dashboard"` cho lệnh tay, `"ai"` cho voice. Muốn thêm thì phải đổi contracts + firmware |
| Q4 | Khi team cloud xong Firestore, mobile có đọc thẳng Firestore không? | Không: mobile vẫn đọc qua backend SSE; `TwinSource` cho phép thêm nguồn khác sau |
| Q5 | Provider LLM: Gemini hay Claude? | Gemini (đã có key trong project); `AssistantModel` cho phép thêm provider |
| Q6 | Có cần hỗ trợ nhiều phòng (chọn thiết bị nhanh trên Home) không? | Chỉ chọn trong Settings; 1 phòng tại một thời điểm |
