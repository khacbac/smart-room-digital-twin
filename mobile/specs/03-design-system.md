# 03. Design system

Mục tiêu: mở app lên là thấy **cùng một sản phẩm** với dashboard (tông xanh lá dịu, ấm, nhiều khoảng thở, câu chữ
nhẹ nhàng kiểu "Your room, at a glance."), nhưng bố cục và tương tác theo kiểu mobile: một cột, thẻ lớn, chạm bằng
ngón cái, có animation và rung.

Nguồn gốc của token: `dashboard/src/app/globals.css` (`:root` và `@media (prefers-color-scheme: dark)`). Đổi màu ở
dashboard thì đổi `mobile/src/lib/theme/tokens.js` theo.

## 1. Màu

`tokens.js` (CommonJS, giống request-app) export `light`, `dark`, `metricTones`. `tailwind.config.js` map thành class
có tiền tố ngữ nghĩa; theme đổi bằng CSS variables của NativeWind (`vars()` ở root), nên class không đổi giữa
sáng/tối. Code cần hex (SVG, chart) đọc qua `useThemeColors()`.

| Token | Light | Dark | Dùng cho |
|---|---|---|---|
| `bg` | `#f6f7f4` | `#19211d` | Nền màn hình |
| `surface` | `#ffffff` | `#222c25` | Thẻ |
| `surface-2` | `#f4f5f1` | `#2b352c` | Nền phụ: segmented control, input, hàng chọn |
| `border` | `#e5e8e1` | `#354035` | Viền thẻ, hairline |
| `grid` | `#edf0e9` | `#313b32` | Lưới chart |
| `text` | `#26382f` | `#e2e7dd` | Chữ chính |
| `muted` | `#657369` | `#a0ac9c` | Chữ phụ |
| `accent` | `#527562` | `#8da58a` | Nút chính, tab đang chọn, focus |
| `accent-text` | `#ffffff` | `#19251b` | Chữ trên nền accent |
| `state-normal` | `#397454` | `#92bb8d` | NORMAL, online, executed |
| `state-uncomfortable` | `#9b741d` | `#dbc479` | UNCOMFORTABLE, stale |
| `state-warning` | `#ba6728` | `#dfac78` | WARNING |
| `state-danger` | `#be4949` | `#e9948e` | DANGER, lỗi, nút bật còi |
| `series-temp` | `#c88967` | `#d8a080` | Chart nhiệt độ |
| `series-hum` | `#74a7c3` | `#87b7c9` | Chart độ ẩm |
| `series-aq` | `#849b78` | `#b1c29a` | Chart chất lượng không khí |

Màu nền nhạt theo trạng thái (badge, banner, nút danger) = trộn màu trạng thái với `surface`, giống `color-mix` của
dashboard. Tính sẵn trong `tokens.js` bằng hàm `mix(hex, surface, pct)` lúc build config, không tính lúc render:

| Dùng cho | Tỉ lệ |
|---|---|
| Badge online / stale | 8% / 10% màu trạng thái |
| Nút danger: nền / viền | 5% / 20% |
| Banner cảnh báo | 10% |

### Tông của thẻ số đo (`metricTones`)

| Tone | Dùng cho | `bg` (light) | `color` (icon) | Viền thẻ (light) |
|---|---|---|---|---|
| peach | Nhiệt độ | `#f6e4d9` | `#b98463` | `#f1e5db` |
| blue | Độ ẩm | `#e1edf5` | `#6891ad` | `#e2ecef` |
| sand | Ánh sáng | `#f5eed8` | `#b39955` | `#f1ecdb` |
| sage | Không khí | `#e4eddd` | `#729663` | `#e4ecde` |
| lilac | Có người | `#ebe5f2` | `#9885ab` | `#e9e6ed` |

Nền thẻ light = trộn 38% `bg` của tone với trắng (peach `#fcf5f1`, blue `#f4f8fb`, sand `#fbf9f0`, sage `#f5f8f2`,
lilac `#f7f5fa`). Dark: nền thẻ là `surface`, viền `border`, chỉ ô icon có tint 14% tone, icon màu `text` (giống
dashboard dark).

## 2. Hình khối

| Token | Giá trị | Ghi chú |
|---|---|---|
| `radius-card` | 18 | Giống `--radius` của dashboard |
| `radius-control` | 12 | Nút, input, segmented |
| `radius-pill` | 999 | Badge, chip |
| Viền thẻ | 1 px `border` | |
| Bóng thẻ | `elevation: 0`; light: `shadowColor #23362a`, opacity 0.04, radius 14, offset y 3 | Rất nhẹ như dashboard (2%); Android chỉ dùng viền, không dùng elevation để tránh bóng xám đậm |
| Khoảng cách | thang 4: 4, 8, 12, 16, 20, 24, 32 | Lề màn hình 20; khoảng giữa thẻ 16; padding thẻ 20 |
| Chạm tối thiểu | 48 × 48 dp | Chuẩn Material |

## 3. Chữ

Dashboard dùng "Avenir Next" (macOS). Trên Android không có, nên mobile dùng **Nunito Sans** (Google Fonts, dáng
gần Avenir: tròn, mềm) qua `@expo-google-fonts/nunito-sans`, các weight 400/600/700. Số liệu dùng `fontVariant:
["tabular-nums"]` để số không nhảy khi cập nhật.

| Style | Size / line-height | Weight | Letter spacing | Dùng cho |
|---|---|---|---|---|
| `display` | 30 / 36 | 600 | -1.0 | Tiêu đề Home ("Your room, at a glance.") |
| `title` | 22 / 28 | 600 | -0.5 | Tiêu đề màn |
| `heading` | 17 / 22 | 600 | -0.35 | Tiêu đề thẻ (giống `h2` dashboard) |
| `metric` | 34 / 38 | 600 | -1.0 | Giá trị trong thẻ số đo |
| `metric-unit` | 15 / 20 | 600 | 0 | Đơn vị (°C, %, lx) |
| `body` | 15 / 22 | 400 | 0 | Nội dung |
| `label` | 13 / 18 | 600 | 0 | Nhãn, nút |
| `caption` | 12 / 16 | 400 | 0 | Thời gian, chú thích |
| `eyebrow` | 11 / 14 | 700 | 1.2, IN HOA | "YOUR CONNECTED SPACE" |

Dấu chấm màu accent sau tiêu đề lớn (`heading-dot` của dashboard): "Your room, at a glance**.**"

Tôn trọng cỡ chữ hệ thống (`allowFontScaling` mặc định), giới hạn `maxFontSizeMultiplier = 1.4` cho số liệu và tab
bar để không vỡ layout.

## 4. Icon

`lucide-react-native`, nét 2 (giống web), size 18–20 trong thẻ, 24 trong tab bar. Map giống dashboard:

| Khái niệm | Icon |
|---|---|
| Nhiệt độ / độ ẩm / ánh sáng / không khí / có người | `Thermometer` / `Droplets` / `Sun` / `Wind` / `UserRound` |
| Cửa sổ | `PanelsTopLeft` |
| Còi bật / tắt | `Volume2` / `VolumeX` |
| Trạng thái tốt / có vấn đề | `ShieldCheck` / `ShieldAlert` |
| Chế độ tay | `Hand` |
| AI trên thiết bị | `Sparkles` |
| Tự động lại | `RotateCcw` |
| Thiết bị | `Radio` |
| Tab Home / Trends / Controls / Activity | `House` / `Activity` / `SlidersHorizontal` / `History` |
| Settings | `Settings2` |
| Mic (M5) | `Mic` |

## 5. Component dùng chung (`src/components/`)

| Component | Mô tả |
|---|---|
| `Screen` | SafeArea + nền `bg` + `ScrollView` có pull-to-refresh tuỳ chọn; lề 20 |
| `Text` | Wrapper `Text` với prop `variant` theo bảng §3 và `tone` (`text`/`muted`/`accent`/state) |
| `Card` | `surface`, viền, radius 18, padding 20; prop `tone` cho metric card; `dimmed` (opacity 0.55) khi offline |
| `SectionHeader` | Tiêu đề thẻ + mô tả nhỏ + icon/slot bên phải (giống `card-head`) |
| `Button` | `variant`: `primary` (nền accent), `quiet` (nền surface-2), `danger` (nền đỏ 5%, chữ đỏ); `loading` hiện spinner thay icon; cao 48 |
| `IconButton` | Tròn 44, dùng ở header |
| `Badge` | Chấm + chữ, các kiểu online/offline/unknown/stale |
| `Pill` | Trạng thái command: pending/sent (accent), executed (normal), rejected/failed/timeout (danger) |
| `Tag` | "Auto" / "Manual" / "Unknown" |
| `SegmentedControl` | 2–3 lựa chọn, thanh chọn trượt bằng Reanimated |
| `EmptyState` | Icon trong vòng tròn `surface-2`, tiêu đề, một câu mô tả |
| `ToastHost` | Xem `02-data-layer.md` §6; viền trái màu theo tone (giống dashboard) |
| `Hairline` | Đường kẻ 1 px `border` |

## 6. Motion

Dùng Reanimated, chạy trên UI thread. Mọi animation tắt khi bật "Remove animations" của hệ thống
(`useReducedMotion()`): giá trị nhảy thẳng tới đích.

| Chỗ | Animation |
|---|---|
| Cánh cửa sổ trong room twin | `withTiming` 600 ms, `Easing.out(Easing.cubic)` theo `windowAngle` (giống `transition: width 600ms` của web) |
| LED WARNING | Nhấp nháy opacity 1 ↔ 0.25, chu kỳ 1 s |
| Sóng âm khi còi kêu | 2 vòng cung nở ra + mờ dần, lặp 1.2 s |
| Đổi giá trị số đo | Chữ số cross-fade 150 ms (không đếm số, để đọc ngay) |
| Đổi edge state | Màu chấm/viền chuyển 300 ms; `DANGER` thêm nhịp "pulse" một lần |
| Segmented control | Thanh chọn `withSpring` (damping 18) |
| Toast | Trượt lên + fade 220 ms |
| Nút đang chờ | Spinner thay icon; nút không đổi kích thước |
| Chuyển tab | Mặc định của expo-router (fade ngắn), không slide |

## 7. Haptics (`lib/haptics.ts`)

| Sự kiện | Kiểu |
|---|---|
| Bấm nút gửi lệnh | `impactAsync(Light)` |
| Lệnh `executed` | `notificationAsync(Success)` |
| Lệnh lỗi / bị từ chối / timeout, lỗi API | `notificationAsync(Error)` |
| Kéo slider qua mỗi nấc 10° | `selectionAsync()` |
| Edge state chuyển sang `DANGER` khi app đang mở | `notificationAsync(Warning)` |
| Bắt đầu / dừng nghe (M5) | `impactAsync(Medium)` / `impactAsync(Light)` |

## 8. Accessibility

- Mọi nút icon có `accessibilityLabel`; thẻ số đo đọc thành câu: "Temperature 27.4 degrees, normal".
- Room twin SVG: `accessible` + `accessibilityLabel` giống `aria-label` của dashboard ("Live room: Normal, window 45
  degrees, alarm off").
- Không chỉ dùng màu để báo trạng thái: luôn có chữ (Normal / Warning…) cạnh màu.
- Tương phản: các cặp `text`/`muted` trên `bg`/`surface` ở cả hai theme đạt WCAG AA (đã đạt ở dashboard, giữ nguyên
  hex).
- Live region: toast và banner kết nối dùng `accessibilityLiveRegion="polite"`.

## 9. Ảnh

- `room-interior.jpg` copy từ `dashboard/public/images/`, hiển thị bằng `expo-image` (`contentFit="cover"`,
  `transition={200}`), giữ dòng credit "Photo: Spacejoy / Unsplash" (`dashboard/public/images/CREDITS.md`).
- Splash: nền `bg`, logo house trong ô bo góc màu accent.
