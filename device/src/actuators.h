#pragma once

// Pin-level output drivers (§4.3). No state logic here: lib/edge_rules computes the
// outputs (incl. blink and buzzer patterns) and main.cpp writes them through this API.
// Each setter only touches the pin when the value changes, so it can run every loop.

enum class Led { Green, Yellow, Red };

namespace actuators {

void begin();  // LEDs off, buzzer off, window closed

void setLed(Led led, bool on);
bool led(Led led);

void setWindowAngle(int deg);  // clamped to 0…WINDOW_ANGLE_MAX
int windowAngle();

void setBuzzer(bool on);  // tone on/off at the pin, not the logical alarm state
bool buzzer();

}  // namespace actuators
