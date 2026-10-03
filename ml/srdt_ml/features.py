"""Feature normalisation shared by Python, the C++ inference lib and the TS inference.

Any change here must be mirrored in device/lib/edge_ai/src/edge_ai.cpp and
server/scripts/edge-ai/infer.ts; `model.json` carries the same constants so the
TS side reads them instead of hard-coding.
"""
from __future__ import annotations

import math

STATES = ["NORMAL", "UNCOMFORTABLE", "WARNING", "DANGER"]
STATE_INDEX = {s: i for i, s in enumerate(STATES)}

# (offset, scale): x_norm = (x - offset) / scale
TEMP_NORM = (25.0, 10.0)
HUM_NORM = (50.0, 25.0)
AQ_NORM = (500.0, 250.0)
LIGHT_LOG_NORM = (2.5, 1.5)  # applied to log10(1 + lux)

FEATURE_NAMES = ["temperature", "humidity", "airQuality", "lightLog", "presence"]


def normalise(temperature: float, humidity: float, air_quality: float, light: float, presence: bool) -> list[float]:
    return [
        (temperature - TEMP_NORM[0]) / TEMP_NORM[1],
        (humidity - HUM_NORM[0]) / HUM_NORM[1],
        (air_quality - AQ_NORM[0]) / AQ_NORM[1],
        (math.log10(1.0 + max(0.0, light)) - LIGHT_LOG_NORM[0]) / LIGHT_LOG_NORM[1],
        1.0 if presence else 0.0,
    ]


def feature_spec() -> dict:
    return {
        "names": FEATURE_NAMES,
        "temperature": {"offset": TEMP_NORM[0], "scale": TEMP_NORM[1]},
        "humidity": {"offset": HUM_NORM[0], "scale": HUM_NORM[1]},
        "airQuality": {"offset": AQ_NORM[0], "scale": AQ_NORM[1]},
        "lightLog": {"transform": "log10(1+lux)", "offset": LIGHT_LOG_NORM[0], "scale": LIGHT_LOG_NORM[1]},
        "presence": {"transform": "bool->0/1"},
    }
