"""Offline labeller: the policy in ml/policy.md written out as code (by Claude Code, session of
2026-10-03) so the dataset can be built without an API key. `generate_data.py --provider gemini`
asks Gemini to label the same scenarios live instead; both must agree with policy.md.

Also holds the hand-written seed scenarios (named edge cases) that are always included.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Label:
    state: str
    window_angle: int
    buzzer: bool
    rationale: str


def rule_engine_state(t: float, h: float, aq: float) -> str:
    """ENTER thresholds of device/include/config.h (what the firmware rule engine would say)."""
    if t >= 34 or aq >= 900:
        return "DANGER"
    if t >= 31 or aq >= 700:
        return "WARNING"
    if t >= 29 or h >= 75 or aq >= 500:
        return "UNCOMFORTABLE"
    return "NORMAL"


def label(t: float, h: float, aq: float, light: float, presence: bool) -> Label:
    dark = light < 30
    cold = t < 18

    # ---- state ----
    if t >= 34 or aq >= 900:
        state, why = "DANGER", "temperature >=34 or airQuality >=900"
    elif t >= 31 or aq >= 700:
        state, why = "WARNING", "temperature >=31 or airQuality >=700"
    elif aq >= 650 and presence:
        state, why = "WARNING", "airQuality >=650 with people present (early warning)"
    elif t >= 30.5 and h >= 70:
        state, why = "WARNING", "hot and humid (heat index)"
    elif t >= 29 or h >= 75 or aq >= 500:
        state, why = "UNCOMFORTABLE", "temperature >=29 or humidity >=75 or airQuality >=500"
    elif t >= 28 and h >= 70:
        state, why = "UNCOMFORTABLE", "warm and humid"
    elif aq >= 450 and presence:
        state, why = "UNCOMFORTABLE", "airQuality >=450 with people present"
    elif cold:
        state, why = "UNCOMFORTABLE", "cold (<18 C)"
    else:
        state, why = "NORMAL", "all readings comfortable"

    # ---- window ----
    air_driven = aq >= 450
    if state == "DANGER":
        angle = 90
    elif state == "WARNING":
        angle = 90 if aq >= 650 else 70
    elif state == "UNCOMFORTABLE":
        if cold:
            angle = 0
        elif air_driven:
            angle = 60
        else:
            angle = 45  # humidity- or temperature-driven
        if dark and presence and not air_driven:
            angle = min(angle, 30)
    else:  # NORMAL
        angle = 20 if (aq >= 380 and presence) else 0
        if dark and not presence:
            angle = 0

    # ---- buzzer ----
    if state == "DANGER":
        buzzer = True
    elif state == "WARNING" and aq >= 800 and presence:
        buzzer = True
    else:
        buzzer = False

    return Label(state, angle, buzzer, why)


# Named scenarios written by hand (always in the dataset, weighted above random samples).
SEED_SCENARIOS: list[dict] = [
    {"t": 26.0, "h": 55, "aq": 300, "light": 450, "presence": True, "note": "office daytime, comfortable"},
    {"t": 24.5, "h": 48, "aq": 180, "light": 1200, "presence": True, "note": "bright morning, fresh air"},
    {"t": 26.5, "h": 62, "aq": 300, "light": 450, "presence": True, "note": "fake-device default"},
    {"t": 27.0, "h": 60, "aq": 400, "light": 450, "presence": True, "note": "getting stuffy, people present: pre-ventilate 20"},
    {"t": 27.0, "h": 60, "aq": 400, "light": 450, "presence": False, "note": "getting stuffy, nobody: stay closed"},
    {"t": 27.0, "h": 60, "aq": 400, "light": 10, "presence": False, "note": "empty dark room: closed"},
    {"t": 27.0, "h": 60, "aq": 460, "light": 450, "presence": True, "note": "aq 460 occupied: UNCOMFORTABLE 60"},
    {"t": 27.0, "h": 60, "aq": 460, "light": 450, "presence": False, "note": "aq 460 empty: still NORMAL"},
    {"t": 28.5, "h": 72, "aq": 300, "light": 450, "presence": True, "note": "warm humid afternoon: 45"},
    {"t": 28.5, "h": 72, "aq": 300, "light": 5, "presence": True, "note": "warm humid night, sleeping: cap 30"},
    {"t": 29.2, "h": 55, "aq": 250, "light": 800, "presence": False, "note": "hot dry, empty: 45"},
    {"t": 26.0, "h": 78, "aq": 250, "light": 450, "presence": True, "note": "very humid only: 45"},
    {"t": 26.0, "h": 78, "aq": 250, "light": 2, "presence": True, "note": "very humid at night with people: 30"},
    {"t": 16.0, "h": 50, "aq": 200, "light": 300, "presence": True, "note": "cold morning: UNCOMFORTABLE, keep closed"},
    {"t": 17.5, "h": 40, "aq": 150, "light": 0, "presence": False, "note": "cold empty night: closed"},
    {"t": 26.0, "h": 55, "aq": 520, "light": 450, "presence": False, "note": "aq 520 empty: UNCOMFORTABLE 60"},
    {"t": 30.8, "h": 72, "aq": 300, "light": 450, "presence": False, "note": "heat index: WARNING 70"},
    {"t": 30.8, "h": 60, "aq": 300, "light": 450, "presence": True, "note": "30.8 dry: only UNCOMFORTABLE"},
    {"t": 31.5, "h": 50, "aq": 300, "light": 450, "presence": True, "note": "temp WARNING: 70, no buzzer"},
    {"t": 27.0, "h": 55, "aq": 660, "light": 450, "presence": True, "note": "aq 660 occupied: WARNING 90"},
    {"t": 27.0, "h": 55, "aq": 660, "light": 450, "presence": False, "note": "aq 660 empty: UNCOMFORTABLE 60"},
    {"t": 27.0, "h": 55, "aq": 720, "light": 450, "presence": False, "note": "aq 720: WARNING even when empty"},
    {"t": 27.0, "h": 55, "aq": 820, "light": 450, "presence": True, "note": "smoke-ish, people: buzzer on early"},
    {"t": 27.0, "h": 55, "aq": 820, "light": 450, "presence": False, "note": "smoke-ish, empty: no buzzer yet"},
    {"t": 27.0, "h": 55, "aq": 820, "light": 1, "presence": True, "note": "smoke-ish at night with sleepers: buzzer"},
    {"t": 35.0, "h": 50, "aq": 300, "light": 450, "presence": False, "note": "fake-device hot preset: DANGER"},
    {"t": 27.0, "h": 55, "aq": 950, "light": 0, "presence": False, "note": "fake-device smoke preset: DANGER"},
    {"t": 34.2, "h": 80, "aq": 980, "light": 20000, "presence": True, "note": "everything bad"},
    {"t": 33.5, "h": 45, "aq": 880, "light": 300, "presence": True, "note": "just under both DANGER thresholds: WARNING, buzzer (aq>=800, people)"},
    {"t": 22.0, "h": 40, "aq": 100, "light": 0, "presence": False, "note": "cool empty night: NORMAL closed"},
    {"t": 22.0, "h": 40, "aq": 100, "light": 50000, "presence": True, "note": "direct sun, cool: NORMAL"},
    {"t": 28.0, "h": 70, "aq": 200, "light": 450, "presence": True, "note": "exact warm-humid boundary: UNCOMFORTABLE"},
    {"t": 27.9, "h": 70, "aq": 200, "light": 450, "presence": True, "note": "just below warm-humid: NORMAL"},
    {"t": 29.0, "h": 30, "aq": 100, "light": 450, "presence": True, "note": "29.0 exact: UNCOMFORTABLE"},
    {"t": 26.0, "h": 75, "aq": 100, "light": 450, "presence": False, "note": "75 exact humidity: UNCOMFORTABLE"},
    {"t": 26.0, "h": 50, "aq": 500, "light": 450, "presence": False, "note": "500 exact aq: UNCOMFORTABLE"},
    {"t": 31.0, "h": 50, "aq": 100, "light": 450, "presence": False, "note": "31.0 exact: WARNING 70"},
    {"t": 26.0, "h": 50, "aq": 700, "light": 450, "presence": False, "note": "700 exact: WARNING 90"},
    {"t": 34.0, "h": 50, "aq": 100, "light": 450, "presence": False, "note": "34.0 exact: DANGER"},
    {"t": 26.0, "h": 50, "aq": 900, "light": 450, "presence": False, "note": "900 exact: DANGER"},
    {"t": 20.0, "h": 90, "aq": 200, "light": 100, "presence": True, "note": "cool but very humid (rainy): UNCOMFORTABLE 45"},
    {"t": 20.0, "h": 90, "aq": 200, "light": 3, "presence": True, "note": "rainy night with people: 30"},
    {"t": 26.0, "h": 55, "aq": 390, "light": 25, "presence": True, "note": "dim evening, aq 390 occupied: 20"},
]
