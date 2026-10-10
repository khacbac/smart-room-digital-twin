# 04. Màn hình

## 1. Điều hướng

```
Root Stack (app/_layout.tsx)
├─ ConnectionGate            (không phải route: phủ lên tabs khi twinStatus ≠ ready, §2)
├─ (tabs)                    Tab bar dưới, 4 tab
│  ├─ index      Home        House
│  ├─ trends     Trends      Activity
│  ├─ controls   Controls    SlidersHorizontal
│  └─ activity   Activity    History   (badge chấm đỏ khi có event warning/critical chưa xem)
├─ settings                  push, mở từ icon ⚙ ở header mọi tab
└─ voice                     (M5) modal dạng sheet, mở từ nút mic nổi giữa tab bar
```

Tab bar: nền `surface`, viền trên `border`, icon 24, nhãn `caption`; tab đang chọn màu `accent` với nền pill
`surface-2` sau icon. Từ M5 có nút mic tròn 56 dp màu accent **nổi giữa** tab bar (2 tab mỗi bên).

Header mỗi tab (không dùng header mặc định của stack): trái là tiêu đề màn (`title`), phải là `PresenceBadge` thu
gọn (chấm + "Online") và `IconButton` Settings. Home có header lớn riêng (§3.1).

Deep link: `smartroom://` → Home; `smartroom://controls` → Controls. Chỉ để dev mở nhanh, không quảng bá.

## 2. Các trạng thái dùng chung

| Trạng thái | Điều kiện | Hiển thị |
|---|---|---|
| **Loading** | `twinStatus = "loading"` | `ConnectionGate` toàn màn: ô icon House, eyebrow "YOUR CONNECTED SPACE", tiêu đề "Getting your room ready", mô tả "Connecting to {deviceCode}. Your live readings will appear here.", dòng spinner "Connecting to your room…". Sau 8 s vẫn loading thì hiện thêm nút "Connection settings" |
| **Error** (chưa từng có dữ liệu) | `twinStatus = "error"` | Cùng khung: "Let's reconnect your room" / "We can't reach your room right now. We'll keep trying automatically." Nút "Try again" (reconnect ngay), nút "Connection settings", mục mở rộng "Connection details": lỗi, URL, gợi ý (`02-data-layer.md` §5) |
| **Reconnecting** (đã có dữ liệu) | `connection ≠ live` | Banner mỏng dưới header mọi tab: "Live updates paused, reconnecting…", nền tint `state-uncomfortable` 10%. Dữ liệu cũ vẫn hiện |
| **Device offline** | `presence ≠ online` | Badge "Offline"; thẻ số đo và status mờ (`dimmed`); room twin overlay "Offline"; nút điều khiển disabled + dòng giải thích |
| **Stale** | online, telemetry > 15 s | Badge thêm "Stale data" (màu uncomfortable) cạnh "Online" |
| **DHT lỗi** | `reported.sensorFault.dht` | Thẻ nhiệt độ/độ ẩm hiện "—" và note "Sensor fault" |

## 3. Home (`(tabs)/index.tsx`)

Mục đích: một cái nhìn trả lời "phòng tôi có ổn không, cửa sổ/còi đang thế nào". Cuộn dọc, pull-to-refresh =
reconnect.

### 3.1 Header lớn

- Eyebrow: `MY SPACE · OVERVIEW`
- Tiêu đề `display`: "Your room, at a glance." (dấu chấm màu accent)
- Mô tả `muted`: "A little insight. A more comfortable space."
- Hàng thiết bị: icon `Radio` + tên thiết bị (`device.name`) · `PresenceBadge` (+ "Stale data") · "Last seen 3 s
  ago" (tick mỗi giây, chỉ dòng này render lại).
- Góc phải: `IconButton` Settings.

### 3.2 Room hero (`room-hero.tsx`)

Thẻ full-width, tỉ lệ 680:350 như SVG của dashboard, bo 18.

- `SegmentedControl` góc trên phải: **Room** (ảnh) | **Live twin** (SVG). Mặc định **Live twin** trên mobile (khác
  web) vì đây là thứ "live"; lưu lựa chọn trong MMKV.
- **Live twin**: port `RoomTwin.tsx` sang `react-native-svg`, giữ nguyên toạ độ, gradient và luật hiển thị:
  - Bề rộng cánh cửa = `max(3, 89·cos(angle))`, animate 600 ms.
  - 3 LED: đỏ khi DANGER, vàng khi WARNING/UNCOMFORTABLE (nhấp nháy khi WARNING), xanh khi NORMAL, xám khi tắt.
  - Sóng âm cạnh loa khi `buzzer = true`.
  - Hình người khi `presence = true`.
  - Lớp tối theo ánh sáng: `opacity = 0.28·(1 − clamp(light/300))`.
  - Lớp hồng mờ theo không khí: `opacity = 0.2·clamp((AQ−300)/700)`.
  - Dòng số đo dưới cùng: "27.4 °C · 61 % · 240 lx · 320 AQ".
- **Room**: `room-interior.jpg`, caption "Illustrative room", credit ảnh.
- Overlay dưới trái (gradient tối nhẹ để đọc chữ): eyebrow "LIVE DIGITAL TWIN"/"YOUR CONNECTED SPACE" + tên phòng
  (`device.name`, nếu trùng `code` thì "Your connected room"). Dưới phải: chip trạng thái có chấm màu ("Normal",
  "Awaiting data", "Offline").
- Chạm vào hero ở chế độ Live twin → mở Controls.

### 3.3 Status card (`status-card.tsx`)

Port `StatusStrip.tsx`:

- Dòng chính: icon `ShieldCheck` (NORMAL) / `ShieldAlert` (khác), eyebrow "ROOM CONDITION", giá trị lớn tô màu theo
  state ("Normal", "Uncomfortable", "Warning", "Danger", "Awaiting data").
- Lưới 2 cột các mục:
  - **Window**: `windowLabel()`, ví dụ "45° (partly open)".
  - **Alarm**: "Sounding" / "Off" / "—".
  - **Control mode**: "Automatic" hoặc "Window + alarm (1:42)" đếm ngược theo `override.expiresAt`; hết giờ thì
    "(ending…)". Đây là thành phần thứ hai tick mỗi giây.
  - **Room intelligence** (chỉ khi thiết bị gửi `mlState`): "Warning · active" / "Normal · advisory" / "no input",
    tô màu theo `mlState`. Chạm vào icon ⓘ → tooltip/sheet: "On-device AI: active means it controls the window and
    alarm; safety rules remain in effect."
- Chân thẻ (`caption`, `muted`): "fw 1.4.0 · RSSI −61 dBm".

### 3.4 Metric grid (`metric-grid.tsx`)

5 thẻ, lưới 2 cột: Temperature, Humidity, Light, Air quality, và Occupancy (full-width ở hàng cuối, dạng ngang thấp
hơn). Mỗi thẻ (port `ValueCards.tsx`):

- Hàng trên: nhãn (`label`, muted) + ô icon tròn 36 nền tone.
- Giá trị `metric` + đơn vị; tô màu state nếu vượt ngưỡng (`levelFor` + `TEMP_LINES`/`HUMIDITY_LINES`/`AQ_LINES`).
- Note dưới có chấm: tên mức ("Warning") nếu vượt ngưỡng, ngược lại câu mặc định ("Below heat threshold", "Below high
  threshold", "Ambient light", "Below alert threshold", "Motion detected"/"No motion detected"); thiếu dữ liệu thì
  "Waiting for reading" hoặc "Sensor fault".
- Mini sparkline 15 phút (cao 28, không trục, màu series) dưới giá trị cho nhiệt độ, độ ẩm, không khí. Chạm thẻ →
  sang Trends với series đó.

### 3.5 Quick actions

Hàng 3 nút `quiet` ngang: "Open window" (90°), "Close window", "Silence alarm". Cùng luật busy/disabled như
Controls; kết quả qua toast. "Silence alarm" nổi bật (variant danger) khi `buzzer = true`.

### 3.6 Footer

`caption` muted, căn giữa: "Smart Room Digital Twin · Connected spaces. Considered living."

## 4. Trends (`(tabs)/trends.tsx`)

Port `TrendCharts.tsx`, tối ưu cho chạm.

- Header: "Room trends" + mô tả "Small changes, a clearer picture." + chip "Last 15 min" (icon `Clock3`).
- `SegmentedControl` 3 lựa chọn có chấm màu: Temperature · Humidity · Air quality. Nhớ lựa chọn cuối (MMKV); nhận
  param `?series=` khi đi từ thẻ ở Home.
- **Chart** (`trend-chart.tsx`, cao 260, full-width trong thẻ):
  - Trục X: thời gian, domain `[now − 15 phút, now]`, cập nhật mỗi 5 s; nhãn "HH:mm" (24 h), tối đa 4 nhãn.
  - Trục Y: nhiệt độ auto (pad ±1 °C, làm tròn); độ ẩm 0–100; AQ 0–1000. Nhãn bên trái, `caption` muted.
  - Lưới ngang nét đứt `grid` (3 5).
  - Đường cong `curveMonotoneX`, nét 2.5, màu series; vùng dưới gradient 18% → 1%.
  - **Ngắt đường** khi hai điểm cách nhau > 20 s (giống `GAP_MS` của dashboard), không nối qua lúc mất kết nối.
  - Đường ngưỡng nét đứt màu state, opacity 0.45, nhãn nhỏ bên phải ("29°", "31°", "34°").
  - **Chạm và kéo**: đường dọc + chấm + bong bóng giá trị "14:32:10 · 27.4 °C"; rung `selection` khi nhảy điểm. Thả
    tay thì ẩn sau 1.5 s. Dùng Gesture Handler `Pan` + Reanimated shared value; tìm điểm gần nhất bằng chặt nhị phân.
  - Không có dữ liệu: `EmptyState` "Your room's story starts here" / "Trends will appear as sensor readings arrive."
- **Tóm tắt** dưới chart, 4 ô: Now · Min · Avg · Max trong 15 phút (bỏ giá trị null).
- Chân: "Dashed lines mark alert thresholds" · "Updates automatically".
- Ghi chú (`caption`): lịch sử dài hơn 15 phút cần cloud storage (giống dashboard, `docs/cloud.md`), chưa làm.

## 5. Controls (`(tabs)/controls.tsx`)

Port `Controls.tsx`. Mọi nút theo luật busy/disabled ở `02-data-layer.md` §3.3. Thiết bị offline → thẻ thông báo
trên cùng "Your device is offline. Controls will be available when it reconnects." và mọi control disabled.

### 5.1 Window card

- Heading: ô icon `PanelsTopLeft` + "Window" + dòng phụ `windowLabel(reported)` + `Tag` Auto/Manual/Unknown.
- **Angle dial** (`angle-dial.tsx`): cung 0–90° (¼ vòng tròn) vẽ bằng SVG:
  - Kim **thật** (màu `text`, mảnh) = góc thiết bị báo về, animate khi thay đổi.
  - Núm **mục tiêu** (màu accent, to) = góc người dùng chọn, kéo trên cung (Gesture Pan), bước 1°, rung mỗi 10°.
  - Giữa cung: số lớn "{target}°", dưới là "Now {actual}°".
  - Phạm vi chọn 1–90 (`WINDOW_ANGLE_MIN/MAX` của contracts); mặc định 90.
- Chip preset: 25° · 45° · 90°.
- Hai nút: **"Open {target}°"** (primary, `OPEN_WINDOW` + `value`) và **"Close"** (quiet, `CLOSE_WINDOW`).

### 5.2 Alarm card

- Heading: `Volume2` + "Room alarm" + "Alarm is sounding" / "Alarm is off" / "Awaiting device status" + `Tag`.
- Nút **"Turn on"** (danger, `BUZZER_ON`): mở dialog xác nhận "Sound the room alarm?" (Cancel / Turn on), vì nó
  phát tiếng thật ở phòng. Nút **"Silence"** (quiet, `BUZZER_OFF`), không cần xác nhận.

### 5.3 Automatic control card

- Nút "Resume automatic control" (`CLEAR_OVERRIDE`), chỉ bật khi đang có override (`window || buzzer`); nếu không có
  override thì disabled và dòng phụ "Already automatic".
- Dòng giải thích: "Manual changes last 2 minutes, then automatic control resumes." + đếm ngược khi đang manual.

### 5.4 Recent commands

Danh sách 6 lệnh mới nhất (`commandsAtom`): tên (`ACTION_LABEL` + "45°" nếu có value), `Pill` status, lý do (nếu
có), giờ `HH:mm:ss`, và icon nguồn nhỏ (`source`: dashboard/ai/api; lệnh của voice hiện `Sparkles`). "See all" →
Activity, tab Commands.

## 6. Activity (`(tabs)/activity.tsx`)

- `SegmentedControl`: **Events** | **Commands**.
- **Events** (port `EventList.tsx`): mỗi dòng có ô icon theo severity (`Activity` cho info, `CircleAlert` cho
  warning/critical, tint màu), tiêu đề `eventLabel(type)` ("State changed"), chip severity, mô tả (`STATE_CHANGED` nối
  thêm `data.reasons`), giờ nhận (`createdAt`). Nhóm theo "Today"/ngày nếu qua ngày.
  - Rỗng: `EmptyState` `CheckCheck` "All quiet for now" / "Room updates and alerts will appear here."
- **Commands**: tối đa 20 lệnh, cùng dạng dòng như §5.4, thêm thời gian phản hồi "acked in 0.8 s" khi `executed`.
  - Rỗng: "No commands yet."
- Pull-to-refresh = reconnect.
- Badge trên tab: chấm đỏ khi có event `warning`/`critical` mới hơn lần cuối mở tab (lưu `lastSeenEventAt` trong
  MMKV).

## 7. Settings (`settings.tsx`)

Màn push, header "Settings" có nút back.

| Nhóm | Mục |
|---|---|
| **Connection** | Ô "Backend URL" (keyboard `url`, không tự viết hoa) · ô "Device code" + nút "Choose" mở sheet danh sách từ `GET /api/devices` (tên, mã, presence) · nút **Save** (chỉ bật khi giá trị hợp lệ và khác hiện tại) · nút **Test connection** → `GET /health`, hiện "Backend ✓ · MQTT connected · storage memory ✓" hoặc lỗi kèm gợi ý · dòng nhỏ chế độ mạng hiện tại ("Emulator → 10.0.2.2") |
| **Appearance** | Theme: System / Light / Dark |
| **Voice** (M5) | Ngôn ngữ nghe: Tiếng Việt / English · "Read replies aloud" on/off · trạng thái quyền micro + nút mở cài đặt hệ thống nếu bị từ chối |
| **Device** | Tên, mã, firmware, boot id, uptime ("2 h 14 min"), RSSI, lần cuối thấy |
| **About** | Phiên bản app (`expo-constants`), "Smart Room Digital Twin", credit ảnh |

## 8. Voice (M5)

Đặc tả đầy đủ ở `05-voice-assistant.md` §5.

## 9. Copy

Giọng văn giống dashboard: ngắn, ấm, không kỹ thuật ở bề mặt; chi tiết kỹ thuật để trong "details". Toàn bộ chuỗi đặt
gần component dùng nó (không có file i18n, D14). Nhãn lệnh, nhãn trạng thái, text kết quả lấy từ twin-core để giống
dashboard từng chữ.
