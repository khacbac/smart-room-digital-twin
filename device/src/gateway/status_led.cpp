#include "status_led.h"

#include <Arduino.h>

#include "config.h"

namespace status_led {

struct Rgb {
    uint8_t r, g, b;
    bool operator==(const Rgb& o) const { return r == o.r && g == o.g && b == o.b; }
};

static constexpr uint8_t L = STATUS_RGB_LEVEL;
static constexpr Rgb kOff{0, 0, 0};
static constexpr Rgb kRed{L, 0, 0};
static constexpr Rgb kYellow{L, (uint8_t)(L * 2 / 3), 0};
static constexpr Rgb kGreen{0, L, 0};

static Rgb shown{1, 1, 1};  // not a colour we use: the first update() always writes

// neopixelWrite() sends 24 bits over RMT each call: only when the colour changes.
static void show(const Rgb& c) {
    if (c == shown) return;
    shown = c;
    neopixelWrite(PIN_STATUS_RGB, c.r, c.g, c.b);
}

void begin() { show(kRed); }

void update(bool wifiUp, bool mqttUp, bool nodeUp, uint32_t nowMs) {
    const Rgb colour = !wifiUp ? kRed : !mqttUp ? kYellow : kGreen;
    const bool dark = !nodeUp && (nowMs / STATUS_RGB_BLINK_MS) % 2;
    show(dark ? kOff : colour);
}

}  // namespace status_led
