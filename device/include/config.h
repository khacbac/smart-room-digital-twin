#pragma once

// Device config (spec §18). Every value can be overridden with -D in build_flags,
// so the D1 fallback (public broker + unique prefix) is a config-only switch.
// Simulator-specific values live here and in sensors.cpp only (§21).

#ifndef FW_VERSION
#define FW_VERSION "0.1.0"
#endif

#ifndef DEVICE_ID
#define DEVICE_ID "room-01"
#endif

// This file is plain preprocessor defines (no Arduino includes), so lib/edge_rules
// can include it in the native test build too.

// ---- Network (§6, net_task) ------------------------------------------------

#ifndef WIFI_SSID
#define WIFI_SSID "Wokwi-GUEST"
#endif
#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD ""
#endif
#ifndef WIFI_CHANNEL
#define WIFI_CHANNEL 6  // Wokwi-GUEST is on channel 6 (skips the scan); 0 = scan on real hardware
#endif

// D1 default: local Mosquitto reached through the Wokwi Private IoT Gateway.
#ifndef MQTT_HOST
#define MQTT_HOST "host.wokwi.internal"
#endif
#ifndef MQTT_PORT
#define MQTT_PORT 1883
#endif
#ifndef MQTT_TOPIC_PREFIX
#define MQTT_TOPIC_PREFIX "srdt"  // smart-room-digital-twin; keep in sync with server MQTT_TOPIC_PREFIX
#endif

#define MQTT_KEEPALIVE_SEC 15
#define MQTT_BUFFER_SIZE 1280  // §4.7: > 1024 B payload limit + header + topic
#define MQTT_PAYLOAD_MAX 1024  // §6.5
#define MQTT_TOPIC_MAX 64      // §6.4 queue item topic buffer
#define MQTT_SOCKET_TIMEOUT_SEC 3  // PubSubClient + WiFiClient (core 2.x setTimeout takes seconds)

#define NTP_SERVER "pool.ntp.org"
#define NTP_RETRY_MS 60000  // §16: retry every 60 s until the first sync

#define NET_BACKOFF_MIN_MS 1000   // §6.4: 1 s → 2 s → 4 s … capped at 30 s (Wi-Fi and MQTT)
#define NET_BACKOFF_MAX_MS 30000
#define WIFI_CONNECT_TIMEOUT_MS 10000  // one Wi-Fi attempt, then back off and retry
#define NET_TASK_STACK 8192       // bytes (§6.4: ≥ 8 KB)
#define NET_TASK_CORE 0           // D11: network on core 0, loop() on core 1
#define NET_TASK_PRIORITY 1
#define OUT_QUEUE_DEPTH 16        // loop → net, drop oldest when full
#define CMD_QUEUE_DEPTH 4         // net → loop

#define COMMAND_DEDUP_SIZE 16     // §5.7: last N commandIds with their ack result

// ---- Gateway ⇄ node link (env node and gateway, docs/link-protocol.md §6.1) -
// UART1 on the same free pins on both boards, cross-wired (TX → RX, RX → TX, common
// GND). For solo dev, a USB-UART adapter on these pins + tools/link-sim fake-gateway
// (on the node) or fake-node (on the gateway).

#ifndef PIN_LINK_RX
#define PIN_LINK_RX 4
#endif
#ifndef PIN_LINK_TX
#define PIN_LINK_TX 5
#endif
#ifndef LINK_BAUD
#define LINK_BAUD 115200
#endif
#define LINK_UART_BUFFER 2048     // each way, > one max stream frame (1035 B)

// Gateway status LED (docs/link-protocol.md §5.5): the DevKitC-1's onboard WS2812.
// GPIO48 on board v1.0, GPIO38 on v1.1 (-D PIN_STATUS_RGB=38). Gateway only: on the
// node GPIO38 is PIN_LED_GREEN.
#ifndef PIN_STATUS_RGB
#define PIN_STATUS_RGB 48
#endif
#define STATUS_RGB_LEVEL 16       // of 255: the bare LED is blinding at full power
#define STATUS_RGB_BLINK_MS 500   // half period: 1 Hz while the node is lost

// ---- Pins (§4.4) -----------------------------------------------------------
// Two hardware variants share every file except sensors.cpp, actuators.cpp and
// display.cpp:
//   default    ESP32-S3 DevKitC-1 + DHT22, LDR, pot, servo, LCD 1602 (Wokwi, diagram.json)
//   BOARD_KIT  classic ESP32 (ESP-32S / esp32dev) + the starter kit: DHT11, LDR module,
//              IR obstacle module, 3 buttons, 2-channel 5 V relay, OLED 0.96" SSD1306
//              (env kit, node-kit; wiring in docs/hardware-kit.md)

#if defined(BOARD_KIT)

// ADC1 only (ADC2 is unusable while Wi-Fi is active). GPIO34–39 are input-only and
// have no internal pull-ups, so the buttons are elsewhere. Avoids the strapping pins
// 0, 2, 12, 15 (GPIO5 is the link TX, which idles high like the pin wants at boot).
#define PIN_LDR 32         // light module AO, ADC1_CH4
#define PIN_DHT 16         // DHT11 module DATA
#define PIN_PIR 34         // HC-SR501 OUT (push-pull, 3.3 V)
#define PIN_IR 35          // IR obstacle module DO, LOW = something in front
#define PIN_BUTTON 13      // mode button (mute / clear), INPUT_PULLUP, active LOW
#define PIN_AQ_UP 14       // air quality +AQ_STEP (stands in for the pot), INPUT_PULLUP
#define PIN_AQ_DOWN 33     // air quality -AQ_STEP, INPUT_PULLUP
#define PIN_MQ135 36       // MQ-135 AO through a 10k/20k divider, ADC1_CH0 (input-only "VP")
#define PIN_RELAY_WINDOW 18  // relay IN1: energized = window open (angle > 0)
#define PIN_BUZZER 23      // passive buzzer (LEDC tone)
#define PIN_LED_GREEN 25   // "OK" LED: the kit has no green, a blue LED sits here
#define PIN_LED_YELLOW 26
#define PIN_LED_RED 27
#define PIN_I2C_SDA 21
#define PIN_I2C_SCL 22

#define RELAY_ACTIVE_LOW 1  // the common optocoupler relay boards pull in on IN = LOW
#define AQ_STEP 100         // one button press; 0 → DANGER (900) in 9 presses
#define AQ_START 200        // simulated air quality at boot (NORMAL)

// Air quality source: 0 = the AQ+/AQ- buttons, 1 = an MQ-135 on PIN_MQ135 (the buttons
// are then unused). The MQ-135 gives a relative index, not ppm: MQ135_CLEAN_ADC (the
// `[raw] aq adc=` value in clean air, after warm-up) maps to MQ135_CLEAN_AQ, a full
// scale ADC to AIR_QUALITY_MAX, linear in between.
#ifndef KIT_MQ135
#define KIT_MQ135 0
#endif
#define MQ135_CLEAN_ADC 1200
#define MQ135_CLEAN_AQ 200
#define MQ135_WARMUP_MS 120000  // the heater reads high at first; AQ holds at CLEAN_AQ till then

#define OLED_I2C_ADDR 0x3C  // 0x3D on some boards (address jumper on the back)
#define OLED_WIDTH 128
#define OLED_HEIGHT 64

#else

#define PIN_LDR 1          // ADC1_CH0 (ADC2 is unusable while Wi-Fi is active)
#define PIN_POT 2          // ADC1_CH1
#define PIN_DHT 15
#define PIN_PIR 16
#define PIN_BUTTON 17      // INPUT_PULLUP, active LOW
#define PIN_SERVO 18
#define PIN_BUZZER 21
#define PIN_LED_GREEN 38
#define PIN_LED_YELLOW 39
#define PIN_LED_RED 40
#define PIN_I2C_SDA 8
#define PIN_I2C_SCL 9

#endif

// ---- Actuators (§4.3, §4.7) ------------------------------------------------

#define LCD_I2C_ADDR 0x27
#define LCD_COLS 16
#define LCD_ROWS 2

#define SERVO_TIMER 0          // ESP32PWM::allocateTimer(0) → LEDC channels 0/1
#define SERVO_MIN_US 544
#define SERVO_MAX_US 2400
#define WINDOW_ANGLE_MAX 90    // 0° = closed, 90° = fully open

#define BUZZER_LEDC_CHANNEL 6  // core 2.x: timer = (channel / 2) % 4 = 3, unused by the servo
#define BUZZER_FREQ_HZ 2000

// ---- Timing (§7.1) ---------------------------------------------------------

#define SAMPLE_INTERVAL_MS 1000     // analog sensors + PIR, then rule evaluation
#define DHT_INTERVAL_MS 2000        // DHT22 max rate is 0.5 Hz (DHT11: 1 Hz)
#define TELEMETRY_INTERVAL_MS 2000  // MQTT telemetry + serial [edge] line (§5.3)
#define STATUS_INTERVAL_MS 30000    // retained status heartbeat (§5.4)
#define LCD_INTERVAL_MS 500
#define BLINK_HALF_PERIOD_MS 250    // yellow blink 2 Hz (WARNING)
#define BUZZER_HALF_PERIOD_MS 500   // DANGER pattern 500 ms on / 500 ms off
#define BUTTON_DEBOUNCE_MS 50
#define BUTTON_LONG_PRESS_MS 2000
#define SYS_LOG_INTERVAL_MS 10000   // uptime + heap line on serial

// ---- Sensor mapping (§4.6, Wokwi photoresistor module) ---------------------

#define ADC_MAX 4095
#define ADC_VREF 3.3f
#define LDR_FIXED_OHM 10000.0f  // the module's divider resistor (Wokwi's "2000" is 10 kΩ / 5 V)
#define LDR_RL10 50.0f
#define LDR_GAMMA 0.7f
#define LDR_INVERT 0          // set to 1 if the module's AO turns out inverted (§4.6)
#define LIGHT_MAX_LUX 100000.0f
#define AIR_QUALITY_MAX 1000

// ---- Valid ranges (§5.3), used by the invalid-value filter (§7.2) ---------

#define TEMP_MIN -40.0f
#define TEMP_MAX 80.0f
#define HUM_MIN 0.0f
#define HUM_MAX 100.0f

// ---- Edge rules (§7.2–§7.6), used by lib/edge_rules ------------------------

#define SMOOTH_WINDOW 3              // moving average over the last N valid samples
#define DHT_FAULT_AFTER_MS 10000     // DHT22 invalid for longer than this → SENSOR_FAULT
#define MIN_STATE_HOLD_MS 5000       // minimum time in a state before stepping down
#define MANUAL_OVERRIDE_SEC 120      // D2

// Enter when ANY condition holds, exit allowed when ALL exit conditions hold (§7.4).
#define DANGER_TEMP_ENTER 34.0f
#define DANGER_TEMP_EXIT 33.0f
#define DANGER_AQ_ENTER 900.0f
#define DANGER_AQ_EXIT 850.0f

#define WARNING_TEMP_ENTER 31.0f
#define WARNING_TEMP_EXIT 30.0f
#define WARNING_AQ_ENTER 700.0f
#define WARNING_AQ_EXIT 650.0f

#define UNCOMF_TEMP_ENTER 29.0f
#define UNCOMF_TEMP_EXIT 28.5f
#define UNCOMF_HUM_ENTER 75.0f
#define UNCOMF_HUM_EXIT 72.0f
#define UNCOMF_AQ_ENTER 500.0f
#define UNCOMF_AQ_EXIT 470.0f
