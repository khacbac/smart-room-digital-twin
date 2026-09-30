# Link protocol: gateway ⇄ node (v0.2)

> **Trạng thái: v0.2, đã chốt ở M0 (2026-09-30).** Codec đã có trong
> [`device/lib/link/`](../device/lib/link/src) (test: `pio test -e native`), bản sao TS và 2 fake peer trong
> [`tools/link-sim/`](../tools/link-sim) (§6.2).
> v0.2: LINK_STATE mang `bootId` của node đã đăng ký và là heartbeat của gateway; gateway cấu hình sẵn `nodeId`.
> Các quyết định chốt ở M0 và lý do: §9.
> Đổi format frame = đổi `kVersion` + sửa lib + sửa test golden, trong **cùng một PR**.

## 1. Mục tiêu và phạm vi

Tách firmware hiện tại (1 ESP32-S3) thành 2 mạch:

| Mạch | Vai trò | Lấy từ code hiện tại |
|---|---|---|
| **Node** | Đọc cảm biến, edge rules, chấp hành tại chỗ (LED, RGB, servo, buzzer, LCD). **Tự chạy an toàn khi mất gateway.** | `sensors`, `actuators`, `display`, `lib/edge_rules`, `lib/protocol` (build payload + xử lý command) |
| **Gateway** | Wi-Fi, MQTT, NTP, cầu nối link ⇄ MQTT, presence của node, LED trạng thái (§5.5) | `net_task`, cấu hình MQTT/LWT |

Nguyên tắc:

1. **Backend và dashboard không phải sửa gì.** Gateway publish đúng topic `srdt/{deviceId}/…` và payload đúng
   `@srdt/contracts` như thiết bị hiện tại. `deviceId` là id của **node**, không phải của gateway.
2. **Node vẫn build payload MQTT (§5 spec) bằng `lib/protocol` như cũ.** Gateway chỉ chuyển nguyên
   byte, không parse hay sửa telemetry/status/event/ack. Mọi thay đổi schema vẫn chỉ nằm ở một chỗ.
3. **Edge rules nằm trên node.** Gateway chết thì node vẫn phát hiện DANGER, bật buzzer, mở cửa sổ.
4. **Không có ack ở tầng link.** Độ tin cậy của command đã có sẵn ở tầng trên: `commandId` + dedup trên node,
   timeout 10 s trên backend. Telemetry mất một frame không sao vì 2 s sau có frame mới.

Ngoài phạm vi v0.2: nhiều node trên một gateway (§9), ESP-NOW (§6.4), OTA qua link.

## 2. Các lớp

```
 node                                                      gateway
 ┌───────────────────────────┐                             ┌──────────────────────────────┐
 │ edge rules, lib/protocol  │  JSON §5 (y như MQTT hiện tại) │ bridge: type → topic, QoS    │
 ├───────────────────────────┤                             ├──────────────────────────────┤
 │ lib/link: frame + CRC     │ ◀── frame (§3) ───────────▶ │ lib/link: frame + CRC        │
 ├───────────────────────────┤                             ├──────────────────────────────┤
 │ transport (§6)            │  UART │ USB serial │ MQTT tunnel │ transport (§6)          │
 └───────────────────────────┘                             └──────────────────────────────┘
```

Code ứng dụng chỉ gọi `send(type, payload)` và nhận `onFrame(frame)`. Transport có thể thay mà không đụng logic.

## 3. Frame

### 3.1 Raw frame

```
 byte:  0         1       2      3 … 3+len-1     3+len   4+len
      ┌─────────┬──────┬──────┬───────────────┬────────┬────────┐
      │ version │ type │ seq  │ payload       │ crc lo │ crc hi │
      └─────────┴──────┴──────┴───────────────┴────────┴────────┘
```

| Trường | Kích thước | Ghi chú |
|---|---|---|
| `version` | 1 | `0x01`. Khác version thì bên nhận **bỏ frame** (`BAD_VERSION`) |
| `type` | 1 | §4. Bit 7 = hướng: `0` node → gateway, `1` gateway → node |
| `seq` | 1 | Mỗi bên tự đếm, tăng 1 mỗi frame gửi đi, 255 → 0. Chỉ dùng để thống kê mất frame, **không** dùng để dedup |
| `payload` | 0 … 1024 | `LINK_PAYLOAD_MAX` = `MQTT_PAYLOAD_MAX`. Không có trường độ dài: độ dài = tổng − 5 |
| `crc` | 2, little endian | CRC-16/CCITT-FALSE (poly `0x1021`, init `0xFFFF`, không reflect, không xor) trên byte 0 … 3+len−1. Kiểm tra: `"123456789"` → `0x29B1` |

Thứ tự kiểm tra khi nhận: độ dài ≥ 5 → ≤ 1029 → CRC → version → type đã biết. Trượt bước nào thì bỏ frame
và tăng bộ đếm lỗi, **không trả lời**.

### 3.2 Stream frame (UART, USB serial)

```
 COBS(raw frame) 0x00
```

- [COBS](https://en.wikipedia.org/wiki/Consistent_Overhead_Byte_Stuffing) đảm bảo byte `0x00` không xuất hiện
  bên trong frame. Vì vậy `0x00` là dấu kết thúc duy nhất: nhiễu hoặc nửa frame chỉ làm hỏng **một** frame,
  bên nhận tự đồng bộ lại ở `0x00` tiếp theo (`StreamDecoder`).
- Overhead tối đa là 1 byte cho mỗi 254 byte, cộng 1 byte đầu và 1 byte delimiter. Frame lớn nhất: 1029 → 1035 byte.
- Được phép gửi thêm `0x00` rảnh (ví dụ ngay sau boot để xả rác trên đường truyền). Bên nhận bỏ qua.
- Vì sao không dùng "byte START + length": nếu byte length bị hỏng, bên nhận có thể đọc lệch rất nhiều frame.
  COBS không bị vấn đề này.

### 3.3 MQTT tunnel

Payload MQTT = **raw frame** (§3.1), không COBS, không `0x00`, vì MQTT đã tự tách message.

### 3.4 Vector mẫu

Dùng để kiểm tra mọi bản cài đặt khác (fake peer trên PC bằng Node/Python). Đã có trong `test/test_link`.

| Frame | Raw | Stream (wire) |
|---|---|---|
| HEARTBEAT, seq 7 | `01 06 07 ED 21` | `06 01 06 07 ED 21 00` |
| COMMAND, seq 0, payload `{"a":1}` | `01 81 00 7B 22 61 22 3A 31 7D BA 59` | `03 01 81 0A 7B 22 61 22 3A 31 7D BA 59 00` |

## 4. Loại message

### 4.1 Bảng type

| Type | Tên | Hướng | Payload | Gateway làm gì |
|---|---|---|---|---|
| `0x01` | TELEMETRY | N → G | `Telemetry` JSON (§5.3 spec) | publish `srdt/{id}/telemetry`, QoS 0 |
| `0x02` | STATUS | N → G | `StatusOnline` JSON (§5.4) | publish `srdt/{id}/status`, QoS 1, **retained** |
| `0x03` | EVENT | N → G | `DeviceEvent` JSON (§5.5) | publish `srdt/{id}/event`, QoS 0 |
| `0x04` | ACK | N → G | `CommandAck` JSON (§5.7) | publish `srdt/{id}/command/ack`, QoS 0 |
| `0x05` | HELLO | N → G | `{"deviceId","bootId","fw"}` | đăng ký node nếu `deviceId` = `nodeId` đã cấu hình (§5.2) |
| `0x06` | HEARTBEAT | N → G | rỗng | chỉ cập nhật presence |
| `0x81` | COMMAND | G → N | raw payload nhận từ `srdt/{id}/command` | — |
| `0x82` | TIME | G → N | `{"ts": <epoch ms UTC>}` | — |
| `0x83` | LINK_STATE | G → N | `{"mqtt": bool, "rssi"?: int, "bootId"?: str}` | — (cũng là heartbeat của gateway) |
| `0x84` | HELLO_REQUEST | G → N | rỗng | — |

`{id}` = `nodeId` **cấu hình sẵn** trên gateway (giống `DEVICE_ID` trong `config.h`). Gateway cần biết nó trước khi
có HELLO, vì LWT phải đặt lúc kết nối MQTT (§5.3). HELLO có `deviceId` khác thì bị bỏ.

**Mọi frame** hợp lệ đều tính là "còn sống", không riêng HEARTBEAT. Presence được theo dõi ở cả hai chiều: gateway
theo dõi node, node theo dõi gateway.

### 4.2 JSON riêng của link

Builder và parser nằm trong `link_messages.h`, cả 2 bên dùng chung nên format không thể lệch.

```jsonc
// HELLO: deviceId ^[a-z0-9-]{3,32}$, bootId ^[0-9a-f]{8}$ (giống contracts), fw 1–32 ký tự
{"deviceId":"room-01","bootId":"a1b2c3d4","fw":"0.2.0"}

// TIME
{"ts":1790591200123}

// LINK_STATE: rssi là RSSI Wi-Fi của gateway (bỏ trường khi chưa có Wi-Fi),
// bootId là node gateway đã đăng ký từ HELLO (bỏ trường khi chưa có HELLO)
{"mqtt":true,"rssi":-61,"bootId":"a1b2c3d4"}
```

### 4.3 Thay đổi trên node so với firmware hiện tại

- `meta()` trong `main.cpp` đang lấy giờ từ NTP. Trên node: khi nhận TIME, gọi `settimeofday()` rồi coi như
  "đã sync". Phần còn lại của `meta()` giữ nguyên.
- `rssi` trong status: lấy từ LINK_STATE gần nhất (node không có Wi-Fi).
- Các chỗ `if (net::online())` đổi thành **`mqttUp`** = gateway up (`PeerMonitor`) **và** `LINK_STATE.mqtt`
  **và** `LINK_STATE.bootId == bootId của mình`. Khi `mqttUp` sai thì node chỉ gửi HELLO/HEARTBEAT, không gửi
  telemetry/event, giống hành vi hiện tại (không đẩy dữ liệu cũ khi mạng hồi).
- Nhận LINK_STATE có `bootId` khác của mình (HELLO bị mất, hoặc gateway vừa khởi động lại) → gửi HELLO, tối đa 1 lần/giây.
- **Status còn nợ:** đặt cờ khi boot, khi gửi HELLO, và mỗi khi `mqttUp` chuyển sang sai. Ngay khi `mqttUp` đúng
  thì gửi STATUS (và BOOT nếu chưa gửi lần nào trong lần boot này).
- Không cần LWT trên node, gateway lo phần đó (§5.3).

## 5. Các luồng

### 5.1 Uplink (node → MQTT)

```
node: build JSON (lib/protocol) → encodeStream(TELEMETRY, seq, json) → UART
gateway: StreamDecoder → type → topic/QoS/retain (§4.1) → mqtt.publish(payload nguyên byte)
```

Gateway **bỏ** frame uplink khi chưa có HELLO kể từ lúc gateway khởi động, hoặc khi MQTT đang mất (không buffer,
giống `net_task` hiện tại). Khi bỏ frame vì chưa có HELLO, gateway gửi HELLO_REQUEST, tối đa 1 lần/giây.

### 5.2 Khởi động và đăng ký

```
node boot ──HELLO──▶ gateway          gateway: kiểm tra deviceId, nhớ bootId, PeerMonitor.resetSeq()
          ◀─TIME──────                gửi TRƯỚC, để STATUS/BOOT ngay sau đó đã có ts
          ◀─LINK_STATE─               {mqtt, rssi, bootId = của node này}
          ──STATUS───▶ (retained)     node thấy mqttUp đúng → trả status còn nợ
          ──EVENT BOOT▶               như firmware hiện tại

HELLO bị mất (vd. node gửi trước khi đường truyền sẵn sàng):
gateway ──LINK_STATE (không có bootId)──▶ node ──HELLO──▶ …như trên
node gửi dữ liệu trước HELLO ──▶ gateway bỏ frame + HELLO_REQUEST ──▶ node ──HELLO──▶ …

gateway boot ──HELLO_REQUEST──▶ node  node trả HELLO → STATUS, KHÔNG gửi lại BOOT
```

Gateway gửi LINK_STATE khi trạng thái MQTT đổi, ngay sau HELLO, và **mỗi khi đã 5 s không gửi frame nào**
(heartbeat của gateway). Gateway gửi lại TIME mỗi 10 phút (`LINK_TIME_RESYNC_MS`). Khi NTP chưa sync, gateway
**không** gửi TIME (LINK_STATE vẫn gửi bình thường), và gửi ngay ở `tick()` đầu tiên sau khi NTP sync. Trong lúc đó
payload của node không có `ts`, giống bản 1 mạch khi chưa có NTP.

Sau khi gateway khởi động lại, node có thể gửi thêm 1–2 telemetry trước khi nhận ra, vì LINK_STATE cũ vẫn mang
đúng `bootId` của nó. Gateway bỏ các frame đó rồi gửi HELLO_REQUEST. Telemetry mất một frame là chấp nhận được.

### 5.3 Presence

| Tình huống | Ai phát hiện | Kết quả trên MQTT |
|---|---|---|
| Gateway chết hoặc mất Wi-Fi | Broker (LWT của gateway) | LWT đặt trên `srdt/{nodeId}/status` = `{"v":1,"deviceId":"<nodeId>","online":false}`, retained |
| Node chết hoặc đứt dây | Gateway: `PeerMonitor` không nhận frame nào trong 15 s | Gateway **tự publish** đúng payload offline đó, QoS 1, retained |
| Node sống lại | Frame đầu tiên (thường là HELLO) → `PeerChange::Up` | Node gửi STATUS `online:true` → backend thấy DEVICE_ONLINE |
| Gateway kết nối lại MQTT | Gateway | Nếu node đang down thì publish lại offline (LWT có thể đã ghi đè); LINK_STATE `mqtt:true` → node gửi STATUS |
| Node mất gateway | Node: `PeerMonitor` 15 s không nhận LINK_STATE/frame nào | Không publish được gì; node tiếp tục chạy edge rules, LCD báo offline |

- Node gửi HEARTBEAT khi đã 5 s không gửi frame nào (`TxTracker::heartbeatDue`). Telemetry mỗi 2 s nên bình thường
  HEARTBEAT gần như không xuất hiện; nó chỉ có tác dụng khi node không có gì để gửi (ví dụ MQTT down).
- LWT chỉ đặt được **một** topic cho mỗi kết nối MQTT, nên thiết kế này chỉ đúng với **1 node / gateway** (§9).
- Backend hiện coi device offline sau 45 s không có dữ liệu. 15 s của link nhỏ hơn nhiều nên không xung đột.

### 5.4 Command (downlink)

```
backend ──MQTT QoS1──▶ gateway: topic srdt/{nodeId}/command
  gateway: node up? ── không → bỏ (backend đã thấy offline nên thường trả 409 từ trước)
           payload ≤ 1024? ── không → bỏ + log
  gateway ──COMMAND(raw payload)──▶ node
  node: proto::CommandHandler::handle() (validate, dedup theo commandId, execute) ← code hiện tại
  node ──STATUS (nếu executed)──▶ ──ACK──▶ gateway ──MQTT──▶ backend
  không có ACK sau 10 s → backend tự timeout (COMMAND_TIMEOUT), link không retry
```

Gateway **không** validate nội dung command. Node đã làm việc đó, và làm hai lần thì dễ lệch nhau.

Broker gửi lại QoS 1 thì node nhận lại cùng `commandId`. `CommandHandler` trả lại ack cũ, không chạy lại lệnh.

### 5.5 LED trạng thái của gateway

Gateway không có màn hình, nên dùng **LED RGB onboard** (WS2812) của ESP32-S3 DevKitC-1: cắm mạch thật là biết
ngay đứt ở chặng nào. Chân: GPIO48 trên board v1.0, GPIO38 trên v1.1; đặt bằng `-D PIN_STATUS_RGB`
(core 2.x: `neopixelWrite()`). Độ sáng thấp.

| LED | Nghĩa |
|---|---|
| Đỏ | Chưa có Wi-Fi |
| Vàng | Có Wi-Fi, chưa có MQTT (hoặc đang backoff) |
| Xanh lá | MQTT up và node up |
| Nháy (màu như trên, 1 Hz) | Mất node: `PeerMonitor` 15 s không nhận frame nào (§5.3), hoặc chưa có HELLO |

LED chỉ đọc trạng thái mà `net_task` và `GatewayLink` đã có sẵn, không thêm logic link: `device/src/gateway/status_led.cpp`,
mặc định GPIO48 (v1.0). Wi-Fi = `net::rssi() != 0`. Trong Wokwi, `device/wokwi/gateway/diagram.json` có một WS2812 rời
trên GPIO48.

## 6. Transport

### 6.1 UART (chạy thật, 2 mạch chung hộp)

- 115200 baud, 8N1, không flow control. Frame lớn nhất (1035 byte) mất khoảng 90 ms; telemetry vài trăm byte mỗi 2 s,
  chỉ dùng vài phần trăm băng thông.
- Nối chéo TX ↔ RX, **chung GND**, cả 2 đều 3.3 V. Dây dài hơn ~1 m thì cân nhắc RS485.
- Dùng **UART1/UART2** cho link, **không** dùng USB serial (`Serial`), vì USB serial đang dành cho log và
  lệnh debug. Node (`env:node`): **UART1, RX = GPIO4, TX = GPIO5** (`PIN_LINK_RX/TX` trong `include/config.h`,
  đổi được bằng `-D`). Gateway (`env:gateway`) dùng **cùng chân** đó, nối chéo: TX node → RX gateway và ngược lại.
- Node đọc UART **không chặn** trong `loop()` (đọc hết `available()` mỗi vòng, đẩy vào `StreamDecoder`). Buffer
  UART 2 KB mỗi chiều, lớn hơn một frame lớn nhất, nên gửi một frame cũng không phải chờ.

### 6.2 USB serial tới PC (mỗi người dev một mình)

Script trên PC đóng vai mạch kia, nói đúng stream frame (§3.2) qua một **adapter USB-UART** (CP2102/CH340)
cắm vào đúng chân UART link. Nhờ vậy firmware không cần một build riêng cho dev.

Các script nằm trong [`tools/link-sim/`](../tools/link-sim). Logic của chúng (`src/gateway.ts`, `src/node.ts`) làm đúng
§4–§5, nên cũng là bản tham chiếu khi viết firmware.

| Script | Dành cho | Làm gì |
|---|---|---|
| `fake-gateway` | người làm **node** | Nói link trên `--link`, bridge sang broker thật (backend + dashboard chạy như thường). `--mqtt none` thì chỉ in ra những gì sẽ publish. stdin: `open [1-90]`, `close`, `buzz on\|off`, `clear`, `ping` (gửi COMMAND thẳng xuống node, ack không publish), `mqtt down\|up` (giả mất broker), `stats` |
| `fake-node` | người làm **gateway** | HELLO, telemetry/status/event từ phòng giả lập (cùng mô hình với `server/scripts/fake-device.ts`), thực thi và ack command. stdin: `hot`, `smoke`, `calm`, `die [sec]` (im lặng để test presence), `reboot`, `stats` |
| `splice` | cả hai | Không giả mạch nào: nối **2 mạch thật** (`--node`, `--gateway`, mặc định 2 cổng Wokwi 4002/4001), chuyển nguyên frame giữa hai bên, in console `node\| …` / `gw\| …`. stdin: `cut [sec]` (rút dây, cả 2 bên phải báo mất nhau sau 15 s), `stats` |

```sh
# Không cần phần cứng: cả chuỗi trên PC (broker + backend đang chạy như README)
pnpm --filter @srdt/link-sim fake-gateway        # tcp-listen:7000 ⇄ mqtt://127.0.0.1:1883
pnpm --filter @srdt/link-sim fake-node           # tcp:127.0.0.1:7000

# Người làm node: mạch node cắm qua adapter USB-UART
pnpm --filter @srdt/link-sim fake-gateway --link serial:COM5
# Người làm gateway: mạch gateway cắm qua adapter USB-UART
pnpm --filter @srdt/link-sim fake-node --link serial:COM6
```

`--link` nhận `serial:COM5[@115200]`, `tcp-listen:[host:]port`, `tcp:host:port`, `rfc2217:host:port` (Wokwi, bên dưới),
`tunnel:<mqtt url>` (§6.3).
Tham số khác: `--node room-01`, `--mqtt`, `--prefix`, `-v` (in cả telemetry/heartbeat). Có thể dùng env `DEVICE_ID`,
`MQTT_URL`, `MQTT_TOPIC_PREFIX` như `server/.env`.

**Node trong Wokwi, không cần mạch** ([`device/wokwi/node/`](../device/wokwi/node)): cùng linh kiện với
`device/diagram.json`, nhưng `$serialMonitor` nối vào **UART link (GPIO4/5)** thay cho UART0, và `rfc2217ServerPort = 4002` (4000 là cổng backend)
đưa cổng đó ra TCP. fake-gateway đóng vai gateway:

```sh
cd device && pio run -e node-wokwi
# VS Code: F1 → "Wokwi: Select Config File" → device/wokwi/node/wokwi.toml, rồi "Wokwi: Start Simulator"
pnpm --filter @srdt/link-sim fake-gateway --link rfc2217:127.0.0.1:4002
```

- RFC 2217 là telnet: byte 0xFF đi thành `IAC IAC`, và server gửi thêm lệnh negotiation. Frame COBS có thể chứa 0xFF
  (CRC, payload), nên `tcp:` thuần sẽ làm hỏng frame. `rfc2217:` xin chế độ BINARY, escape 0xFF khi gửi, và bỏ lệnh telnet
  khi nhận (`TelnetFilter` trong `src/transport.ts`). Nó không đặt baud qua COM-PORT-OPTION, vì Wokwi không cần.
- Wokwi chỉ có **một** serial monitor, và ở đây nó dùng cho link. Vì vậy env `node-wokwi` / `gateway-wokwi` (= `node` /
  `gateway` + `-D LINK_CONSOLE_TEE`, `src/console_tee.cpp`) chép mọi thứ in ra console (UART0) sang UART link, mỗi lần
  ghi là một chunk riêng kết thúc bằng 0x00. link-sim nhận ra chunk là text (frame luôn có byte version 0x01, không phải
  text) và in thành dòng `node| …` / `gw| …`. Peer thật sẽ bỏ chunk đó như frame hỏng (§3.2), nên **không nạp bản
  `*-wokwi` cho mạch thật**. Panic dump đi qua ROM nên không được chép; lần boot sau in `reset=` (PANIC, TASK_WDT…).
  Vẫn không gõ được lệnh console.
- Tab simulator phải đang hiện trong VS Code, không thì Wokwi tạm dừng. Khi đó fake-gateway báo node timeout sau 15 s.
- fake-gateway nối trước hay sau khi simulator chạy đều được, vì `tcp`/`rfc2217` tự nối lại mỗi 1 s. Nếu node đã boot
  xong mà HELLO bị mất, LINK_STATE không có bootId sẽ làm node gửi lại HELLO (§5.2).

**Gateway trong Wokwi** ([`device/wokwi/gateway/`](../device/wokwi/gateway)): chỉ có board, `$serialMonitor` trên GPIO4/5,
RFC 2217 ở cổng **4001**. Wi-Fi và MQTT đi như bản 1 mạch (Wokwi-GUEST → `host.wokwi.internal`, broker trên máy).
fake-node đóng vai node:

```sh
cd device && pio run -e gateway-wokwi
# VS Code: F1 → "Wokwi: Select Config File" → device/wokwi/gateway/wokwi.toml, rồi "Wokwi: Start Simulator"
pnpm --filter @srdt/link-sim fake-node --link rfc2217:127.0.0.1:4001
```

Console của gateway hiện trong log fake-node dưới dạng `gw| …` (`[boot] … reset=`, `[wifi]`, `[mqtt]`, `[link]`). Ngoài
ra theo dõi qua backend và dashboard (node lên online, telemetry chạy, command từ dashboard có ack). Nếu fake-node không
in `mqtt path up`, gateway chưa tới được broker: xem dòng `gw| [mqtt] …`.

**Hai mạch trong Wokwi, nối với nhau**: firmware thật ở cả hai đầu, cảm biến ảo của node đi tới dashboard. Mỗi
VS Code window chỉ chạy một simulator, nên cần 2 window, và cả hai phải đang hiện (không thu nhỏ), không thì Wokwi tạm dừng:

```sh
cd device && pio run -e node-wokwi && pio run -e gateway-wokwi
# Window 1 (thư mục repo): "Wokwi: Select Config File" → device/wokwi/node/wokwi.toml, "Wokwi: Start Simulator"
# Window 2: code -n device/wokwi/gateway (thư mục khác window 1; wokwi.toml ở gốc nên chỉ cần "Wokwi: Start Simulator")
pnpm --filter @srdt/link-sim splice     # rfc2217:127.0.0.1:4002 (node) ⇄ rfc2217:127.0.0.1:4001 (gateway)
```

- splice decode rồi encode lại từng frame: frame hợp lệ tới bên kia y nguyên byte, nhiễu và frame hỏng dừng ở đây.
  Không có `-v` thì chỉ in các frame không định kỳ (HELLO, HELLO_REQUEST, TIME, STATUS, EVENT, COMMAND, ACK).
- `--node` / `--gateway` nhận mọi spec như `--link`, ví dụ `--node serial:COM5` nối mạch node thật (qua USB-UART) với
  gateway trong Wokwi.
- Mỗi simulator chạy theo đồng hồ riêng và có thể chậm hơn giờ thật. Timeout 15 s vẫn dư, nhưng đừng đo độ trễ ở đây.

### 6.3 MQTT tunnel (chỉ có trong link-sim)

Hai mạch thật ở 2 nơi, cùng kết nối Wi-Fi tới một broker cloud (HiveMQ Cloud / EMQX Serverless, có TLS + user).

| Topic | Hướng | Payload |
|---|---|---|
| `srdt-link/{nodeId}/up` | node → gateway | raw frame (§3.3), QoS 0 |
| `srdt-link/{nodeId}/down` | gateway → node | raw frame, QoS 0 |

- Prefix `srdt-link/` **khác hẳn** `srdt/`, để backend không bao giờ nhìn thấy frame link.
- **Firmware không có transport này** (đã bỏ mốc M2, §9 câu 6): test tích hợp 2 mạch dùng `splice` + 2 simulator
  (§6.2). Transport `tunnel:` vẫn còn trong `tools/link-sim`, ví dụ để nối fake peer của 2 người qua broker cloud.
- Độ trễ qua Internet khoảng 50–300 ms, vẫn thoải mái so với timeout command 10 s. Đừng dùng tunnel để đo hiệu năng.

### 6.4 ESP-NOW (ngoài phạm vi v0.2)

Arduino core 2.x (D13) dựa trên ESP-IDF 4.4, nên mỗi gói ESP-NOW tối đa **250 byte**. Telemetry/status JSON dài hơn
mức đó, nên cần một trong hai cách: chia nhỏ frame, hoặc payload binary gọn. Để lại cho bản sau nếu thật sự cần node không dây.

## 7. Tổ chức code

```
device/
  lib/link/src/
    link_frame.h/.cpp     frame, CRC-16, COBS, StreamDecoder              ✅ có test
    link_peer.h/.cpp      TxTracker (seq, heartbeat), PeerMonitor (presence) ✅ có test
    link_messages.h/.cpp  HELLO / TIME / LINK_STATE (ArduinoJson)          ✅ có test
    link_node.h/.cpp      NodeLink: đăng ký, mqttUp, status còn nợ (§4.3)  ✅ có test
    link_gateway.h/.cpp   GatewayLink: HELLO → TIME + LINK_STATE, route lên MQTT, offline, command ✅ có test
  test/test_link/         22 test, gồm các vector mẫu ở §3.4
  test/test_link_node/    10 test, cùng kịch bản với tools/link-sim/test/bridge.test.ts
  test/test_link_gateway/ 18 test: 13 cho GatewayLink, 5 nối NodeLink ⇄ GatewayLink qua stream codec
  src/net.h               uplink mà main.cpp thấy: publish(Channel), popCommand, online …
  src/net_task.cpp        env:esp32-s3 (1 mạch) và env:gateway: Wi-Fi + NTP + MQTT như trước, không sửa
  src/net_link.cpp        env:node: NodeLink + UART1, TIME → settimeofday, COMMAND → hàng đợi
  src/gateway/main.cpp    env:gateway: UART1 ⇄ GatewayLink ⇄ net_task, console `stats`; không cảm biến, không main.cpp
  src/console_tee.cpp     chỉ env *-wokwi: chép console (UART0) sang UART link để link-sim in ra (§6.2)
  wokwi/node/             wokwi.toml + diagram.json cho env:node-wokwi, UART link ra RFC 2217 :4002 (§6.2)
  wokwi/gateway/          như trên cho env:gateway-wokwi (chỉ có board), RFC 2217 :4001
tools/link-sim/           @srdt/link-sim
  src/frame.ts, peer.ts, messages.ts   bản sao TS của lib/link (cùng vector mẫu)
  src/gateway.ts, node.ts              logic §4–§5, test được với đồng hồ giả
  src/transport.ts                     serial / tcp / rfc2217 / tunnel / memory
  src/splice.ts                        dây nối 2 mạch thật (script splice)
  scripts/fake-gateway.ts, fake-node.ts, splice.ts
  test/                                codec + node ⇄ gateway (payload phải qua contracts)
```

- `lib/link` là C++ thuần: không `Arduino.h`, không heap. Buffer `StreamDecoder` khoảng 2.1 KB; `encodeStream` dùng khoảng 1 KB stack.
- Namespace là `lnk`, vì `link` trùng với hàm POSIX `link()`.
- Firmware node **dùng chung** `main.cpp`, `sensors`, `actuators`, `display`, edge rules với bản 1 mạch. Chỉ khác
  uplink: `build_src_filter` chọn `net_link.cpp` thay cho `net_task.cpp`. Sửa rule hay payload thì cả 2 bản cùng có.
- Hằng số chỉnh bằng `-D`: `LINK_PAYLOAD_MAX` (1024), `LINK_HEARTBEAT_MS` (5000), `LINK_PEER_TIMEOUT_MS` (15000).

## 8. Quy trình làm việc 2 người

- Sửa `lib/link` hoặc tài liệu này: làm PR, **người kia review**, sửa **cả** `tools/link-sim` cho khớp;
  `pio test -e native` và `pnpm --filter @srdt/link-sim test` phải xanh.
- Sửa schema MQTT (§5 spec): làm như hiện tại, sửa `packages/contracts` + `lib/protocol`. Gateway không bị ảnh hưởng.
- Mốc: ~~M0 chốt tài liệu này~~ (2026-09-30) → M1 mỗi người chạy với fake peer, rồi 2 firmware với nhau qua
  `splice` (§6.2) → M3 gặp nhau một lần để cắm UART thật. M2 (MQTT tunnel) đã bỏ.

## 9. Quyết định (chốt ở M0, 2026-09-30)

1. **Một node trên một gateway.** Nhiều node cần địa chỉ node trong frame (UART chung → RS485), topic `status` riêng
   cho gateway, và LWT không còn đủ (§5.3): gần như làm lại protocol, cho thứ một phòng chưa cần.
2. **Không có ack ở tầng link cho COMMAND.** UART ngắn gần như không mất frame; đứt link thì backend đã thấy offline
   (`cut 20` qua `splice`), còn command mất thì backend tự timeout sau 10 s. Retry ở link sẽ chồng lên tầng đó.
3. **Gửi lại TIME mỗi 10 phút; sai giờ chấp nhận được < 1 s.** Đồng hồ ESP32 lệch cỡ vài chục ppm, tức dưới 0.1 s
   trong 10 phút; biểu đồ 15 phút không cần chính xác hơn.
4. **UART1, GPIO4 (RX) / GPIO5 (TX), 115200 8N1, không RTS/CTS.** Frame lớn nhất ~90 ms, buffer UART 2 KB lớn hơn
   một frame (§6.1).
5. **Một thư mục `device/`, `env:node` / `env:gateway` + `build_src_filter`** (§7). Cả 2 env đã chạy với nhau trong
   Wokwi qua `splice`.
6. **Bỏ M2 (MQTT tunnel trong firmware).** `splice` + 2 simulator đã test tích hợp 2 firmware trên một máy (§6.2);
   `tunnel:` chỉ còn trong link-sim (§6.3).
7. **Gateway có LED RGB onboard** báo Wi-Fi / MQTT / node (§5.5).

Ngoài phạm vi v0.2: ESP-NOW (§6.4), OTA qua link. Đổi các điểm trên = sửa tài liệu này theo quy trình §8.
