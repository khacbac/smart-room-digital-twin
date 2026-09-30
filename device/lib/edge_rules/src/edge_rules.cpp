#include "edge_rules.h"

#include <initializer_list>
#include <math.h>
#include <stdio.h>

namespace edge {

// ---- Thresholds (§7.4), indexed by level. NaN = no condition on that input. ----

namespace {

struct Thresholds {
    float tempEnter, tempExit;
    float humEnter, humExit;
    float aqEnter, aqExit;
};

const Thresholds kLevels[4] = {
    {NAN, NAN, NAN, NAN, NAN, NAN},  // NORMAL: none
    {UNCOMF_TEMP_ENTER, UNCOMF_TEMP_EXIT, UNCOMF_HUM_ENTER, UNCOMF_HUM_EXIT, UNCOMF_AQ_ENTER, UNCOMF_AQ_EXIT},
    {WARNING_TEMP_ENTER, WARNING_TEMP_EXIT, NAN, NAN, WARNING_AQ_ENTER, WARNING_AQ_EXIT},
    {DANGER_TEMP_ENTER, DANGER_TEMP_EXIT, NAN, NAN, DANGER_AQ_ENTER, DANGER_AQ_EXIT},
};

// §7.2 null semantics: a null input makes ENTER false and EXIT true.
bool enters(float v, float th) { return !isnan(th) && !isnan(v) && v >= th; }
bool exits(float v, float th) { return isnan(th) || isnan(v) || v < th; }

uint8_t enterReasons(State level, float t, float h, float aq) {
    const Thresholds& th = kLevels[(int)level];
    uint8_t bits = 0;
    if (enters(t, th.tempEnter)) bits |= kReasonTemperature;
    if (enters(h, th.humEnter)) bits |= kReasonHumidity;
    if (enters(aq, th.aqEnter)) bits |= kReasonAirQuality;
    return bits;
}

bool exitAllowed(State level, float t, float h, float aq) {
    const Thresholds& th = kLevels[(int)level];
    return exits(t, th.tempExit) && exits(h, th.humExit) && exits(aq, th.aqExit);
}

uint8_t exitReasons(State level) {
    const Thresholds& th = kLevels[(int)level];
    uint8_t bits = 0;
    if (!isnan(th.tempExit)) bits |= kReasonTemperature;
    if (!isnan(th.humExit)) bits |= kReasonHumidity;
    if (!isnan(th.aqExit)) bits |= kReasonAirQuality;
    return bits;
}

// UNCOMFORTABLE and WARNING keep the current window angle (§7.6).
bool holdsWindow(State s) { return s == State::Uncomfortable || s == State::Warning; }

bool inRange(float v, float lo, float hi) { return !isnan(v) && v >= lo && v <= hi; }

// Wrap-safe "at least `ms` since `since`".
bool elapsed(uint32_t nowMs, uint32_t since, uint32_t ms) { return (uint32_t)(nowMs - since) >= ms; }

const uint32_t kOverrideMs = (uint32_t)MANUAL_OVERRIDE_SEC * 1000;

}  // namespace

// ---- Names ------------------------------------------------------------------

const char* stateName(State s) {
    switch (s) {
        case State::Normal: return "NORMAL";
        case State::Uncomfortable: return "UNCOMFORTABLE";
        case State::Warning: return "WARNING";
        default: return "DANGER";
    }
}

const char* stateLabel(State s) {
    return s == State::Uncomfortable ? "UNCOMF" : stateName(s);
}

const char* eventTypeName(EventType t) {
    switch (t) {
        case EventType::StateChanged: return "STATE_CHANGED";
        case EventType::SensorFault: return "SENSOR_FAULT";
        case EventType::SensorRecovered: return "SENSOR_RECOVERED";
        case EventType::ButtonPressed: return "BUTTON_PRESSED";
        case EventType::OverrideSet: return "OVERRIDE_SET";
        default: return "OVERRIDE_CLEARED";
    }
}

const char* severityName(const Event& e) {
    if (e.type == EventType::SensorFault) return "warning";
    if (e.type != EventType::StateChanged) return "info";
    if (e.to == State::Danger) return "critical";
    return e.to == State::Warning ? "warning" : "info";
}

const char* actuatorName(Actuator a) {
    return a == Actuator::Window ? "window" : "buzzer";
}

const char* sourceName(OverrideSource s) {
    switch (s) {
        case OverrideSource::Dashboard: return "dashboard";
        case OverrideSource::Ai: return "ai";
        case OverrideSource::Api: return "api";
        default: return "button";
    }
}

const char* clearReasonName(ClearReason r) {
    switch (r) {
        case ClearReason::Expired: return "expired";
        case ClearReason::Escalation: return "escalation";
        case ClearReason::Command: return "command";
        default: return "button";
    }
}

const char* pressName(Press p) {
    return p == Press::Short ? "short" : "long";
}

int formatReason(const Event& e, Reason bit, char* out, size_t size) {
    const bool escalation = e.to > e.from;
    const Thresholds& th = kLevels[(int)(escalation ? e.to : e.from)];
    const char* op = escalation ? ">=" : "<";
    switch (bit) {
        case kReasonTemperature:
            return snprintf(out, size, "temperature%s%.1f", op, escalation ? th.tempEnter : th.tempExit);
        case kReasonHumidity:
            return snprintf(out, size, "humidity%s%.0f", op, escalation ? th.humEnter : th.humExit);
        default:
            return snprintf(out, size, "airQuality%s%.0f", op, escalation ? th.aqEnter : th.aqExit);
    }
}

// ---- MovingAverage -----------------------------------------------------------

void MovingAverage::reset() {
    count_ = 0;
    next_ = 0;
}

void MovingAverage::push(float v) {
    buf_[next_] = v;
    next_ = (next_ + 1) % SMOOTH_WINDOW;
    if (count_ < SMOOTH_WINDOW) count_++;
}

float MovingAverage::value() const {
    if (count_ == 0) return NAN;
    float sum = 0;
    for (uint8_t i = 0; i < count_; i++) sum += buf_[i];
    return sum / count_;
}

// ---- Engine -------------------------------------------------------------------

void Engine::begin(uint32_t nowMs) {
    *this = Engine();
    enteredAtMs_ = nowMs;
    dhtValidAtMs_ = nowMs;  // the 10 s fault timer starts at boot (§7.2)
}

void Engine::pushAnalog(float light, float airQuality, bool presence) {
    if (inRange(light, 0.0f, LIGHT_MAX_LUX)) light_.push(light);
    if (inRange(airQuality, 0.0f, (float)AIR_QUALITY_MAX)) aq_.push(airQuality);
    presence_ = presence;
}

void Engine::pushDht(float temperature, float humidity, uint32_t nowMs) {
    if (inRange(temperature, TEMP_MIN, TEMP_MAX) && inRange(humidity, HUM_MIN, HUM_MAX)) {
        dhtValidAtMs_ = nowMs;
        if (dhtFault_) {
            dhtFault_ = false;
            Event e{};
            e.type = EventType::SensorRecovered;
            push(e);
        }
        temp_.push(temperature);
        hum_.push(humidity);
        return;
    }
    if (!dhtFault_ && (uint32_t)(nowMs - dhtValidAtMs_) > DHT_FAULT_AFTER_MS) {
        dhtFault_ = true;
        // Start fresh after recovery instead of averaging with pre-fault values.
        temp_.reset();
        hum_.reset();
        Event e{};
        e.type = EventType::SensorFault;
        push(e);
    }
}

float Engine::temperature() const {
    return dhtFault_ ? NAN : temp_.value();
}

float Engine::humidity() const {
    return dhtFault_ ? NAN : hum_.value();
}

void Engine::evaluate(uint32_t nowMs) {
    if (!ready()) return;
    const float t = temperature(), h = humidity(), aq = airQuality();

    State target = State::Normal;
    for (int level = (int)State::Danger; level > (int)State::Normal; level--) {
        if (enterReasons((State)level, t, h, aq)) {
            target = (State)level;
            break;
        }
    }

    if (target > state_) {
        changeState(target, enterReasons(target, t, h, aq), nowMs);  // escalate immediately
    } else if (target < state_ && exitAllowed(state_, t, h, aq) &&
               elapsed(nowMs, enteredAtMs_, MIN_STATE_HOLD_MS)) {
        const State from = state_;
        changeState((State)((int)state_ - 1), exitReasons(from), nowMs);  // one level per evaluation
    }
}

void Engine::changeState(State to, uint8_t reasons, uint32_t nowMs) {
    const State from = state_;
    state_ = to;
    enteredAtMs_ = nowMs;
    if (to == State::Warning) blinkStartMs_ = nowMs;

    Event e{};
    e.type = EventType::StateChanged;
    e.from = from;
    e.to = to;
    e.reasons = reasons;
    push(e);

    // §7.6 table: NORMAL closes, DANGER opens, the others hold.
    if (to == State::Normal) edgeWindow_ = 0;
    if (to == State::Danger) edgeWindow_ = WINDOW_ANGLE_MAX;

    // §7.6 rule 3: escalating above the level an override was set in ends it.
    if (to > from) {
        if (windowOv_.active && to > windowOv_.levelAtSet) endWindowOverride(ClearReason::Escalation);
        if (buzzerOv_.active && to > buzzerOv_.levelAtSet) endBuzzerOverride(ClearReason::Escalation);
    }
    if (!windowOv_.active) window_ = edgeWindow_;
}

void Engine::onButton(Press press, uint32_t nowMs) {
    Event e{};
    e.type = EventType::ButtonPressed;
    e.press = press;
    push(e);
    if (press == Press::Short) {
        overrideBuzzer(false, OverrideSource::Button, nowMs);
    } else {
        clearOverrides(ClearReason::Button);
    }
}

void Engine::overrideWindow(int angle, OverrideSource source, uint32_t nowMs) {
    if (angle < 0) angle = 0;
    if (angle > WINDOW_ANGLE_MAX) angle = WINDOW_ANGLE_MAX;
    windowOv_.active = true;
    windowOv_.setAtMs = nowMs;
    windowOv_.levelAtSet = state_;
    window_ = angle;

    Event e{};
    e.type = EventType::OverrideSet;
    e.actuator = Actuator::Window;
    e.value = angle;
    e.durationSec = MANUAL_OVERRIDE_SEC;
    e.source = source;
    push(e);
}

void Engine::overrideBuzzer(bool on, OverrideSource source, uint32_t nowMs) {
    buzzerOv_.active = true;
    buzzerOv_.value = on;
    buzzerOv_.setAtMs = nowMs;
    buzzerOv_.levelAtSet = state_;

    Event e{};
    e.type = EventType::OverrideSet;
    e.actuator = Actuator::Buzzer;
    e.value = on ? 1 : 0;
    e.durationSec = MANUAL_OVERRIDE_SEC;
    e.source = source;
    push(e);
}

void Engine::clearOverrides(ClearReason reason) {
    if (windowOv_.active) endWindowOverride(reason);
    if (buzzerOv_.active) endBuzzerOverride(reason);
}

void Engine::endWindowOverride(ClearReason reason) {
    windowOv_.active = false;
    // §7.6 rule 4 exception: escalation into a hold state never closes a window the
    // user opened.
    if (reason == ClearReason::Escalation && holdsWindow(state_) && window_ > edgeWindow_) {
        edgeWindow_ = window_;
    }
    window_ = edgeWindow_;

    Event e{};
    e.type = EventType::OverrideCleared;
    e.actuator = Actuator::Window;
    e.clearReason = reason;
    push(e);
}

void Engine::endBuzzerOverride(ClearReason reason) {
    buzzerOv_.active = false;

    Event e{};
    e.type = EventType::OverrideCleared;
    e.actuator = Actuator::Buzzer;
    e.clearReason = reason;
    push(e);
}

bool Engine::buzzerOn() const {
    return buzzerOv_.active ? buzzerOv_.value : state_ == State::Danger;
}

uint32_t Engine::overrideExpiresInSec(uint32_t nowMs) const {
    uint32_t leftMs = 0;
    for (const Override* ov : {&windowOv_, &buzzerOv_}) {
        if (!ov->active) continue;
        const uint32_t used = nowMs - ov->setAtMs;
        const uint32_t left = used >= kOverrideMs ? 0 : kOverrideMs - used;
        if (left > leftMs) leftMs = left;
    }
    return (leftMs + 999) / 1000;
}

Outputs Engine::tick(uint32_t nowMs) {
    if (windowOv_.active && elapsed(nowMs, windowOv_.setAtMs, kOverrideMs)) {
        endWindowOverride(ClearReason::Expired);
    }
    if (buzzerOv_.active && elapsed(nowMs, buzzerOv_.setAtMs, kOverrideMs)) {
        endBuzzerOverride(ClearReason::Expired);
    }

    // The pattern starts "on" whenever the logical alarm switches on.
    const bool alarm = buzzerOn();
    if (alarm && !buzzerWasOn_) buzzerStartMs_ = nowMs;
    buzzerWasOn_ = alarm;

    Outputs o{};
    o.green = state_ == State::Normal;
    o.yellow = state_ == State::Uncomfortable ||
               (state_ == State::Warning && ((nowMs - blinkStartMs_) / BLINK_HALF_PERIOD_MS) % 2 == 0);
    o.red = state_ == State::Danger;
    o.buzzerPin = alarm && ((nowMs - buzzerStartMs_) / BUZZER_HALF_PERIOD_MS) % 2 == 0;
    o.windowAngle = window_;
    return o;
}

// ---- Event queue ----------------------------------------------------------------

void Engine::push(const Event& e) {
    if (size_ == kQueueSize) {  // drop oldest
        head_ = (head_ + 1) % kQueueSize;
        size_--;
    }
    queue_[(head_ + size_) % kQueueSize] = e;
    size_++;
}

bool Engine::popEvent(Event& out) {
    if (size_ == 0) return false;
    out = queue_[head_];
    head_ = (head_ + 1) % kQueueSize;
    size_--;
    return true;
}

}  // namespace edge
