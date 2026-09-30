#include "sensors.h"

#include <Arduino.h>
#include <DHTesp.h>
#include <math.h>

#include "config.h"

static DHTesp dht;

// §4.6: Wokwi photoresistor formula adapted to the 12-bit ADC and 3.3 V supply.
// Divider: voltage = VREF * R / (R + R_fixed)  →  R = R_fixed * voltage / (VREF - voltage).
// (Wokwi's Arduino example writes this as 2000 * V / (1 - V / 5), where 2000 = 10 kΩ / 5 V;
// keeping 2000 at 3.3 V made every reading about 1.8× too bright.)
static float ldrToLux(uint16_t adc) {
    if (LDR_INVERT) adc = ADC_MAX - adc;
    const float voltage = adc / (float)ADC_MAX * ADC_VREF;
    if (voltage >= ADC_VREF) return 0.0f;
    if (voltage <= 0.0f) return LIGHT_MAX_LUX;
    const float resistance = LDR_FIXED_OHM * voltage / (ADC_VREF - voltage);
    const float lux = powf(LDR_RL10 * 1e3f * powf(10.0f, LDR_GAMMA) / resistance, 1.0f / LDR_GAMMA);
    return constrain(lux, 0.0f, LIGHT_MAX_LUX);
}

static int potToAirQuality(uint16_t adc) {
    return (int)lroundf(adc / (float)ADC_MAX * AIR_QUALITY_MAX);
}

namespace sensors {

void begin() {
    analogReadResolution(12);
    pinMode(PIN_PIR, INPUT);
    pinMode(PIN_BUTTON, INPUT_PULLUP);
    dht.setup(PIN_DHT, DHTesp::DHT22);
}

AnalogReading readAnalog() {
    AnalogReading r;
    r.adcLdr = analogRead(PIN_LDR);
    r.adcPot = analogRead(PIN_POT);
    r.light = ldrToLux(r.adcLdr);
    r.airQuality = potToAirQuality(r.adcPot);
    return r;
}

DhtReading readDht() {
    const TempAndHumidity th = dht.getTempAndHumidity();
    DhtReading r;
    r.temperature = th.temperature;
    r.humidity = th.humidity;
    r.status = dht.getStatusString();
    r.valid = dht.getStatus() == DHTesp::ERROR_NONE && !isnan(th.temperature) && !isnan(th.humidity);
    return r;
}

bool readPresence() {
    return digitalRead(PIN_PIR) == HIGH;
}

ButtonEvent pollButton(uint32_t nowMs) {
    static bool rawDown = false;
    static bool stableDown = false;
    static uint32_t rawChangedAt = 0;
    static uint32_t pressedAt = 0;
    static bool longFired = false;

    const bool down = digitalRead(PIN_BUTTON) == LOW;
    if (down != rawDown) {
        rawDown = down;
        rawChangedAt = nowMs;
    }

    if (rawDown != stableDown && nowMs - rawChangedAt >= BUTTON_DEBOUNCE_MS) {
        stableDown = rawDown;
        if (stableDown) {
            pressedAt = nowMs;
            longFired = false;
        } else if (!longFired) {
            return ButtonEvent::Short;
        }
    }

    if (stableDown && !longFired && nowMs - pressedAt >= BUTTON_LONG_PRESS_MS) {
        longFired = true;
        return ButtonEvent::Long;
    }
    return ButtonEvent::None;
}

}  // namespace sensors
