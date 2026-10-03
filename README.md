# Smart Room Digital Twin

Digital twin cho một phòng thông minh: **thiết bị ESP32-S3 (Wokwi hoặc mạch thật) ⇄ MQTT ⇄ backend ⇄ dashboard**.
Cảm biến (nhiệt độ, độ ẩm, ánh sáng, chất lượng không khí, chuyển động) → thiết bị tự quyết định trạng thái
(NORMAL / UNCOMFORTABLE / WARNING / DANGER) và điều khiển cửa sổ (servo), buzzer, LED, LCD → dashboard hiện
live và gửi lệnh ngược lại.

```
 ESP32-S3 (1 mạch)                Mosquitto        backend (Node/Fastify)        dashboard (Next.js)
 hoặc node ─UART─ gateway          :1883            :4000                         :3100
 hoặc fake-device
 ───────────────  telemetry/status/event/ack  ─────────────────  REST snapshot + SSE live  ─────────
                 ─────────────▶ broker ─────────▶  twin state    ─────────────────────────▶
                 ◀──────────── command (QoS 1) ◀─  commands      ◀──── POST /commands ──────
                                                   storage: memory | firestore
```

**Sơ đồ kiến trúc, bản đồ code, luồng tín hiệu: [`docs/architecture.md`](docs/architecture.md)** (đọc cái này trước).

Trạng thái (2026-09-30): luồng thiết bị → dashboard → lệnh ngược lại chạy end-to-end, cả 1 mạch lẫn 2 mạch
(node + gateway) trong Wokwi. Chưa làm: chạy 2 mạch thật (M3, đã có checklist), database/cloud (backend lưu
tạm trong RAM, đã chừa chỗ cho team cloud, xem [`docs/cloud.md`](docs/cloud.md)).

Dựng từ project `../smart-room`; số `§` trong code trỏ tới spec gốc:
[`docs/reference/aiot-smart-room-spec.md`](docs/reference/aiot-smart-room-spec.md).

## Mục lục

1. [Cài đặt công cụ](#1-cài-đặt-công-cụ)
2. [Lấy code và cài dependencies](#2-lấy-code-và-cài-dependencies)
3. [Chạy broker + backend + dashboard](#3-chạy-broker--backend--dashboard): [3.1 memory hay Firestore](#31-lưu-dữ-liệu-memory-mặc-định-hay-firestore)
4. [Chạy thiết bị](#4-chạy-thiết-bị): A. fake-device · B. 1 mạch Wokwi · C–E. 2 mạch Wokwi · F. mạch thật
5. [Kiểm tra](#5-kiểm-tra)
6. [Test](#6-test)
7. [Sự cố thường gặp](#7-sự-cố-thường-gặp)
8. [API backend](#8-api-backend)
9. [Cấu trúc thư mục](#9-cấu-trúc-thư-mục)

## 1. Cài đặt công cụ

| Công cụ | Phiên bản | Cần cho |
|---|---|---|
| [Git](https://git-scm.com/) | bất kỳ | lấy code (Windows: Git for Windows, có sẵn Git Bash) |
| [Node.js](https://nodejs.org/) | **24 LTS** | backend, dashboard, tool |
| pnpm | **10.x** | quản lý package (monorepo) |
| [Mosquitto](https://mosquitto.org/download/) | 2.x | MQTT broker |
| [VS Code](https://code.visualstudio.com/) | mới | firmware + simulator |
| Extension **PlatformIO IDE** | mới | build / nạp firmware (kèm PlatformIO Core) |
| Extension **Wokwi Simulator** | mới | chạy ESP32 ảo (cần license miễn phí) |
| MSYS2 UCRT64 gcc | tuỳ chọn | chỉ để chạy test firmware trên PC (`pio test -e native`) trên Windows |

### 1.1 Node.js + pnpm

Cài Node 24 LTS từ nodejs.org (hoặc `nvm install 24`), rồi bật pnpm qua corepack:

```sh
node -v                      # v24.x
corepack enable
corepack prepare pnpm@10.13.1 --activate
pnpm -v                      # 10.13.1
```

(Không dùng được corepack thì `npm i -g pnpm@10`.)

### 1.2 Mosquitto

- **Windows:** tải installer `mosquitto-2.x-install-windows-x64.exe` ở mosquitto.org, cài xong thêm
  `C:\Program Files\mosquitto` vào `PATH`. Installer có thể tạo **service Mosquitto** chạy sẵn trên cổng 1883
  với config mặc định: tắt nó đi (`services.msc` → Mosquitto Broker → Stop, Startup type = Manual), vì project
  chạy broker bằng config riêng trong `broker/`.
- **macOS:** `brew install mosquitto`. Homebrew đặt **daemon** `mosquitto` ở `sbin`, thường không có sẵn
  trong `PATH` (chỉ `mosquitto_sub` / `mosquitto_pub` nằm ở `bin`), nên `mosquitto -c ...` báo
  *command not found*. Thêm vào `~/.zshrc` rồi mở lại terminal:
  ```sh
  export PATH="/opt/homebrew/sbin:$PATH"   # Mac Intel: /usr/local/sbin
  ```
- **Ubuntu/Debian:** `sudo apt install mosquitto mosquitto-clients`, rồi `sudo systemctl disable --now mosquitto`
  (lý do như trên).

Kiểm tra: `mosquitto -h` in ra version 2.x; `mosquitto_sub` / `mosquitto_pub` có trong PATH.

### 1.3 VS Code + extensions

Mở file workspace `smart-room-digital-twin.code-workspace` (`File → Open Workspace from File…`): VS Code sẽ gợi ý
cài các extension được khuyên dùng. Hoặc cài tay trong tab Extensions (`Ctrl+Shift+X`):

| Extension | ID | Ghi chú |
|---|---|---|
| PlatformIO IDE | `platformio.platformio-ide` | lần đầu mở sẽ tự cài PlatformIO Core (Python riêng), đợi xong rồi **reload VS Code** |
| C/C++ | `ms-vscode.cpptools` | IntelliSense cho firmware (PlatformIO tự cài kèm) |
| Wokwi Simulator | `wokwi.wokwi-vscode` | simulator ESP32 |

Dòng lệnh tương đương:

```sh
code --install-extension platformio.platformio-ide
code --install-extension ms-vscode.cpptools
code --install-extension wokwi.wokwi-vscode
```

**Lệnh `pio`:** PlatformIO IDE không tự thêm `pio` vào PATH của terminal ngoài. Trong VS Code thì mở
*PlatformIO: New Terminal* (icon PlatformIO ở thanh bên → Quick Access → Miscellaneous → New Terminal), hoặc gọi
đường dẫn đầy đủ:

- Windows: `%USERPROFILE%\.platformio\penv\Scripts\pio.exe` (Git Bash: `~/.platformio/penv/Scripts/pio.exe`)
- macOS/Linux: `~/.platformio/penv/bin/pio`

Lần build đầu PlatformIO tải toolchain ESP32 + thư viện (vài trăm MB), mất vài phút.

**License Wokwi (miễn phí):** trong VS Code bấm `F1` → `Wokwi: Request a New License` → trình duyệt mở trang
Wokwi, đăng nhập, bấm lấy license → quay lại VS Code, license tự được kích hoạt. License free cần gia hạn định kỳ
(Wokwi sẽ nhắc; làm lại lệnh trên). Bản free đủ dùng cho project này, kể cả kết nối tới broker trên máy
(`host.wokwi.internal`, qua Private IoT Gateway có sẵn trong extension).

### 1.4 (Tuỳ chọn) gcc cho test firmware trên Windows

Chỉ cần nếu muốn chạy `pio test -e native` (test C++ của edge rules / protocol / link trên PC):

1. Cài [MSYS2](https://www.msys2.org/) vào `C:\msys64`.
2. Mở *MSYS2 UCRT64*, chạy `pacman -Sy --needed mingw-w64-ucrt-x86_64-gcc`.
3. Xong. `device/scripts/native_toolchain.py` tự đưa `C:\msys64\ucrt64\bin` lên đầu PATH khi test (cài chỗ khác
   thì đặt biến môi trường `MSYS2_UCRT64_BIN`).

macOS/Linux: chỉ cần `gcc`/`g++` có sẵn (Xcode Command Line Tools / `build-essential`).

## 2. Lấy code và cài dependencies

```sh
git clone <url-repo> smart-room-digital-twin
cd smart-room-digital-twin
pnpm install

cp server/.env.example server/.env                 # mặc định STORAGE_DRIVER=memory, broker 127.0.0.1:1883
cp dashboard/.env.example dashboard/.env.local     # dashboard gọi backend http://127.0.0.1:4000
```

Windows PowerShell dùng `copy` thay `cp`. Không cần sửa gì trong hai file env để chạy local.

## 3. Chạy broker + backend + dashboard

Mở **3 terminal** ở thư mục gốc repo:

```sh
# terminal 1: MQTT broker (chỉ nghe 127.0.0.1)
cd broker && mkdir -p mosquitto-data && mosquitto -c mosquitto.conf -v

# terminal 2: backend → http://127.0.0.1:4000
pnpm dev:server

# terminal 3: dashboard → http://localhost:3100
pnpm dev:dashboard
```

`mosquitto-data/` là thư mục `persistence_location` trong `mosquitto.conf`, được gitignore nên bản clone mới
chưa có. Thiếu nó broker vẫn chạy nhưng cứ 10 giây lại log `Error saving in-memory database` và **mất retained
status mỗi lần restart broker**. Chỉ cần tạo một lần (PowerShell: `mkdir mosquitto-data`).

Mở http://localhost:3100: dashboard hiện thiết bị `room-01` ở trạng thái **offline** cho tới khi có thiết bị chạy
(bước 4). Backend log `mqtt connected`; `curl -s 127.0.0.1:4000/health` trả `"mqtt":"connected"`.

### 3.1 Lưu dữ liệu: `memory` (mặc định) hay Firestore

Mặc định `STORAGE_DRIVER=memory`: mọi thứ nằm trong RAM, **mất hết khi restart backend**, nhưng chạy được
đầy đủ mọi tính năng và **không cần tài khoản Firebase nào**. Làm dashboard, firmware hay backend thì cứ
để nguyên — không phải xin quyền gì cả.

Chỉ khi muốn dữ liệu **sống sót qua restart** mới cần Firestore. Lúc đó nhờ chủ project thêm bạn làm member:

1. **Chủ project:** Firebase Console → ⚙️ *Project settings* → *Users and permissions* → *Add member*
   → email của bạn, role **Editor**.
2. **Bạn:** cùng trang đó → tab *Service accounts* → **Generate new private key**
   → lưu vào `cloud/firebase/service-account.json`.
3. `cp cloud/firebase/.firebaserc.example cloud/firebase/.firebaserc` → điền project id.
4. Trong `server/.env` (chép từ `server/.env.example` nếu chưa có):

   ```sh
   STORAGE_DRIVER=firestore
   GCP_PROJECT_ID=<project-id>
   GOOGLE_APPLICATION_CREDENTIALS=../cloud/firebase/service-account.json
   TELEMETRY_PERSIST_INTERVAL_SEC=15   # 5 (mặc định) sẽ đốt hạn mức miễn phí gấp 3 lần
   ```

5. `pnpm dev:server` (Node >= 24, §1.1), rồi kiểm tra:

   ```sh
   curl -s 127.0.0.1:4000/health      # -> "storage":{"driver":"firestore","ok":true}
   ```

Restart backend rồi mở lại dashboard: biểu đồ và nhật ký sự kiện vẫn còn — đó là thứ `memory` không làm được.

**Những chỗ dễ vấp:**

- **Key không tự có quyền.** *Generate new private key* chỉ tạo file, không cấp quyền. Service account
  `firebase-adminsdk-…` phải có role `Cloud Datastore User` (Console → IAM & Admin → IAM). Thiếu nó thì
  token hợp lệ nhưng **mọi** query trả `7 PERMISSION_DENIED`. Role này cấp **một lần cho cả project**, nên
  nếu người trước đã làm thì bạn không phải làm lại.
- **Cần Node >= 24**, chặt hơn phần còn lại của repo. `@google-cloud/firestore` là optional dependency
  của `firebase-admin` và pnpm **im lặng bỏ qua** nó trên Node 20 → `Cannot find module
  '@google-cloud/firestore'` lúc chạy. Sửa: đổi sang Node 24 rồi `pnpm install` **lại**.
- **`service-account.json` là private key**, đã gitignored. Nó bypass toàn bộ security rules, nên **đừng
  gửi qua chat** — mỗi người tự sinh key của mình ở bước 2. Xoá được từng key riêng trong
  Google Cloud Console → IAM → Service Accounts → *Manage keys* (lưu ý: mọi key đều thuộc cùng một service
  account, nên log không phân biệt được ai gọi).
- **Hạn mức miễn phí 20 000 writes/ngày, dùng chung cả team.** Một `fake-device` tốn ~270 writes/giờ, nên
  dùng bình thường thì thoải mái — nhưng **quên tắt qua đêm** là hết ~6 500. Ba cái bỏ quên là hôm sau
  demo gặp lỗi ghi. Nhớ Ctrl-C trước khi đóng máy.

**Test thì không cần quyền gì.** `pnpm --filter @srdt/server test:firestore` chạy trên **emulator** với
project id giả `srdt-contract-test` — không đăng nhập, không đụng dữ liệu thật, chỉ cần JDK >= 21.

Chi tiết mô hình dữ liệu, chi phí và các quyết định kỹ thuật: [`docs/cloud.md`](docs/cloud.md).

## 4. Chạy thiết bị

Chọn **một** trong các cách dưới. Backend và dashboard giữ nguyên ở mọi cách (sơ đồ ở
[`docs/architecture.md` §5](docs/architecture.md#5-các-cách-chạy-khi-dev-thay-phần-nào-bằng-đồ-giả)).

Các lệnh `pio` dưới đây chạy trong thư mục `device/` (hoặc thêm `-d device` nếu đứng ở gốc repo).

### A. Không cần Wokwi: fake-device (nhanh nhất)

```sh
pnpm --filter @srdt/server fake-device            # terminal 4
```

Trong terminal đó gõ `hot` / `smoke` / `calm` + Enter để đẩy giá trị lên WARNING/DANGER hoặc về NORMAL. Nút trên
dashboard (mở/đóng cửa, buzzer) được fake-device thực hiện và trả ack.

### B. 1 mạch ESP32 trong Wokwi

1. Build: `cd device && pio run -e esp32-s3` (hoặc trong VS Code: thanh trạng thái PlatformIO → chọn env
   `esp32-s3` → ✓ Build).
2. Mở **thư mục `device/`** làm workspace riêng trong VS Code (`code device`, hoặc `File → Open Folder…` → `device`):
   Wokwi tìm `wokwi.toml` ở gốc workspace.
3. `F1` → `Wokwi: Start Simulator`. Mạch có ESP32-S3, DHT22, LDR, biến trở (chất lượng không khí), PIR, nút,
   servo, buzzer, 3 LED, LCD 1602.
4. Sau ~5–10 s (Wi-Fi `Wokwi-GUEST` → MQTT `host.wokwi.internal:1883`) dashboard chuyển **online**.
5. Bấm vào cảm biến trong Wokwi để đổi giá trị (VD kéo nhiệt độ DHT22 lên 35 °C, hoặc biến trở > 900 → DANGER:
   LED đỏ, buzzer kêu, cửa mở), dashboard cập nhật trong ~2 s. Bấm *Open window* trên dashboard → servo quay.

Serial monitor của Wokwi là console: gõ `help` để xem lệnh (`s` in trạng thái, `open 45`, `close`, `buzz on`…).

### C–E. 2 mạch (node + gateway) trong Wokwi

Phương án 2 mạch: **node** có cảm biến + edge rules nhưng không Wi-Fi; **gateway** chỉ có Wi-Fi + MQTT và nối với
node qua UART1 (GPIO4 RX / GPIO5 TX). Chi tiết: [`docs/link-protocol.md`](docs/link-protocol.md).
Trong Wokwi, cổng serial duy nhất của mỗi mạch được nối vào dây link và mở ra PC qua TCP (RFC 2217); tool
`tools/link-sim` đứng ở đầu kia. Bản build `*-wokwi` chép console của mạch lên link, link-sim in lại thành
`node| …` / `gw| …`.

**C. Chỉ mạch node** (gateway giả):

```sh
cd device && pio run -e node-wokwi
# VS Code (mở thư mục device/): F1 → Wokwi: Select Config File → wokwi/node/wokwi.toml → F1 → Wokwi: Start Simulator
pnpm --filter @srdt/link-sim fake-gateway --link rfc2217:127.0.0.1:4002
```

stdin của fake-gateway: `open [1-90]`, `close`, `buzz on|off`, `clear`, `ping`, `mqtt down|up`, `stats`.

**D. Chỉ mạch gateway** (node giả):

```sh
cd device && pio run -e gateway-wokwi
# VS Code: Select Config File → wokwi/gateway/wokwi.toml → Start Simulator
pnpm --filter @srdt/link-sim fake-node --link rfc2217:127.0.0.1:4001
```

stdin của fake-node: `hot`, `smoke`, `calm`, `die [giây]`, `reboot`, `stats`. LED RGB của gateway trong Wokwi:
đỏ → vàng → xanh (Wi-Fi rồi MQTT lên), nháy khi mất node.

**E. Cả 2 mạch, nối với nhau** (không có đồ giả):

```sh
cd device && pio run -e node-wokwi && pio run -e gateway-wokwi
code -n device                   # window 1: Select Config File → wokwi/node/wokwi.toml → Start Simulator
code -n device/wokwi/gateway     # window 2: Start Simulator (wokwi.toml ở gốc)
pnpm --filter @srdt/link-sim splice        # nối 4002 (node) ⇄ 4001 (gateway), in cả node| … và gw| …
```

(Chạy các lệnh `code` và `pnpm` từ gốc repo.) stdin của splice: `cut 20` = rút dây link 20 s (sau 15 s dashboard
báo offline, nối lại → online), `stats`.

### F. Mạch thật

**1 mạch ESP32-S3 DevKitC-1** với đủ linh kiện như Wokwi: sơ đồ chân ở
[`docs/architecture.md` §4](docs/architecture.md#phần-cứng-mạch-node-giống-mạch-1-board-devicediagramjson). Firmware
`env:esp32-s3` đang để Wi-Fi/broker của Wokwi; đổi bằng `-D WIFI_SSID=…` trong `platformio.ini` nếu cần.

**Bộ kit ESP32 thường** (ESP-32S, DHT11, OLED, relay, nút thay biến trở): `env:kit` (1 mạch) hoặc `env:node-kit`
(mạch node). Sơ đồ chân và cách lắp ở [`docs/hardware-kit.md`](docs/hardware-kit.md).

**2 mạch thật (M3, chưa chạy thử):** làm theo checklist 7 bước ở
[`docs/link-protocol.md` §6.1](docs/link-protocol.md#61-uart-chạy-thật-2-mạch-chung-hộp). Tóm tắt:

```sh
# broker nghe cả LAN (cho phép qua Windows Firewall ở Private network), lấy IP PC bằng ipconfig
cd broker && mkdir -p mosquitto-data && mosquitto -c mosquitto-lan.conf -v

# Wi-Fi 2.4 GHz + IP broker cho gateway (file gitignored)
cp device/secrets.ini.example device/secrets.ini      # rồi sửa SSID, password, MQTT_HOST

# nạp qua cổng USB có chữ "UART" trên DevKitC-1 (không nạp bản *-wokwi)
cd device
pio run -e node -t upload --upload-port COMa
pio run -e gateway -t upload --upload-port COMb
pio device monitor -p COMb -b 115200                  # console gateway: stats | help
```

Nối dây: **GPIO5 node → GPIO4 gateway**, **GPIO4 node → GPIO5 gateway**, **GND ↔ GND**. LED gateway xanh đứng =
Wi-Fi + MQTT + node đều lên. Lưu ý phần cứng: servo cấp nguồn 5 V (không lấy 3V3 của board), LCD I2C 5 V cần
level shifter hoặc thử cấp 3.3 V, DHT22 cần pull-up ~10 kΩ nếu module không có sẵn, board DevKitC-1 v1.1 thì
LED RGB ở GPIO38 (`-D PIN_STATUS_RGB=38` trong `secrets.ini`).

Dev mạch thật một mình (chưa có mạch kia): nối adapter USB-UART vào GPIO4/5 + GND, rồi
`fake-gateway --link serial:COMx` (cho node) hoặc `fake-node --link serial:COMx` (cho gateway).

## 5. Kiểm tra

```sh
curl -s 127.0.0.1:4000/health                                  # mqtt, storage driver, số client SSE
curl -s 127.0.0.1:4000/api/devices/room-01                     # snapshot twin
curl -sN 127.0.0.1:4000/api/devices/room-01/stream             # SSE live (Ctrl+C để thoát)
curl -s -X POST 127.0.0.1:4000/api/devices/room-01/commands -H 'content-type: application/json' \
  -d '{"action":"OPEN_WINDOW","value":45,"source":"dashboard"}'  # 202 { commandId, status: "sent" }
mosquitto_sub -h 127.0.0.1 -t 'srdt/#' -v                      # xem toàn bộ MQTT
```

Kết quả mong đợi: telemetry mỗi 2 s trên `srdt/room-01/telemetry`, `status` retained, lệnh `OPEN_WINDOW` đi
`sent` → `executed` trong vài ms, dashboard hiện cửa 45°, nhãn "manual" và đếm ngược override 120 s.

## 6. Test

```sh
pnpm test                          # contracts (27) + server (20) + link-sim (23)
pnpm typecheck
pnpm build:dashboard               # static export ra dashboard/out
cd device && pio test -e native    # firmware C++ trên PC: edge rules, protocol, link (100), cần gcc (§1.4)
cd device && pio run -e esp32-s3 -e node -e gateway -e kit -e node-kit   # build đủ firmware
```

## 7. Sự cố thường gặp

| Triệu chứng | Nguyên nhân / cách sửa |
|---|---|
| macOS: `mosquitto: command not found` (nhưng `mosquitto_sub` chạy được) | daemon ở `sbin` chưa vào `PATH` (§1.2) |
| `mosquitto`: *Error saving in-memory database ... No such file or directory* | thiếu `broker/mosquitto-data/`: `mkdir -p mosquitto-data` (§3) |
| `mosquitto`: *Address already in use* | service Mosquitto cài sẵn đang chiếm 1883: tắt service (§1.2) |
| Backend không nối được broker trên Windows | dùng `mqtt://127.0.0.1:1883`, không dùng `localhost` (có thể ra `::1`) |
| `pio: command not found` | dùng PlatformIO terminal hoặc đường dẫn đầy đủ (§1.3) |
| Wokwi: *wokwi.toml not found* | mở **thư mục `device/`** làm workspace, hoặc `Wokwi: Select Config File` |
| Wokwi đòi license | `F1` → `Wokwi: Request a New License` |
| Wokwi chạy nhưng dashboard vẫn offline | broker chưa chạy, hoặc chạy sai config; xem serial monitor có `[mqtt] connected` không |
| link-sim: *ECONNREFUSED 127.0.0.1:4002/4001* | simulator chưa Start, hoặc chọn nhầm config (`wokwi/node` = 4002, `wokwi/gateway` = 4001) |
| Cổng 4000 bị chiếm | project khác đang dùng; đổi `PORT` trong `server/.env` và `NEXT_PUBLIC_API_BASE_URL` trong `dashboard/.env.local` |
| `pio test -e native` lỗi im lặng trên Windows | thiếu MSYS2 UCRT64 gcc (§1.4) |
| Mạch thật: LED gateway kẹt đỏ / vàng | đỏ = Wi-Fi (SSID, 2.4 GHz); vàng = broker (IP, firewall, `mosquitto-lan.conf`) |

## 8. API backend

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

## 9. Cấu trúc thư mục

Bản đồ chi tiết từng file: [`docs/architecture.md` §3](docs/architecture.md#3-bản-đồ-code).

| Thư mục | Nội dung | Trạng thái |
|---|---|---|
| `device/` | Firmware ESP32-S3 (PlatformIO + Wokwi). `env:esp32-s3` = 1 mạch; `env:node` = mạch cảm biến, uplink qua UART1; `env:gateway` = Wi-Fi + MQTT, bridge sang node; `*-wokwi` = bản cho simulator; `native` = test trên PC | ✅ Wokwi (1 mạch và 2 mạch); 🟡 2 mạch thật chưa chạy |
| `broker/` | Config Mosquitto: `mosquitto.conf` (local), `mosquitto-lan.conf` (cho mạch thật) | ✅ |
| `packages/contracts/` | `@srdt/contracts`: Zod schema MQTT + kiểu dữ liệu backend ⇄ dashboard | ✅ |
| `server/` | Backend: MQTT ingest, presence, command round trip, REST + SSE, `scripts/fake-device.ts` | ✅ |
| `server/src/storage/` | Interface storage + driver `memory` và `firestore` (Cloud Firestore) | ✅ cả hai chạy được |
| `tools/link-sim/` | fake-gateway / fake-node / splice cho phương án 2 mạch (serial, TCP, RFC 2217, MQTT tunnel) | ✅ |
| `dashboard/` | Next.js 16 static export: value cards, room twin (SVG), chart 15 phút, controls, events | ✅ nguồn `backend`; 🟡 nguồn `firestore` |
| `cloud/` | Firestore rules + indexes (đã deploy); Firebase Hosting / Dockerfile Cloud Run vẫn là mock | 🟡 một phần |
| `docs/` | [kiến trúc](docs/architecture.md), [link 2 mạch](docs/link-protocol.md), [cloud](docs/cloud.md), spec gốc | |

## Đã kiểm tra (2026-09-30)

- [x] `pnpm test` 58/58 (27 contracts + 8 server + 23 link-sim), `pnpm typecheck` sạch, `next build` OK;
      `pio test -e native` 100/100
- [x] Mosquitto + backend + fake-device: online, telemetry qua SSE mỗi 2 s, `OPEN_WINDOW 45` → `sent` → `executed` (~3 ms)
- [x] Dashboard (desktop + mobile 390 px, light/dark): twin hiện góc cửa 45°, buzzer on, nhãn "manual", đếm ngược override
- [x] `gateway-wokwi` + `fake-node`: HELLO, Wi-Fi, MQTT, NTP → TIME; `die 20` → node lost → offline → node up; tắt
      Mosquitto → backoff 1–16 s, reconnect đúng 1 lần; command từ dashboard → node `executed`
- [x] 2 mạch trong Wokwi (`node-wokwi` ⇄ `splice` ⇄ `gateway-wokwi`): dashboard online, telemetry từ cảm biến của
      node, mở/đóng cửa từ dashboard → servo quay; `cut 20` → offline sau 15 s, nối lại → online; đổi cảm biến →
      WARNING/DANGER lên dashboard
- [x] LED trạng thái gateway (WS2812 GPIO48): đỏ → vàng → xanh, nháy khi mất node
- [ ] 2 mạch thật (M3): chưa chạy, checklist ở [`docs/link-protocol.md` §6.1](docs/link-protocol.md#61-uart-chạy-thật-2-mạch-chung-hộp)
- [x] Firestore: xong, xem [`docs/cloud.md`](docs/cloud.md) §3
- [ ] Firebase Hosting / Cloud Run: chưa làm, xem [`docs/cloud.md`](docs/cloud.md) §4

## Việc tiếp theo gợi ý

1. M3: cắm UART giữa 2 mạch thật theo checklist ở `docs/link-protocol.md` §6.1.
2. Team cloud: deploy backend (Cloud Run) + dashboard (Firebase Hosting), xem `docs/cloud.md` §4.
3. Auth cho dashboard/API (Firebase Auth) trước khi public backend.
4. Broker có TLS + user/password khi rời máy local (HiveMQ Cloud / EMQX / Mosquitto trên VM).
5. Twin 3D (three.js) thay `RoomTwin.tsx`, dữ liệu vào giữ nguyên `TwinView`.
