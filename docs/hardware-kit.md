# Mạch node bằng bộ kit ESP32 (`env:kit`, `env:node-kit`)

Bản phần cứng cho bộ kit starter: **ESP32 thường (ESP-32S, board `esp32dev`)**, DHT11, module ánh sáng, module
hồng ngoại, PIR HC-SR501, relay 5 V 2 kênh, OLED 0.96", nút 12×12, LED trắng/vàng/xanh dương/đỏ, còi thụ động.
Firmware bật bằng `-D BOARD_KIT` (chân trong `device/include/config.h`); `main.cpp`, edge rules, MQTT và dashboard
**không đổi**. Bản ESP32-S3 + Wokwi (`env:esp32-s3`, `node`, `*-wokwi`) vẫn giữ nguyên.

| Env | Dùng khi |
|---|---|
| `kit` | chỉ có 1 board này: tự lên Wi-Fi + MQTT như `esp32-s3` (Wi-Fi/broker lấy từ `secrets.ini`, mục `[env:kit]`) |
| `node-kit` | làm mạch node của cặp 2 mạch: uplink qua UART1 (GPIO4 RX / GPIO5 TX) tới gateway, như `node` |

## 1. Khác gì so với mạch Wokwi

| Mạch Wokwi (S3) | Bộ kit | Hệ quả |
|---|---|---|
| ESP32-S3 DevKitC-1 | ESP32 thường (ESP-32S) | sơ đồ chân mới (§2) |
| DHT22 | DHT11 | 0–50 °C ±2 °C, 20–90 %RH, số nguyên; ngưỡng rules giữ nguyên |
| Biến trở (giả lập chất lượng không khí) | 2 nút **AQ+ / AQ−**, sau này **MQ-135** (§5) | nút: mỗi lần bấm ±100 (0…1000), khởi động ở 200. MQ-135: chỉ số tương đối từ cảm biến thật |
| PIR | PIR **hoặc** module hồng ngoại | `presence = true` khi PIR có chuyển động hoặc IR thấy vật trước mặt (người ngồi yên PIR không bắt được) |
| Servo cửa sổ 0–90° | Relay kênh 1 | góc > 0 → relay đóng (cửa mở). Góc báo lên MQTT vẫn là góc lệnh, dashboard không đổi |
| LCD 1602 I2C | OLED 0.96" SSD1306 I2C (0x3C) | cùng nội dung §7.7: dòng 1 nhỏ, trạng thái chữ to, `NET/OFF OV` bên dưới |
| LED xanh lá | **LED xanh dương** | vẫn là đèn "NORMAL" (trong code vẫn tên `Led::Green`) |
| Buzzer (Wokwi) | Còi **thụ động** | firmware phát tone 2 kHz (LEDC), còi chủ động không kêu đúng với tone |

## 2. Sơ đồ chân

| Linh kiện | Chân linh kiện → nối tới | GPIO | Ghi chú |
|---|---|---|---|
| DHT11 module | DATA / VCC / GND → GPIO16 / 3V3 / GND | 16 | DHT11 trần 4 chân: thêm điện trở 10 kΩ từ DATA lên 3V3 |
| Module ánh sáng | AO / VCC / GND → GPIO32 / 3V3 / GND | 32 (ADC1) | cần chân **AO**. Module chỉ có DO thì cắm DO vào GPIO32: ánh sáng chỉ còn 2 mức (0 hoặc max) |
| PIR HC-SR501 | OUT / VCC / GND → GPIO34 / **5V** / GND | 34 | nguồn 5 V (VIN), OUT ra 3.3 V an toàn. Jumper ở **H**, vặn biến trở thời gian về nhỏ nhất (~3 s). Chờ 30–60 s sau khi cấp nguồn |
| Module hồng ngoại | OUT / VCC / GND → GPIO35 / 3V3 / GND | 35 | OUT = LOW khi có vật. Vặn biến trở trên module chỉnh khoảng cách |
| Nút MODE | 1 chân → GPIO13, chân chéo đối diện → GND | 13 | nhấn ngắn: tắt còi 120 s; giữ 2 s: xoá mọi override |
| Nút AQ+ | → GPIO14 / GND | 14 | air quality +100 |
| Nút AQ− | → GPIO33 / GND | 33 | air quality −100 |
| MQ-135 (khi có, §5) | AO → cầu chia 10k/20k → GPIO36; VCC → **5V**, GND → GND | 36 (VP, ADC1) | chỉ khi `KIT_MQ135=1`; khi đó 2 nút AQ bỏ trống |
| LED xanh dương (NORMAL) | GPIO25 → 100 Ω → chân dài LED, chân ngắn → GND | 25 | xanh dương/trắng sụt áp ~3 V nên dùng 100 Ω, không thì rất mờ |
| LED vàng (UNCOMF / WARNING nháy) | GPIO26 → 220 Ω → LED → GND | 26 | |
| LED đỏ (DANGER) | GPIO27 → 220 Ω → LED → GND | 27 | |
| Còi thụ động | + → 100 Ω → GPIO23, − → GND | 23 | |
| Relay 2 kênh | IN1 / VCC / GND → GPIO18 / **5V** / GND | 18 | kích mức LOW (`RELAY_ACTIVE_LOW`). IN2 để trống (dự phòng, ví dụ quạt) |
| OLED 0.96" (4 chân) | SDA / SCL / VCC / GND → GPIO21 / GPIO22 / 3V3 / GND | 21, 22 | địa chỉ 0x3C; không hiện gì và console in `[oled] no SSD1306 at 0x3C` thì thử `-D OLED_I2C_ADDR=0x3D`. OLED 7 chân (SPI) không dùng được |
| Link UART1 (chỉ `node-kit`) | GPIO5 node → RX gateway, GPIO4 node ← TX gateway, chung GND | 4, 5 | giống `docs/link-protocol.md` §6.1 |

Chân đã tránh: GPIO0/2/12/15 (strapping, GPIO12 kéo lên lúc boot là hỏng nạp flash), GPIO6–11 (flash), ADC2 (chết khi
bật Wi-Fi). GPIO34/35 chỉ là input và không có pull-up nội, nên chỉ dùng cho PIR và IR (hai module tự đẩy mức).
Các chân trên có trên cả board 30 chân (DOIT DevKit V1) lẫn 38 chân (NodeMCU-32S).

**Cửa sổ giả lập trên tiếp điểm relay** (tận dụng LED trắng): 5V → **COM1**, **NO1** → 220 Ω → LED trắng → GND.
LED trắng sáng = cửa đang mở. Relay chỉ dùng cho tải nhỏ 5 V ở đây, **không** đấu điện 220 V trên testboard.

## 3. Lắp trên testboard 830 lỗ

- Board ESP32 rộng, cắm lên testboard thì gần như không còn lỗ trống hai bên. Để board **ngoài** testboard và nối bằng
  20 dây đực-cái: 16 tín hiệu + 3V3 + 5V (VIN) + 2 GND, vừa đủ 20 sợi.
- Hai thanh nguồn của testboard: một thanh **3V3** (DHT11, ánh sáng, IR, OLED), một thanh **5V** (PIR, relay); cả hai
  thanh GND nối chung với GND board. Linh kiện nối lên thanh bằng dây đực-đực.
- Nút 12×12: 4 chân chia thành 2 cặp đã nối sẵn; cắm vắt qua rãnh giữa, lấy 2 chân **chéo nhau** là chắc đúng cặp.
- Còi chủ động, LED trắng/vàng/xanh/đỏ còn lại, 2 nút còn lại, relay kênh 2: dự phòng.

**Relay 5 V không nhả khi IN ở 3.3 V:** một số module (có jumper JD-VCC) không tắt hẳn vì 3.3 V chưa đủ để cắt
optocoupler. Khi đó rút jumper JD-VCC, cấp **JD-VCC = 5V**, **VCC = 3V3** (VCC chỉ nuôi đèn optocoupler).

## 4. Nạp và chạy

```sh
cd device

# 1 board (chỉ có kit): điền Wi-Fi 2.4 GHz + IP broker vào mục [env:kit] của secrets.ini
cp secrets.ini.example secrets.ini
pio run -e kit -t upload
pio device monitor -b 115200

# Mạch node của cặp 2 mạch (gateway là board thứ hai, xem docs/link-protocol.md §6.1)
pio run -e node-kit -t upload
```

Nạp bị treo ở `Connecting....` thì giữ nút **BOOT** trên board tới khi bắt đầu ghi. Broker nghe LAN như M3:
`cd broker && mosquitto -c mosquitto-lan.conf -v`.

**Kiểm tra từng phần** (console `s` in giá trị thô, `help` xem lệnh):

1. OLED hiện `digital-twin` / `fw …`, sau đó `T.. H.. A200` và `NORMAL`, LED xanh dương sáng.
2. Che module ánh sáng → `[raw] ldr adc=…` đổi. Nếu che mà `light` **tăng** thì đặt `LDR_INVERT 1` trong `config.h`.
3. Bấm AQ+ 3 lần (console `[aq] 500`) → UNCOMF (LED vàng); tới 700 → WARNING (vàng nháy); tới 900 → DANGER (LED đỏ,
   còi kêu ngắt quãng, relay đóng, LED trắng sáng). AQ− về dưới 470 → lần lượt về NORMAL (mỗi bậc giữ ≥ 5 s).
4. Trong DANGER bấm MODE → còi tắt, OLED hiện `OV`. Giữ MODE 2 s → hết `OV`.
5. Vẫy tay trước PIR hoặc đưa tay trước IR → `pir=1` trong dòng `[edge]`.
6. Dashboard: `open 45` / *Open window* → relay đóng; *Close* → relay nhả.

## 5. Thay nút AQ bằng MQ-135 (khi mua về)

Chỉ đổi cách đọc trong `sensors.cpp`; rules, MQTT, dashboard giữ nguyên. Chỉ số vẫn là thang 0–1000 **tương đối**
(không phải ppm), nên cần hiệu chỉnh một lần theo cảm biến của bạn.

1. **Nối dây.** VCC → 5V, GND → GND. AO ra tới 5 V nên **không** cắm thẳng vào ESP32: AO → 10 kΩ → điểm giữa →
   20 kΩ → GND; điểm giữa → GPIO36 (5 V × 20/30 ≈ 3.3 V). Hai điện trở có trong túi điện trở. Chân DO bỏ trống.
2. **Bật trong firmware:** thêm `-D KIT_MQ135=1` vào `build_flags` (mục `[env:kit]` trong `secrets.ini`, hoặc
   `[kit_base]` trong `platformio.ini`), nạp lại. Trong 2 phút đầu (`MQ135_WARMUP_MS`) cảm biến còn đang nóng lên nên
   air quality giữ ở 200, tránh DANGER giả lúc khởi động. Cảm biến mới tinh nên cấp nguồn 24 h cho "chín" trước.
3. **Hiệu chỉnh:** để ở chỗ thoáng, sau warm-up gõ `s` vài lần, đọc `[raw] … aq adc=…`. Đặt số đó vào
   `MQ135_CLEAN_ADC` trong `config.h` (mặc định 1200), nạp lại: không khí sạch → ~200 (NORMAL), ADC tối đa → 1000.
4. **Thử:** đưa gần bật lửa gas (không bật lửa) hoặc cồn → air quality tăng lên WARNING/DANGER; ra chỗ thoáng → giảm
   dần về NORMAL. Nếu cồn cũng không đẩy lên được 700 thì giảm `MQ135_CLEAN_ADC` hoặc chỉnh biến trở trên module.
