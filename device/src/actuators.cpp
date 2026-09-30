#include "actuators.h"

#include <Arduino.h>

#include "config.h"

#if !defined(BOARD_KIT)
#include <ESP32Servo.h>
static Servo servo;
#endif

static bool ledState[3] = {false, false, false};
static int angle = -1;  // unknown until the first write
static bool buzzerOn = false;

static uint8_t ledPin(Led led) {
    switch (led) {
        case Led::Green: return PIN_LED_GREEN;
        case Led::Yellow: return PIN_LED_YELLOW;
        default: return PIN_LED_RED;
    }
}

#if defined(BOARD_KIT)
// The relay is on/off: any angle > 0 opens the window. The reported angle stays the
// commanded one (the engine's), so MQTT and the dashboard do not change.
static void writeRelay(bool on) {
    digitalWrite(PIN_RELAY_WINDOW, on == !RELAY_ACTIVE_LOW ? HIGH : LOW);
}
#endif

namespace actuators {

void begin() {
    pinMode(PIN_LED_GREEN, OUTPUT);
    pinMode(PIN_LED_YELLOW, OUTPUT);
    pinMode(PIN_LED_RED, OUTPUT);

#if defined(BOARD_KIT)
    writeRelay(false);  // level first, so the relay does not click on at boot
    pinMode(PIN_RELAY_WINDOW, OUTPUT);
#else
    // §4.7 LEDC sharing: the servo gets timer 0 before anything else touches LEDC,
    // the buzzer uses the core 2.x LEDC API on channel 6 (timer 3).
    ESP32PWM::allocateTimer(SERVO_TIMER);
    servo.setPeriodHertz(50);
    servo.attach(PIN_SERVO, SERVO_MIN_US, SERVO_MAX_US);
#endif

    ledcSetup(BUZZER_LEDC_CHANNEL, BUZZER_FREQ_HZ, 8);
    ledcAttachPin(PIN_BUZZER, BUZZER_LEDC_CHANNEL);
    ledcWriteTone(BUZZER_LEDC_CHANNEL, 0);

    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_YELLOW, LOW);
    digitalWrite(PIN_LED_RED, LOW);
    setWindowAngle(0);
}

void setLed(Led led, bool on) {
    if (ledState[(int)led] == on) return;
    ledState[(int)led] = on;
    digitalWrite(ledPin(led), on ? HIGH : LOW);
}

bool led(Led led) {
    return ledState[(int)led];
}

void setWindowAngle(int deg) {
    deg = constrain(deg, 0, WINDOW_ANGLE_MAX);
    if (deg == angle) return;
    angle = deg;
#if defined(BOARD_KIT)
    writeRelay(angle > 0);
#else
    servo.write(angle);
#endif
}

int windowAngle() {
    return angle;
}

void setBuzzer(bool on) {
    if (on == buzzerOn) return;
    buzzerOn = on;
    ledcWriteTone(BUZZER_LEDC_CHANNEL, on ? BUZZER_FREQ_HZ : 0);
}

bool buzzer() {
    return buzzerOn;
}

}  // namespace actuators
