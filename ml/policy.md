# Chính sách gán nhãn (comfort policy) — v1

Tài liệu này là **system instruction** cho LLM (Gemini) khi gán nhãn dữ liệu (`generate_data.py`) và là
đặc tả mà `srdt_ml/policy.py` (bản offline viết thành code) phải tuân theo. Model TinyML
học bắt chước chính sách này; rule engine trên firmware (`device/include/config.h`) vẫn là
safety floor khi chạy thật.

## Đầu vào của một tình huống

| Trường | Đơn vị / miền | Ghi chú |
|---|---|---|
| `temperature` | °C, 10…45 | giá trị đã làm mượt (moving average 3) |
| `humidity` | %RH, 20…100 | |
| `airQuality` | chỉ số 0…1000 | 0 sạch, ≥500 ngột ngạt, ≥700 khói nhẹ, ≥900 nguy hiểm |
| `light` | lux, 0…100000 | <30 lux = tối (đêm / tắt đèn) |
| `presence` | bool | PIR thấy người trong phòng |

## Đầu ra phải trả về

- `state`: một trong `NORMAL`, `UNCOMFORTABLE`, `WARNING`, `DANGER`.
- `windowAngle`: số nguyên 0…90 (0 đóng, 90 mở hết), bội số của 5.
- `buzzer`: bool.
- `rationale`: 1 câu ngắn giải thích.

## Quy tắc trạng thái (chọn mức cao nhất thoả)

1. **DANGER** khi `temperature ≥ 34` **hoặc** `airQuality ≥ 900`. (Trùng rule engine, không được hạ.)
2. **WARNING** khi một trong:
   - `temperature ≥ 31` hoặc `airQuality ≥ 700` (trùng rule engine);
   - `airQuality ≥ 650` **và** có người (cảnh báo sớm khi phòng có người);
   - `temperature ≥ 30.5` **và** `humidity ≥ 70` (chỉ số nhiệt cao: nóng ẩm).
3. **UNCOMFORTABLE** khi một trong:
   - `temperature ≥ 29` hoặc `humidity ≥ 75` hoặc `airQuality ≥ 500` (trùng rule engine);
   - `temperature ≥ 28` **và** `humidity ≥ 70`;
   - `airQuality ≥ 450` **và** có người;
   - `temperature < 18` (lạnh; rule engine không xét, model bổ sung).
4. **NORMAL** còn lại.

## Quy tắc góc cửa sổ

| Trạng thái | Góc |
|---|---|
| DANGER | 90 |
| WARNING | 90 nếu do không khí (`airQuality ≥ 650`), ngược lại 70 (chỉ do nhiệt) |
| UNCOMFORTABLE | lạnh (`temperature < 18`): 0 · do không khí (`airQuality ≥ 450`): 60 · do ẩm (`humidity ≥ 70`, không phải do không khí): 45 · do nhiệt: 45 |
| NORMAL | 20 nếu `airQuality ≥ 380` và có người (thông gió sớm), ngược lại 0 |

Điều chỉnh ngữ cảnh (áp dụng sau bảng trên, không áp dụng cho DANGER và WARNING):
- **Đêm có người** (`light < 30` và có người): giới hạn góc ≤ 30 khi lý do không phải không khí
  (người đang ngủ, tránh gió lùa). Nếu do không khí giữ nguyên.
- **Phòng trống và tối** (`light < 30`, không có người): NORMAL đóng cửa (0) kể cả khi
  `airQuality ≥ 380`.

## Quy tắc còi

- DANGER → **bật** (bắt buộc).
- WARNING với `airQuality ≥ 800` **và** có người → bật (báo khói sớm khi phòng có người).
- Mọi trường hợp khác → tắt. Không bật còi vì nóng hay ẩm dưới mức DANGER.

## Ví dụ

| t | h | aq | light | presence | state | angle | buzzer |
|---|---|---|---|---|---|---|---|
| 26 | 55 | 300 | 450 | true | NORMAL | 0 | false |
| 27 | 60 | 400 | 450 | true | NORMAL | 20 | false |
| 27 | 60 | 400 | 10 | false | NORMAL | 0 | false |
| 28.5 | 72 | 300 | 450 | true | UNCOMFORTABLE | 45 | false |
| 28.5 | 72 | 300 | 5 | true | UNCOMFORTABLE | 30 | false |
| 16 | 50 | 200 | 300 | true | UNCOMFORTABLE | 0 | false |
| 30.8 | 72 | 300 | 450 | false | WARNING | 70 | false |
| 27 | 55 | 660 | 450 | true | WARNING | 90 | false |
| 27 | 55 | 820 | 450 | true | WARNING | 90 | true |
| 27 | 55 | 820 | 450 | false | WARNING | 90 | false |
| 35 | 50 | 300 | 450 | false | DANGER | 90 | true |
| 26 | 50 | 950 | 0 | false | DANGER | 90 | true |
