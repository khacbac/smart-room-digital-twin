"""Build the labelled dataset for the TinyML controller.

Scenarios (sensor readings) are sampled here; the *labels* (state, window angle, buzzer) come
from an LLM following ml/policy.md:

  --provider gemini   Gemini labels every scenario through the Gemini API (google-genai SDK,
                      JSON output constrained by a schema, policy.md as system instruction).
                      Needs GEMINI_API_KEY (or GOOGLE_API_KEY). For Vertex AI set
                      GOOGLE_GENAI_USE_VERTEXAI=true + GOOGLE_CLOUD_PROJECT/LOCATION (ADC auth).
  --provider offline  the same policy written out as code in srdt_ml/policy.py
                      (used when no API credentials are available; identical schema).

Output: ml/data/<name>.jsonl, one object per line:
  {"temperature", "humidity", "airQuality", "light", "presence",
   "state", "windowAngle", "buzzer", "rationale", "ruleState", "source", "note"}

Usage:
  py -3.14 ml/generate_data.py --provider offline --n 6000
  py -3.14 ml/generate_data.py --provider gemini --n 1500 --batch 40 [--model gemini-3.1-pro-preview]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from srdt_ml.policy import SEED_SCENARIOS, label, rule_engine_state  # noqa: E402

DEFAULT_MODEL = "gemini-3.1-pro-preview"  # override with --model (gemini-2.5-* are closed to new keys)
POLICY_PATH = HERE / "policy.md"


def load_dotenv(path: Path) -> None:
    """Minimal .env loader (KEY=value lines); never overrides variables already set."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_dotenv(HERE / ".env")  # ml/.env is gitignored: put GEMINI_API_KEY=... there

# ---- scenario sampling --------------------------------------------------------------------

# Thresholds the policy switches on: sample densely around them so the model learns the edges.
TEMP_EDGES = [18.0, 28.0, 29.0, 30.5, 31.0, 34.0]
HUM_EDGES = [70.0, 75.0]
AQ_EDGES = [380.0, 450.0, 500.0, 650.0, 700.0, 800.0, 900.0]
LIGHT_EDGES = [30.0]


def _near(rng: random.Random, edges: list[float], lo: float, hi: float, spread: float) -> float:
    e = rng.choice(edges)
    return min(hi, max(lo, e + rng.gauss(0, spread)))


def sample_scenario(rng: random.Random) -> dict:
    """Mix of uniform coverage and boundary-dense samples."""
    mode = rng.random()
    if mode < 0.55:  # uniform
        t = rng.uniform(12.0, 40.0)
        h = rng.uniform(25.0, 98.0)
        aq = rng.uniform(30.0, 1000.0)
    else:  # near thresholds on 1-3 axes
        t = _near(rng, TEMP_EDGES, 12, 40, 0.8) if rng.random() < 0.6 else rng.uniform(12.0, 40.0)
        h = _near(rng, HUM_EDGES, 25, 98, 2.5) if rng.random() < 0.5 else rng.uniform(25.0, 98.0)
        aq = _near(rng, AQ_EDGES, 30, 1000, 25) if rng.random() < 0.6 else rng.uniform(30.0, 1000.0)
    # light: log-uniform 0..50000 lux, with extra mass near the "dark" edge
    if rng.random() < 0.25:
        light = max(0.0, _near(rng, LIGHT_EDGES, 0, 200, 15))
    else:
        light = 10 ** rng.uniform(0, math.log10(50000))
    presence = rng.random() < 0.6
    return {
        "temperature": round(t, 1),
        "humidity": round(h, 1),
        "airQuality": round(aq),
        "light": round(light, 1),
        "presence": presence,
    }


def seed_rows() -> list[dict]:
    return [
        {
            "temperature": s["t"],
            "humidity": float(s["h"]),
            "airQuality": s["aq"],
            "light": float(s["light"]),
            "presence": s["presence"],
            "note": s["note"],
        }
        for s in SEED_SCENARIOS
    ]


# ---- labelling ---------------------------------------------------------------------------


def label_offline(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        lb = label(r["temperature"], r["humidity"], r["airQuality"], r["light"], r["presence"])
        out.append({**r, "state": lb.state, "windowAngle": lb.window_angle, "buzzer": lb.buzzer,
                    "rationale": lb.rationale, "source": "offline-policy"})
    return out


# JSON schema for the LLM output (OpenAPI subset accepted by Gemini's response_schema).
LABEL_SCHEMA = {
    "type": "object",
    "properties": {
        "labels": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "state": {"type": "string", "enum": ["NORMAL", "UNCOMFORTABLE", "WARNING", "DANGER"]},
                    "windowAngle": {"type": "integer", "minimum": 0, "maximum": 90},
                    "buzzer": {"type": "boolean"},
                    "rationale": {"type": "string"},
                },
                "required": ["id", "state", "windowAngle", "buzzer", "rationale"],
            },
        }
    },
    "required": ["labels"],
}

SYSTEM_PROMPT = (
    "You label sensor scenarios of a smart room for a TinyML controller. Apply the policy "
    "below exactly and consistently; it is the ground truth. Return one label per scenario id, "
    "as JSON matching the schema, nothing else.\n\n"
)


def label_gemini(rows: list[dict], batch: int, model: str, thinking_budget: int, sink) -> list[dict]:
    """Labels `rows` in batches; `sink(batch_rows)` is called after every batch so progress is
    saved incrementally (a crash or quota stop keeps what was done; rerun with --resume)."""
    import httpx  # transport used by google-genai
    from google import genai
    from google.genai import errors, types

    # Reads GEMINI_API_KEY / GOOGLE_API_KEY, or Vertex AI via GOOGLE_GENAI_USE_VERTEXAI=true.
    # Per-request timeout (ms): without it a dropped connection through the proxy hangs forever.
    client = genai.Client(http_options=types.HttpOptions(timeout=180_000))
    policy = POLICY_PATH.read_text(encoding="utf-8")
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT + policy,
        response_mime_type="application/json",
        response_schema=LABEL_SCHEMA,
        temperature=0.0,  # labelling must be deterministic
        # Gemini counts thinking tokens against this limit; Gemini 3 Pro thinks 5-8k tokens per batch
        max_output_tokens=65536,
        thinking_config=types.ThinkingConfig(thinking_budget=thinking_budget) if thinking_budget >= 0 else None,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),  # silence the AFC warning
    )
    out: list[dict] = []
    for start in range(0, len(rows), batch):
        chunk = rows[start:start + batch]
        scenarios = [{"id": i, **{k: r[k] for k in ("temperature", "humidity", "airQuality", "light", "presence")}}
                     for i, r in enumerate(chunk)]
        user = "Label these scenarios:\n" + json.dumps(scenarios, ensure_ascii=False)
        labels: dict[int, dict] | None = None
        for attempt in range(6):
            try:
                resp = client.models.generate_content(model=model, contents=user, config=config)
            except errors.APIError as e:
                # 429 (quota) and 5xx are transient; anything else is a real problem
                if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                    wait = 20 * (attempt + 1) if e.code == 429 else 5 * (attempt + 1)
                    print(f"[gemini] {e.code} {e.status}, retry in {wait}s", file=sys.stderr)
                    time.sleep(wait)
                    continue
                raise
            except (httpx.HTTPError, ConnectionError, OSError, TimeoutError) as e:
                # DNS / proxy / socket hiccups (httpx.ConnectError etc. do NOT derive from OSError); retry
                if attempt < 5:
                    wait = 15 * (attempt + 1)
                    print(f"[gemini] network error {type(e).__name__}: {e}; retry in {wait}s", file=sys.stderr)
                    time.sleep(wait)
                    continue
                raise
            finish = resp.candidates[0].finish_reason if resp.candidates else None
            if not resp.text:
                fb = resp.prompt_feedback
                raise RuntimeError(f"Gemini returned no text for batch at {start} (finish={finish}"
                                   f"{f', blocked: {fb.block_reason}' if fb and fb.block_reason else ''})")
            try:
                parsed = {l["id"]: l for l in json.loads(resp.text)["labels"]}
            except (json.JSONDecodeError, KeyError, TypeError) as e:
                print(f"[gemini] bad JSON at {start} (finish={finish}): {e}; retry {attempt + 1}/4", file=sys.stderr)
                continue
            missing = [i for i in range(len(chunk)) if i not in parsed]
            if missing:
                print(f"[gemini] missing ids {missing} at {start}; retry {attempt + 1}/4", file=sys.stderr)
                continue
            labels = parsed
            break
        if labels is None:
            raise RuntimeError(f"Gemini labelling failed for batch at {start} after retries; lower --batch")

        done = []
        for i, r in enumerate(chunk):
            l = labels[i]
            done.append({**r, "state": l["state"], "windowAngle": int(l["windowAngle"]), "buzzer": bool(l["buzzer"]),
                         "rationale": l["rationale"], "source": f"gemini-api:{model}"})
        sink(done)
        out += done
        u = resp.usage_metadata
        print(f"[gemini] {start + len(chunk)}/{len(rows)} in={u.prompt_token_count} "
              f"thinking={u.thoughts_token_count or 0} out={u.candidates_token_count}", file=sys.stderr)
    return out


# ---- main --------------------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--provider", choices=["gemini", "offline"], default="offline")
    ap.add_argument("--n", type=int, default=6000, help="random scenarios (seed scenarios are always added)")
    ap.add_argument("--seed-repeat", type=int, default=8, help="how many times to include each seed scenario")
    ap.add_argument("--batch", type=int, default=40, help="scenarios per Gemini request")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="Gemini model id")
    ap.add_argument("--thinking-budget", type=int, default=-1,
                    help="Gemini thinking tokens per request (-1 = model default; Gemini 3 ignores a budget)")
    ap.add_argument("--rng", type=int, default=20261003)
    ap.add_argument("--out", default=None, help="output .jsonl (default ml/data/<provider>.jsonl)")
    ap.add_argument("--resume", action="store_true",
                    help="gemini: keep the rows already in --out and continue from there (same --rng/--n/--seed-repeat)")
    args = ap.parse_args()

    rng = random.Random(args.rng)
    rows = seed_rows() * args.seed_repeat + [sample_scenario(rng) for _ in range(args.n)]

    out = Path(args.out) if args.out else HERE / "data" / f"{args.provider}.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)

    def finish(r: dict) -> dict:
        r["ruleState"] = rule_engine_state(r["temperature"], r["humidity"], r["airQuality"])
        r.setdefault("note", "")
        return r

    if args.provider == "gemini":
        vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in ("1", "true")
        if not vertex and not (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")):
            sys.exit("GEMINI_API_KEY (or GOOGLE_API_KEY) is not set; get one at https://aistudio.google.com/apikey "
                     "or set GOOGLE_GENAI_USE_VERTEXAI=true for Vertex AI. Use --provider offline meanwhile.")
        already: list[dict] = []
        if args.resume and out.exists():
            already = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines() if l.strip()]
            print(f"[gemini] resuming: {len(already)} rows already in {out}", file=sys.stderr)
        # rows are written as each batch completes, so an interrupted run keeps its progress
        with out.open("a" if already else "w", encoding="utf-8") as f:
            def sink(batch_rows: list[dict]) -> None:
                for r in batch_rows:
                    f.write(json.dumps(finish(r), ensure_ascii=False) + "\n")
                f.flush()
            labelled = already + label_gemini(rows[len(already):], args.batch, args.model, args.thinking_budget, sink)
    else:
        labelled = [finish(r) for r in label_offline(rows)]
        with out.open("w", encoding="utf-8") as f:
            for r in labelled:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")

    from collections import Counter
    states = Counter(r["state"] for r in labelled)
    agree = sum(r["state"] == r["ruleState"] for r in labelled) / len(labelled)
    print(f"wrote {len(labelled)} rows -> {out}")
    print(f"states: {dict(states)}; buzzer on: {sum(r['buzzer'] for r in labelled)}; "
          f"agreement with rule engine: {agree:.3f}")


if __name__ == "__main__":
    main()
