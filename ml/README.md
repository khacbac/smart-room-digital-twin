# TinyML controller (spec §8, Phase 7)

Model nhỏ chạy trên ESP32-S3 (và trong fake-device) để **điều khiển cửa sổ + còi theo điều kiện
phòng**, học từ dữ liệu do **LLM Gemini** gán nhãn theo chính sách tiện nghi [`policy.md`](policy.md).
Rule engine (`device/lib/edge_rules`) vẫn là safety floor: DANGER theo rule luôn thắng, lệnh
override từ dashboard vẫn ưu tiên.

```
 policy.md ──► Gemini (API, 3.1 Pro preview) ─┐
             hoặc srdt_ml/policy.py ─────────┤──► data/*.jsonl ──► train.py ──► model_data.h (firmware, int8)
 generate_data.py (sinh kịch bản)  ───────────┘        (torch)         └──► model.json  (fake-device / TS)
```

## Model

| | |
|---|---|
| Đầu vào | temperature, humidity, airQuality, log10(1+light), presence → chuẩn hoá ([`srdt_ml/features.py`](srdt_ml/features.py)) |
| Kiến trúc | Dense 5→24 ReLU → 12 ReLU → 12 |
| Đầu ra | 4 logit trạng thái · 7 logit góc cửa {0,20,30,45,60,70,90} · 1 logit còi |
| Trọng số | 600 tham số, int8 per-tensor (552 B) + bias float32 |
| Suy luận | ~600 MAC, < 50 µs trên PC, dưới ngân sách 50 ms của spec |

Vì sao model khác rule engine: chính sách gán nhãn thêm ngữ cảnh mà rule không có — nóng + ẩm
(heat index), có người trong phòng (thông gió sớm, còi sớm khi aq ≥ 800), ban đêm (giới hạn góc
mở khi có người ngủ), phòng lạnh (giữ cửa đóng), phòng trống (không mở). Độ "đồng ý" với rule
khoảng 86–90 % là chủ ý.

## Chạy

```sh
py -3.14 -m pip install -r ml/requirements.txt

# 1. Dữ liệu
py -3.14 ml/generate_data.py --provider offline --n 6000          # không cần API key
set GEMINI_API_KEY=AIza...   # hoặc ghi vào ml/.env (gitignored); lấy ở https://aistudio.google.com/apikey
py -3.14 ml/generate_data.py --provider gemini --n 1500 --batch 40 # Gemini gán nhãn trực tiếp
#   --model gemini-3.8-flash   rẻ/nhanh hơn (gemini-2.5-* đã đóng với key mới);  Vertex AI: GOOGLE_GENAI_USE_VERTEXAI=true
#   + GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION (xác thực bằng gcloud ADC)

# 2. Train + đánh giá + export (ghi model_data.h và server/scripts/edge-ai/model.json)
type ml\data\gemini.jsonl ml\data\offline.jsonl > ml\data\gemini+offline.jsonl   # gộp hai nguồn (Git Bash: cat)
py -3.14 ml/train.py --data "ml/data/gemini+offline.jsonl" --epochs 400 --hidden 24,12

# 3. Kiểm tra parity C++/TS và rebuild firmware
cd device && pio test -e native -f test_edge_ai && pio run -e esp32-s3
pnpm --filter @srdt/server test
```

Kết quả mới nhất ([`reports/report.md`](reports/report.md)): train trên `data/gemini+offline.jsonl` (1844 nhãn Gemini 3.1 Pro
+ 6344 nhãn offline, cùng chính sách): state accuracy 96.7 %, macro F1 0.965, góc MAE 1.6°, DANGER recall vs rule 95.7 %.
Nhãn Gemini khớp chính sách 100 % trạng thái/còi, 98.6 % góc; 25 điểm lệch là vùng chính sách chưa nói rõ
(phòng lạnh nhưng ngột ngạt, phòng trống + tối ở mức UNCOMFORTABLE) và được giữ nguyên theo phán đoán của Gemini.

### Hai nguồn nhãn

- `--provider gemini`: mỗi lô 40 kịch bản được gửi cho Gemini (`google-genai` SDK, mặc định
  `gemini-3.1-pro-preview`) với `policy.md` làm `system_instruction`, `temperature 0`, đầu ra JSON ràng buộc bằng
  `response_schema`; `max_output_tokens` 65536 vì Gemini 3 tính cả token thinking (5–8k mỗi lô) vào giới hạn;
  tự retry khi 429/5xx, JSON hỏng hoặc thiếu id. Ghi từng lô ra file, bị ngắt thì chạy lại với `--resume`
  (cùng `--rng/--n/--seed-repeat`). Cần `GEMINI_API_KEY` trong env hoặc `ml/.env` (gitignored, hoặc Vertex AI). Trên mạng FPT có proxy SSL, nếu lỗi chứng chỉ thì đặt `SSL_CERT_FILE` trỏ tới
  CA bundle của công ty.
- `--provider offline`: cùng chính sách viết thành code [`srdt_ml/policy.py`](srdt_ml/policy.py)
  (do Claude Code viết trong phiên 2026-10-03) kèm 43 kịch bản tay (`SEED_SCENARIOS`). Dùng khi không
  có key; đây là nguồn của `data/offline.jsonl` hiện tại.

Trộn hai nguồn: nối file `.jsonl` rồi `train.py --data`.

## Trên thiết bị

- `device/lib/edge_ai/`: `edge_ai.h/.cpp` (forward int8 + `Controller` chống nhấp nháy: leo thang
  áp dụng ngay, hạ cấp cần 2 mẫu liên tiếp), `model_data.h` (sinh ra).
- `device/lib/edge_rules`: `Engine::setAiControl / setAiOutputs / autoWindowAngle`.
- `main.cpp`: suy luận sau mỗi `evaluate()` (1 s); console `ai on|off|` + dòng `[edge] … ml=STATE/angle/buzzer*`.
- Telemetry thêm `mlState` và `aiControl`; dashboard hiện ở StatusStrip ("TinyML: Warning · driving").
- Mặc định bật (`EDGE_AI_CONTROL_DEFAULT 1` trong `config.h`). DHT lỗi → model không có đầu vào →
  tự về rule.

## Giới hạn

- Nhãn là chính sách (policy) chứ không phải dữ liệu đo thật; model học bắt chước chính sách đó. Khi có
  CSV từ phòng thật (spec D5) có thể trộn thêm.
- Sai số chủ yếu ở sát ngưỡng (±0.5 °C, ±25 aq); `Controller` + hysteresis của rule engine làm mượt.
- `tools/link-sim` (RoomSim 2 mạch) chưa chạy model; mạch node thật thì có vì dùng chung `main.cpp`.
