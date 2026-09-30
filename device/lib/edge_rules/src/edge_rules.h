#pragma once

// Edge rule engine (spec §7.2–§7.6): smoothing, DHT fault handling, the state machine
// with hysteresis, actuator actions and manual override (D2).
//
// Plain C++ with no Arduino includes, so `pio test -e native` can build it (§7.1).
// Time comes in as `nowMs` (millis(), wrap-safe), and actuator outputs come back as
// a struct; src/ writes them to the pins. Null inputs are NaN.

#include <stddef.h>
#include <stdint.h>

#include "config.h"

namespace edge {

// Ordered by level (§7.3), so `>` means "more severe".
enum class State : uint8_t { Normal = 0, Uncomfortable = 1, Warning = 2, Danger = 3 };

enum class Actuator : uint8_t { Window, Buzzer };
// CommandSource (§5.2) plus the local button.
enum class OverrideSource : uint8_t { Dashboard, Ai, Api, Button };
enum class ClearReason : uint8_t { Expired, Escalation, Command, Button };
enum class Press : uint8_t { Short, Long };

enum class EventType : uint8_t {
    StateChanged,
    SensorFault,
    SensorRecovered,
    ButtonPressed,
    OverrideSet,
    OverrideCleared,
};

// Bits in Event::reasons: the inputs behind a STATE_CHANGED.
enum Reason : uint8_t {
    kReasonTemperature = 1 << 0,
    kReasonHumidity = 1 << 1,
    kReasonAirQuality = 1 << 2,
};

// §5.5. Only the fields of the given type are meaningful.
struct Event {
    EventType type;
    // StateChanged. reasons = ENTER conditions of `to` that hold (escalation), or the
    // EXIT conditions of `from` (step-down).
    State from;
    State to;
    uint8_t reasons;
    // ButtonPressed
    Press press;
    // OverrideSet / OverrideCleared
    Actuator actuator;
    int value;  // OverrideSet: window angle, or buzzer 0/1
    uint16_t durationSec;
    OverrideSource source;
    ClearReason clearReason;
};

// Pin levels for one moment (§7.6). windowAngle is the servo target.
struct Outputs {
    bool green;
    bool yellow;
    bool red;
    bool buzzerPin;  // the 500 ms pattern, not the logical alarm state
    int windowAngle;
};

const char* stateName(State s);   // contract names (§5.2): "NORMAL", "UNCOMFORTABLE", …
const char* stateLabel(State s);  // LCD labels (§7.7), max 8 chars: "UNCOMF"
const char* eventTypeName(EventType t);
const char* severityName(const Event& e);  // "info" | "warning" | "critical" (§5.5)
const char* actuatorName(Actuator a);
const char* sourceName(OverrideSource s);
const char* clearReasonName(ClearReason r);
const char* pressName(Press p);

// One reason as in §5.5, e.g. "airQuality>=900" or "temperature<33.0".
// `bit` is one Reason bit set in e.reasons. Returns the snprintf length.
int formatReason(const Event& e, Reason bit, char* out, size_t size);

// Moving average over the last SMOOTH_WINDOW pushed values (§7.2).
class MovingAverage {
public:
    void reset();
    void push(float v);
    bool empty() const { return count_ == 0; }
    float value() const;  // NaN when empty

private:
    float buf_[SMOOTH_WINDOW] = {};
    uint8_t count_ = 0;
    uint8_t next_ = 0;
};

class Engine {
public:
    // Boot: NORMAL, window closed, fault timer starts (§7.2).
    void begin(uint32_t nowMs);

    // §7.2 preprocessing. NaN and out-of-range values (§5.3) are discarded and keep
    // the previous smoothed value.
    void pushAnalog(float light, float airQuality, bool presence);
    void pushDht(float temperature, float humidity, uint32_t nowMs);  // NaN on read error

    // §7.5, once after each sample. No-op until the analog channels have a sample.
    void evaluate(uint32_t nowMs);

    // §7.6 push button: short = mute (buzzer override OFF), long = clear all overrides.
    void onButton(Press press, uint32_t nowMs);

    // §7.6 override rule 1. The angle is clamped to 0…WINDOW_ANGLE_MAX.
    void overrideWindow(int angle, OverrideSource source, uint32_t nowMs);
    void overrideBuzzer(bool on, OverrideSource source, uint32_t nowMs);
    void clearOverrides(ClearReason reason);

    // Override expiry and the blink/buzzer patterns. Call every loop.
    Outputs tick(uint32_t nowMs);

    // Events in the order they happened (queue of 8, oldest dropped when full).
    bool popEvent(Event& out);

    State state() const { return state_; }
    bool ready() const { return !aq_.empty() && !light_.empty(); }  // §5.3

    // Smoothed values used by the rules. NaN = null (DHT fault, or no valid reading yet).
    float temperature() const;
    float humidity() const;
    float light() const { return light_.value(); }
    float airQuality() const { return aq_.value(); }
    bool presence() const { return presence_; }
    bool dhtFault() const { return dhtFault_; }

    int windowAngle() const { return window_; }
    int edgeWindowAngle() const { return edgeWindow_; }
    bool buzzerOn() const;  // logical alarm state (§5.3)
    bool windowOverridden() const { return windowOv_.active; }
    bool buzzerOverridden() const { return buzzerOv_.active; }
    uint32_t overrideExpiresInSec(uint32_t nowMs) const;  // max over active overrides, 0 if none

private:
    struct Override {
        bool active = false;
        bool value = false;  // buzzer only
        uint32_t setAtMs = 0;
        State levelAtSet = State::Normal;
    };

    void changeState(State to, uint8_t reasons, uint32_t nowMs);
    void endWindowOverride(ClearReason reason);
    void endBuzzerOverride(ClearReason reason);
    void push(const Event& e);

    State state_ = State::Normal;
    uint32_t enteredAtMs_ = 0;
    uint32_t blinkStartMs_ = 0;
    uint32_t buzzerStartMs_ = 0;
    bool buzzerWasOn_ = false;

    MovingAverage temp_, hum_, light_, aq_;
    bool presence_ = false;
    bool dhtFault_ = false;
    uint32_t dhtValidAtMs_ = 0;

    int window_ = 0;
    int edgeWindow_ = 0;  // last angle set by the edge engine (§7.6 rule 4)
    Override windowOv_, buzzerOv_;

    static const uint8_t kQueueSize = 8;
    Event queue_[kQueueSize] = {};
    uint8_t head_ = 0;
    uint8_t size_ = 0;
};

}  // namespace edge
