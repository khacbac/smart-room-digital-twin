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

// Debounced INPUT_PULLUP button. Long fires once when held for BUTTON_LONG_PRESS_MS,
// Short fires on release before that.
struct Button {
    uint8_t pin;
    bool rawDown = false;
    bool stableDown = false;
    uint32_t rawChangedAt = 0;
    uint32_t pressedAt = 0;
    bool longFired = false;

    explicit Button(uint8_t p) : pin(p) {}

    ButtonEvent poll(uint32_t nowMs) {
        const bool down = digitalRead(pin) == LOW;
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
};

static Button modeButton(PIN_BUTTON);

#if defined(BOARD_KIT) && KIT_MQ135

// §4.6 for a real sensor: relative index, clean air → MQ135_CLEAN_AQ.
static int mq135ToAirQuality(uint16_t adc, uint32_t nowMs) {
    if (nowMs < MQ135_WARMUP_MS) return MQ135_CLEAN_AQ;
    const float span = (float)(ADC_MAX - MQ135_CLEAN_ADC);
    const float aq = MQ135_CLEAN_AQ + (adc - (float)MQ135_CLEAN_ADC) / span * (AIR_QUALITY_MAX - MQ135_CLEAN_AQ);
    return constrain((int)lroundf(aq), 0, AIR_QUALITY_MAX);
}

#elif defined(BOARD_KIT)

// No air sensor yet: two buttons step a simulated air quality instead, which keeps
// UNCOMFORTABLE / WARNING / DANGER reachable by hand (§4.6).
static Button aqUp(PIN_AQ_UP);
static Button aqDown(PIN_AQ_DOWN);
static int airQuality = AQ_START;

static void pollAirQualityButtons(uint32_t nowMs) {
    int step = 0;
    if (aqUp.poll(nowMs) == ButtonEvent::Short) step += AQ_STEP;
    if (aqDown.poll(nowMs) == ButtonEvent::Short) step -= AQ_STEP;
    if (step == 0) return;
    airQuality = constrain(airQuality + step, 0, AIR_QUALITY_MAX);
    Serial.printf("[aq] %d\n", airQuality);
}

#else

static int potToAirQuality(uint16_t adc) {
    return (int)lroundf(adc / (float)ADC_MAX * AIR_QUALITY_MAX);
}

#endif

namespace sensors {

void begin() {
    analogReadResolution(12);
    pinMode(PIN_PIR, INPUT);
    pinMode(PIN_BUTTON, INPUT_PULLUP);
#if defined(BOARD_KIT)
    pinMode(PIN_IR, INPUT);  // the module has its own pull-up
#if !KIT_MQ135
    pinMode(PIN_AQ_UP, INPUT_PULLUP);
    pinMode(PIN_AQ_DOWN, INPUT_PULLUP);
#endif
    dht.setup(PIN_DHT, DHTesp::DHT11);
#else
    dht.setup(PIN_DHT, DHTesp::DHT22);
#endif
}

AnalogReading readAnalog() {
    AnalogReading r;
    r.adcLdr = analogRead(PIN_LDR);
    r.light = ldrToLux(r.adcLdr);
#if defined(BOARD_KIT) && KIT_MQ135
    r.adcAq = analogRead(PIN_MQ135);
    r.airQuality = mq135ToAirQuality(r.adcAq, millis());
#elif defined(BOARD_KIT)
    r.adcAq = 0;
    r.airQuality = airQuality;
#else
    r.adcAq = analogRead(PIN_POT);
    r.airQuality = potToAirQuality(r.adcAq);
#endif
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
#if defined(BOARD_KIT)
    // PIR misses someone sitting still; the IR module catches a person at the desk.
    return digitalRead(PIN_PIR) == HIGH || digitalRead(PIN_IR) == LOW;
#else
    return digitalRead(PIN_PIR) == HIGH;
#endif
}

ButtonEvent pollButton(uint32_t nowMs) {
#if defined(BOARD_KIT) && !KIT_MQ135
    pollAirQualityButtons(nowMs);
#endif
    return modeButton.poll(nowMs);
}

}  // namespace sensors
