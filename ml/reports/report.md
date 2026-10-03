# TinyML controller report

Generated 2026-10-03 21:29 from `gemini+offline.jsonl` (8188 rows; labels: claude-offline-policy, gemini-api:gemini-3.1-pro-preview).

Model: 5 -> 24 -> 12 -> 12, 600 parameters, int8 weights (552 B) + float32 biases. Epochs 400, best val loss 0.2163.

## Test set (int8-quantised model)

| Metric | Value |
|---|---|
| samples | 1232 |
| state accuracy | 0.9667 |
| macro F1 | 0.9649 |
| F1 NORMAL | 0.9518 |
| F1 UNCOMFORTABLE | 0.9677 |
| F1 WARNING | 0.9659 |
| F1 DANGER | 0.9744 |
| window angle MAE (deg) | 1.65 |
| window angle within 10 deg | 0.9562 |
| buzzer accuracy | 0.9911 |
| buzzer false negatives | 2 |
| agreement model vs rule engine | 0.8628 |
| agreement labels vs rule engine | 0.8815 |
| DANGER recall where rules say DANGER | 0.9565 |

## Confusion matrix (rows = label, cols = prediction)

| | NORMAL | UNCOMFORTABLE | WARNING | DANGER |
|---|---|---|---|---|
| NORMAL | 148 | 7 | 0 | 0 |
| UNCOMFORTABLE | 8 | 389 | 7 | 0 |
| WARNING | 0 | 4 | 368 | 2 |
| DANGER | 0 | 0 | 13 | 286 |

## Float vs int8 on the test set

state accuracy float 0.9756 vs int8 0.9667

## Notes

- Labels follow `ml/policy.md` (LLM comfort policy). The disagreement with the rule engine is intentional: the policy adds humidity+heat, occupancy, night and cold context the rules lack.
- The firmware keeps the rule engine as safety floor: a rule-engine DANGER always wins (window 90, buzzer on), and manual overrides from the dashboard take precedence over the model.
- Inference on the ESP32-S3 is ~300 multiply-adds; see `pio test -e native` (test_edge_ai) for the host latency check.
