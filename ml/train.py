"""Train the TinyML controller, evaluate it, quantise to int8 and export.

  py -3.14 ml/train.py --data ml/data/offline.jsonl

Model (spec §8, plus two heads so it can drive the actuators):
  5 inputs -> Dense(16) ReLU -> Dense(8) ReLU -> Dense(12)
  outputs: [0..3] state logits, [4..10] window angle class logits (ANGLES), [11] buzzer logit

Artifacts:
  ml/artifacts/model.json                      float + int8 weights, feature spec (TS inference)
  ml/artifacts/model.pt                        torch state dict
  device/lib/edge_ai/src/model_data.h          int8 weights for the firmware
  server/scripts/edge-ai/model.json            copy of model.json for fake-device
  ml/reports/report.md                         metrics: accuracy, F1, confusion, agreement
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from srdt_ml.features import STATES, STATE_INDEX, feature_spec, normalise  # noqa: E402

HIDDEN = (16, 8)
ANGLES = [0, 20, 30, 45, 60, 70, 90]  # the discrete angles ml/policy.md uses
ANGLE_INDEX = {a: i for i, a in enumerate(ANGLES)}
STATE_SLICE = slice(0, 4)
ANGLE_SLICE = slice(4, 4 + len(ANGLES))
BUZZER_IDX = 4 + len(ANGLES)
N_OUT = BUZZER_IDX + 1


class Controller(nn.Module):
    def __init__(self, hidden: tuple[int, int] = HIDDEN) -> None:
        super().__init__()
        self.l1 = nn.Linear(5, hidden[0])
        self.l2 = nn.Linear(hidden[0], hidden[1])
        self.l3 = nn.Linear(hidden[1], N_OUT)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = F.relu(self.l1(x))
        x = F.relu(self.l2(x))
        return self.l3(x)


# ---- data --------------------------------------------------------------------------------


def load(path: Path) -> list[dict]:
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    # spec §8: drop samples without temperature/humidity (DHT fault -> rules only at runtime)
    return [r for r in rows if r["temperature"] is not None and r["humidity"] is not None]


def to_tensors(rows: list[dict]) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    x = torch.tensor([normalise(r["temperature"], r["humidity"], r["airQuality"], r["light"], r["presence"])
                      for r in rows], dtype=torch.float32)
    ys = torch.tensor([STATE_INDEX[r["state"]] for r in rows], dtype=torch.long)
    ya = torch.tensor([ANGLE_INDEX[int(r["windowAngle"])] for r in rows], dtype=torch.long)
    yb = torch.tensor([1.0 if r["buzzer"] else 0.0 for r in rows], dtype=torch.float32)
    return x, ys, ya, yb


def stratified_split(rows: list[dict], seed: int) -> tuple[list[dict], list[dict], list[dict]]:
    rng = np.random.default_rng(seed)
    by_state: dict[str, list[dict]] = {}
    for r in rows:
        by_state.setdefault(r["state"], []).append(r)
    train, val, test = [], [], []
    for group in by_state.values():
        idx = rng.permutation(len(group))
        n_tr, n_va = int(0.7 * len(group)), int(0.15 * len(group))
        train += [group[i] for i in idx[:n_tr]]
        val += [group[i] for i in idx[n_tr:n_tr + n_va]]
        test += [group[i] for i in idx[n_tr + n_va:]]
    return train, val, test


# ---- training ----------------------------------------------------------------------------


def loss_fn(out: torch.Tensor, ys: torch.Tensor, ya: torch.Tensor, yb: torch.Tensor, w_state: torch.Tensor):
    l_state = F.cross_entropy(out[:, STATE_SLICE], ys, weight=w_state)
    l_angle = F.cross_entropy(out[:, ANGLE_SLICE], ya)
    l_buzz = F.binary_cross_entropy_with_logits(out[:, BUZZER_IDX], yb, pos_weight=torch.tensor(2.0))
    return l_state + l_angle + l_buzz, (l_state.item(), l_angle.item(), l_buzz.item())


def train(model: nn.Module, tr, va, epochs: int, seed: int) -> dict:
    torch.manual_seed(seed)
    x, ys, ya, yb = tr
    counts = torch.bincount(ys, minlength=4).float()
    w_state = (counts.sum() / (4 * counts)).clamp(max=5.0)
    opt = torch.optim.Adam(model.parameters(), lr=3e-3, weight_decay=1e-5)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    best, best_state = float("inf"), None
    n = len(x)
    for ep in range(epochs):
        model.train()
        perm = torch.randperm(n)
        for i in range(0, n, 64):
            b = perm[i:i + 64]
            opt.zero_grad()
            loss, _ = loss_fn(model(x[b]), ys[b], ya[b], yb[b], w_state)
            loss.backward()
            opt.step()
        sched.step()
        model.eval()
        with torch.no_grad():
            vloss, parts = loss_fn(model(va[0]), va[1], va[2], va[3], w_state)
        if vloss.item() < best:
            best, best_state = vloss.item(), {k: v.clone() for k, v in model.state_dict().items()}
        if ep % 25 == 0 or ep == epochs - 1:
            print(f"epoch {ep:4d} val loss {vloss.item():.4f} (state {parts[0]:.3f} angle {parts[1]:.4f} buzz {parts[2]:.3f})")
    model.load_state_dict(best_state)
    return {"best_val_loss": best}


# ---- quantisation ------------------------------------------------------------------------


def quantise(model: nn.Module) -> dict:
    """Symmetric per-tensor int8 weights, float32 biases. Returns the export dict."""
    layers = []
    for name in ("l1", "l2", "l3"):
        lin: nn.Linear = getattr(model, name)
        w = lin.weight.detach().numpy().astype(np.float32)  # [out, in]
        b = lin.bias.detach().numpy().astype(np.float32)
        scale = float(np.max(np.abs(w)) / 127.0) or 1.0
        wq = np.clip(np.round(w / scale), -127, 127).astype(np.int8)
        layers.append({"name": name, "in": w.shape[1], "out": w.shape[0], "scale": scale,
                       "weights_int8": wq.flatten().tolist(), "bias": b.tolist(),
                       "weights_float": w.flatten().tolist()})
    return {"layers": layers}


def forward_quantised(layers: list[dict], x: np.ndarray) -> np.ndarray:
    """Reference inference exactly as the C++/TS code does it (int8 weights * scale, float math)."""
    a = x.astype(np.float32)
    for i, l in enumerate(layers):
        w = np.array(l["weights_int8"], dtype=np.float32).reshape(l["out"], l["in"]) * np.float32(l["scale"])
        a = a @ w.T + np.array(l["bias"], dtype=np.float32)
        if i < len(layers) - 1:
            a = np.maximum(a, 0)
    return a


def decode(out: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    state = out[:, STATE_SLICE].argmax(axis=1)
    angle = np.array(ANGLES)[out[:, ANGLE_SLICE].argmax(axis=1)]
    buzzer = out[:, BUZZER_IDX] > 0
    return state, angle, buzzer


# ---- metrics -----------------------------------------------------------------------------


def metrics(rows: list[dict], layers: list[dict]) -> dict:
    x = np.array([normalise(r["temperature"], r["humidity"], r["airQuality"], r["light"], r["presence"]) for r in rows])
    out = forward_quantised(layers, x)
    ps, pa, pb = decode(out)
    ys = np.array([STATE_INDEX[r["state"]] for r in rows])
    ya = np.array([r["windowAngle"] for r in rows])
    yb = np.array([r["buzzer"] for r in rows])
    yr = np.array([STATE_INDEX[r["ruleState"]] for r in rows])

    cm = np.zeros((4, 4), dtype=int)
    for t, p in zip(ys, ps):
        cm[t, p] += 1
    f1 = {}
    for i, s in enumerate(STATES):
        tp = cm[i, i]
        prec = tp / cm[:, i].sum() if cm[:, i].sum() else 0.0
        rec = tp / cm[i].sum() if cm[i].sum() else 0.0
        f1[s] = 2 * prec * rec / (prec + rec) if prec + rec else 0.0

    # Safety: the model must never say less than DANGER when the rule engine says DANGER.
    danger_mask = yr == 3
    danger_recall_vs_rules = float((ps[danger_mask] == 3).mean()) if danger_mask.any() else 1.0

    return {
        "n": len(rows),
        "state_accuracy": float((ps == ys).mean()),
        "f1": f1,
        "macro_f1": float(np.mean(list(f1.values()))),
        "confusion": cm.tolist(),
        "angle_mae": float(np.abs(pa - ya).mean()),
        "angle_within_10": float((np.abs(pa - ya) <= 10).mean()),
        "buzzer_accuracy": float((pb == yb).mean()),
        "buzzer_false_negative": int(((pb == False) & (yb == True)).sum()),  # noqa: E712
        "agreement_with_rules_model": float((ps == yr).mean()),
        "agreement_with_rules_labels": float((ys == yr).mean()),
        "danger_recall_vs_rules": danger_recall_vs_rules,
    }


def report_md(m: dict, extra: dict) -> str:
    lines = ["# TinyML controller report", "",
             f"Generated {time.strftime('%Y-%m-%d %H:%M')} from `{extra['data']}` "
             f"({extra['n_total']} rows; labels: {extra['sources']}).", "",
             f"Model: 5 -> {HIDDEN[0]} -> {HIDDEN[1]} -> {N_OUT}, {extra['params']} parameters, int8 weights "
             f"({extra['int8_bytes']} B) + float32 biases. Epochs {extra['epochs']}, best val loss {extra['best_val_loss']:.4f}.",
             "", "## Test set (int8-quantised model)", "",
             "| Metric | Value |", "|---|---|",
             f"| samples | {m['n']} |",
             f"| state accuracy | {m['state_accuracy']:.4f} |",
             f"| macro F1 | {m['macro_f1']:.4f} |"]
    for s in STATES:
        lines.append(f"| F1 {s} | {m['f1'][s]:.4f} |")
    lines += [f"| window angle MAE (deg) | {m['angle_mae']:.2f} |",
              f"| window angle within 10 deg | {m['angle_within_10']:.4f} |",
              f"| buzzer accuracy | {m['buzzer_accuracy']:.4f} |",
              f"| buzzer false negatives | {m['buzzer_false_negative']} |",
              f"| agreement model vs rule engine | {m['agreement_with_rules_model']:.4f} |",
              f"| agreement labels vs rule engine | {m['agreement_with_rules_labels']:.4f} |",
              f"| DANGER recall where rules say DANGER | {m['danger_recall_vs_rules']:.4f} |",
              "", "## Confusion matrix (rows = label, cols = prediction)", "",
              "| | " + " | ".join(STATES) + " |", "|---|" + "---|" * 4]
    for i, s in enumerate(STATES):
        lines.append(f"| {s} | " + " | ".join(str(v) for v in m["confusion"][i]) + " |")
    lines += ["", "## Float vs int8 on the test set", "",
              f"state accuracy float {extra['float_acc']:.4f} vs int8 {m['state_accuracy']:.4f}", "",
              "## Notes", "",
              "- Labels follow `ml/policy.md` (LLM comfort policy). The disagreement with the rule engine is "
              "intentional: the policy adds humidity+heat, occupancy, night and cold context the rules lack.",
              "- The firmware keeps the rule engine as safety floor: a rule-engine DANGER always wins "
              "(window 90, buzzer on), and manual overrides from the dashboard take precedence over the model.",
              "- Inference on the ESP32-S3 is ~300 multiply-adds; see `pio test -e native` (test_edge_ai) for the "
              "host latency check."]
    return "\n".join(lines) + "\n"


# ---- export ------------------------------------------------------------------------------


def c_header(export: dict, meta: dict) -> str:
    L = export["layers"]
    out = ["// GENERATED by ml/train.py - do not edit. Int8 weights (per-tensor symmetric), float biases.",
           f"// {meta['generated']} from {meta['data']} - test state acc {meta['state_accuracy']:.4f}, "
           f"angle MAE {meta['angle_mae']:.1f} deg", "#pragma once", "", "#include <stdint.h>", "",
           "namespace edge_ai {", "namespace model {", "",
           f'static const char* const kVersion = "{meta["version"]}";',
           f"static const int kInputs = {L[0]['in']};",
           f"static const int kHidden1 = {L[0]['out']};",
           f"static const int kHidden2 = {L[1]['out']};",
           f"static const int kOutputs = {L[2]['out']};",
           f"static const int kAngleCount = {len(ANGLES)};",
           "static const int kAngles[" + str(len(ANGLES)) + "] = {" + ", ".join(str(a) for a in ANGLES) + "};",
           "// output layout: [0,4) state logits, [4,4+kAngleCount) angle class logits, last = buzzer logit", ""]
    fs = meta["features"]
    out += ["// Feature normalisation: (x - offset) / scale; light uses log10(1 + lux).",
            f"static const float kTempOffset = {fs['temperature']['offset']}f, kTempScale = {fs['temperature']['scale']}f;",
            f"static const float kHumOffset = {fs['humidity']['offset']}f, kHumScale = {fs['humidity']['scale']}f;",
            f"static const float kAqOffset = {fs['airQuality']['offset']}f, kAqScale = {fs['airQuality']['scale']}f;",
            f"static const float kLightOffset = {fs['lightLog']['offset']}f, kLightScale = {fs['lightLog']['scale']}f;", ""]
    for i, l in enumerate(L, 1):
        out.append(f"static const float kScale{i} = {l['scale']:.9g}f;")
        w = l["weights_int8"]
        rows = [", ".join(f"{v:4d}" for v in w[r * l['in']:(r + 1) * l['in']]) for r in range(l["out"])]
        out.append(f"static const int8_t kW{i}[{l['out']} * {l['in']}] = {{  // [out][in]")
        out += ["    " + r + "," for r in rows]
        out.append("};")
        out.append(f"static const float kB{i}[{l['out']}] = {{" + ", ".join(f"{b:.9g}f" for b in l["bias"]) + "};")
        out.append("")
    out += ["}  // namespace model", "}  // namespace edge_ai", ""]
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(HERE / "data" / "offline.jsonl"))
    ap.add_argument("--epochs", type=int, default=300)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--hidden", default="16,8", help="hidden layer sizes, e.g. 24,12")
    ap.add_argument("--no-export", action="store_true")
    args = ap.parse_args()
    global HIDDEN
    HIDDEN = tuple(int(v) for v in args.hidden.split(","))

    rows = load(Path(args.data))
    tr_rows, va_rows, te_rows = stratified_split(rows, args.seed)
    print(f"rows {len(rows)}: train {len(tr_rows)} val {len(va_rows)} test {len(te_rows)}; "
          f"states {dict(Counter(r['state'] for r in rows))}")

    model = Controller(HIDDEN)
    info = train(model, to_tensors(tr_rows), to_tensors(va_rows), args.epochs, args.seed)
    model.eval()

    export = quantise(model)
    with torch.no_grad():
        xt = to_tensors(te_rows)[0]
        float_acc = float((model(xt)[:, STATE_SLICE].argmax(1) == to_tensors(te_rows)[1]).float().mean())
    m = metrics(te_rows, export["layers"])
    print(json.dumps({k: v for k, v in m.items() if k != "confusion"}, indent=1))
    print("confusion", m["confusion"])

    params = sum(p.numel() for p in model.parameters())
    int8_bytes = sum(len(l["weights_int8"]) for l in export["layers"])
    version = time.strftime("%Y%m%d-%H%M")
    meta = {"version": version, "generated": time.strftime("%Y-%m-%d %H:%M"), "data": Path(args.data).name,
            "state_accuracy": m["state_accuracy"], "angle_mae": m["angle_mae"], "features": feature_spec()}
    export.update({"version": version, "features": feature_spec(), "states": STATES, "hidden": list(HIDDEN),
                   "outputs": {"state": [0, 4], "windowAngle": [4, 4 + len(ANGLES)], "angles": ANGLES,
                               "buzzer": BUZZER_IDX},
                   "metrics": {k: v for k, v in m.items() if k != "confusion"}})

    HERE.joinpath("artifacts").mkdir(exist_ok=True)
    HERE.joinpath("reports").mkdir(exist_ok=True)
    torch.save(model.state_dict(), HERE / "artifacts" / "model.pt")
    (HERE / "artifacts" / "model.json").write_text(json.dumps(export, indent=1), encoding="utf-8")
    sources = ", ".join(sorted({r.get("source", "?") for r in rows}))
    (HERE / "reports" / "report.md").write_text(
        report_md(m, {"data": Path(args.data).name, "n_total": len(rows), "sources": sources, "params": params,
                      "int8_bytes": int8_bytes, "epochs": args.epochs, "best_val_loss": info["best_val_loss"],
                      "float_acc": float_acc}), encoding="utf-8")
    if not args.no_export:
        hdr = ROOT / "device" / "lib" / "edge_ai" / "src" / "model_data.h"
        hdr.parent.mkdir(parents=True, exist_ok=True)
        hdr.write_text(c_header(export, meta), encoding="utf-8")
        ts_model = ROOT / "server" / "scripts" / "edge-ai" / "model.json"
        ts_model.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(HERE / "artifacts" / "model.json", ts_model)
        print(f"exported {hdr.relative_to(ROOT)} and {ts_model.relative_to(ROOT)}")
    print(f"params {params}, int8 weight bytes {int8_bytes}; report ml/reports/report.md")


if __name__ == "__main__":
    main()
