// Phase 3 MQTT communication (spec §19).
// Sensors → lib/edge_rules (smoothing, DHT fault, state machine, override) → LEDs,
// buzzer, servo and LCD (§7.6, §7.7). Non-blocking millis() scheduling as in §7.1.
// This loop only builds payloads (lib/protocol), hands them to the uplink (net.h) and
// handles the commands it returns. The uplink is MQTT on this board (net_task, env
// esp32-s3) or the UART link to a gateway (net_link, env node). The serial console
// still drives the overrides locally.

#include <Arduino.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <math.h>
#include <sys/time.h>

#include "actuators.h"
#include "commands.h"
#include "config.h"
#include "display.h"
#include "edge_rules.h"
#include "lcd_format.h"
#include "net.h"
#include "payloads.h"
#include "sensors.h"

static edge::Engine engine;
static proto::CommandHandler commands;

// Raw readings, only for the serial log (§4.6 LDR direction check).
static AnalogReading analog{};
static DhtReading dhtReading{false, NAN, NAN, "not read"};

static bool stateLog = true;

// ---- Serial log ----------------------------------------------------------------

static void printValue(const char* name, float v, int decimals) {
    if (isnan(v)) Serial.printf(" %s=null", name);
    else Serial.printf(" %s=%.*f", name, decimals, v);
}

// One line per telemetry interval, and right after a state change (like §5.3).
static void printState(uint32_t nowMs) {
    Serial.printf("[edge] %s", edge::stateName(engine.state()));
    printValue("t", engine.temperature(), 1);
    printValue("h", engine.humidity(), 1);
    printValue("light", engine.light(), 1);
    printValue("aq", engine.airQuality(), 1);
    Serial.printf(" pir=%d win=%d buzz=%d", engine.presence(), engine.windowAngle(), engine.buzzerOn());
    if (engine.windowOverridden() || engine.buzzerOverridden()) {
        Serial.printf(" ov=%s%s%s(%lus)", engine.windowOverridden() ? "window" : "",
                      engine.windowOverridden() && engine.buzzerOverridden() ? "+" : "",
                      engine.buzzerOverridden() ? "buzzer" : "",
                      (unsigned long)engine.overrideExpiresInSec(nowMs));
    }
    Serial.printf("%s\n", engine.dhtFault() ? " DHT_FAULT" : "");
}

static void printRaw() {
    Serial.printf("[raw] ldr adc=%u light=%.1f | aq adc=%u aq=%d | dht %s t=%.1f h=%.1f\n", analog.adcLdr,
                  analog.light, analog.adcAq, analog.airQuality, dhtReading.valid ? "ok" : dhtReading.status,
                  dhtReading.temperature, dhtReading.humidity);
}

// §5.5 field names, so the log reads like the MQTT events of Phase 3.
static void printEvent(const edge::Event& e) {
    Serial.printf("[event] %s %s", edge::eventTypeName(e.type), edge::severityName(e));
    switch (e.type) {
        case edge::EventType::StateChanged: {
            Serial.printf(" %s -> %s reasons=", edge::stateName(e.from), edge::stateName(e.to));
            const char* sep = "";
            for (uint8_t bit = 1; bit; bit <<= 1) {
                if (!(e.reasons & bit)) continue;
                char text[32];
                edge::formatReason(e, (edge::Reason)bit, text, sizeof(text));
                Serial.printf("%s%s", sep, text);
                sep = ",";
            }
            break;
        }
        case edge::EventType::SensorFault:
        case edge::EventType::SensorRecovered: Serial.print(" sensor=dht"); break;
        case edge::EventType::ButtonPressed: Serial.printf(" press=%s", edge::pressName(e.press)); break;
        case edge::EventType::OverrideSet:
            Serial.printf(" actuator=%s value=%d durationSec=%u source=%s", edge::actuatorName(e.actuator), e.value,
                          e.durationSec, edge::sourceName(e.source));
            break;
        case edge::EventType::OverrideCleared:
            Serial.printf(" actuator=%s reason=%s", edge::actuatorName(e.actuator),
                          edge::clearReasonName(e.clearReason));
            break;
    }
    Serial.println();
}

// ---- MQTT payloads (§5), handed to the uplink --------------------------------------

static char bootId[9];
static uint32_t seq = 0;  // §5.1: shared by telemetry and events, only incremented here
static bool bootSent = false;

static char payload[MQTT_PAYLOAD_MAX + 1];

// What a status publish reports, to publish right after it changes (§5.4).
struct StatusSnapshot {
    edge::State state;
    int windowAngle;
    bool buzzer, windowOv, buzzerOv, dhtFault;
    bool operator!=(const StatusSnapshot& o) const {
        return state != o.state || windowAngle != o.windowAngle || buzzer != o.buzzer || windowOv != o.windowOv ||
               buzzerOv != o.buzzerOv || dhtFault != o.dhtFault;
    }
};

static StatusSnapshot snapshot() {
    return {engine.state(),           engine.windowAngle(),      engine.buzzerOn(),
            engine.windowOverridden(), engine.buzzerOverridden(), engine.dhtFault()};
}

static StatusSnapshot lastStatus{};
static uint32_t lastStatusAt = 0;

// §5.1 header. `ts` is null until NTP has synced (§16: 64-bit math, time_t is 32-bit).
static proto::Meta meta(bool nextSeq) {
    proto::Meta m{DEVICE_ID, bootId, 0, false, 0};
    if (net::timeSynced()) {
        struct timeval tv;
        gettimeofday(&tv, nullptr);
        m.hasTs = true;
        m.ts = (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
    }
    if (nextSeq) m.seq = seq++;
    return m;
}

static const char* channelName(Channel ch) {
    switch (ch) {
        case Channel::Telemetry: return "telemetry";
        case Channel::Status: return "status";
        case Channel::Event: return "event";
        case Channel::Ack: return "ack";
    }
    return "?";
}

static void send(Channel ch, size_t len) {
    if (len == 0) {
        Serial.printf("[mqtt] %s payload too large, dropped\n", channelName(ch));
        return;
    }
    net::publish(ch, payload, len);
}

// D8: nothing is built or queued while offline (so no seq is used either).

static void publishTelemetry() {
    if (!net::online()) return;
    send(Channel::Telemetry, proto::buildTelemetry(engine, meta(true), payload, sizeof(payload)));
}

static void publishStatus(uint32_t nowMs) {
    lastStatus = snapshot();
    lastStatusAt = nowMs;
    if (!net::online()) return;
    const proto::StatusInfo info{FW_VERSION, (uint32_t)(esp_timer_get_time() / 1000000), net::rssi()};
    send(Channel::Status, proto::buildStatus(engine, meta(false), info, nowMs, payload, sizeof(payload)));
}

static void publishEvent(const edge::Event& e) {
    if (!net::online()) return;
    send(Channel::Event, proto::buildEvent(e, meta(true), payload, sizeof(payload)));
}

static const char* resetReasonName(esp_reset_reason_t r) {
    switch (r) {
        case ESP_RST_POWERON: return "POWERON";
        case ESP_RST_EXT: return "EXT";
        case ESP_RST_SW: return "SW";
        case ESP_RST_PANIC: return "PANIC";
        case ESP_RST_INT_WDT: return "INT_WDT";
        case ESP_RST_TASK_WDT: return "TASK_WDT";
        case ESP_RST_WDT: return "WDT";
        case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
        case ESP_RST_BROWNOUT: return "BROWNOUT";
        case ESP_RST_SDIO: return "SDIO";
        default: return "UNKNOWN";
    }
}

// §6.4 connect handshake: status on every connect, BOOT on the first one only.
static void onConnected(uint32_t nowMs) {
    publishStatus(nowMs);
    if (bootSent) return;
    bootSent = true;
    send(Channel::Event,
         proto::buildBootEvent(meta(true), FW_VERSION, resetReasonName(esp_reset_reason()), payload, sizeof(payload)));
}

// §5.6 / §5.7: validate → execute → status (retained) → ack (§6.6).
static void handleMqttCommand(const NetCommand& msg, uint32_t nowMs) {
    const proto::CommandResult r = commands.handle(engine, msg.payload, msg.len, nowMs);
    if (!r.ackable) {
        Serial.printf("[cmd] rejected, no parsable commandId: %.64s\n", msg.payload);
        if (net::online()) {
            send(Channel::Event,
                 proto::buildCommandRejectedEvent(meta(true), msg.payload, msg.len, payload, sizeof(payload)));
        }
        return;
    }
    const char* reason = proto::rejectReasonName(r.reason);
    Serial.printf("[cmd] %s -> %s%s%s%s\n", r.commandId, proto::ackStatusName(r.status), reason ? " " : "",
                  reason ? reason : "", r.duplicate ? " (duplicate, not re-executed)" : "");
    if (r.executed) publishStatus(nowMs);
    if (net::online()) send(Channel::Ack, proto::buildAck(engine, meta(false), r, nowMs, payload, sizeof(payload)));
}

// ---- Serial console: local stand-in for MQTT commands (§5.6) --------------------

static void printHelp() {
    Serial.println(
        "[cmd] commands (source=api, like §5.6):\n"
        "  help           this text\n"
        "  s              state + raw sensor values now\n"
        "  log 0|1        periodic [edge] line off/on\n"
        "  net            uplink state (MQTT or gateway link, clock, RSSI, drops)\n"
        "  open [1-90]    OPEN_WINDOW (default 90) → window override\n"
        "  close          CLOSE_WINDOW → window override\n"
        "  buzz on|off    BUZZER_ON / BUZZER_OFF → buzzer override\n"
        "  clear          CLEAR_OVERRIDE");
}

static void handleCommand(char* line, uint32_t nowMs) {
    char* cmd = strtok(line, " ");
    char* arg = strtok(nullptr, " ");
    if (!cmd) return;
    const auto src = edge::OverrideSource::Api;

    if (!strcmp(cmd, "help")) {
        printHelp();
    } else if (!strcmp(cmd, "s")) {
        printState(nowMs);
        printRaw();
    } else if (!strcmp(cmd, "net")) {
        Serial.printf("[net] bootId=%s seq=%lu\n", bootId, (unsigned long)seq);
        net::printStats();
    } else if (!strcmp(cmd, "log") && arg) {
        stateLog = atoi(arg) != 0;
    } else if (!strcmp(cmd, "open")) {
        const int angle = arg ? atoi(arg) : WINDOW_ANGLE_MAX;
        if (angle < 1 || angle > WINDOW_ANGLE_MAX) {
            Serial.println("[cmd] open: angle 1-90 (VALUE_OUT_OF_RANGE)");
            return;
        }
        engine.overrideWindow(angle, src, nowMs);
    } else if (!strcmp(cmd, "close")) {
        engine.overrideWindow(0, src, nowMs);
    } else if (!strcmp(cmd, "buzz") && arg && (!strcmp(arg, "on") || !strcmp(arg, "off"))) {
        engine.overrideBuzzer(!strcmp(arg, "on"), src, nowMs);
    } else if (!strcmp(cmd, "clear")) {
        engine.clearOverrides(edge::ClearReason::Command);
    } else {
        Serial.printf("[cmd] unknown: %s (type help)\n", cmd);
    }
}

static void pollConsole(uint32_t nowMs) {
    static char buf[64];
    static size_t len = 0;
    while (Serial.available()) {
        const char c = (char)Serial.read();
        if (c == '\r' || c == '\n') {
            if (len == 0) continue;
            buf[len] = '\0';
            Serial.printf("> %s\n", buf);
            len = 0;
            handleCommand(buf, nowMs);
        } else if (len < sizeof(buf) - 1) {
            buf[len++] = c;
        }
    }
}

// ---- Outputs + LCD ---------------------------------------------------------------

static void applyOutputs(const edge::Outputs& o) {
    actuators::setLed(Led::Green, o.green);
    actuators::setLed(Led::Yellow, o.yellow);
    actuators::setLed(Led::Red, o.red);
    actuators::setBuzzer(o.buzzerPin);
    actuators::setWindowAngle(o.windowAngle);
}

static void refreshLcd() {
    char row[24];
    edge::formatLcdRow0(engine, row, sizeof(row));
    display::setRow(0, row);
    edge::formatLcdRow1(engine, net::online(), row, sizeof(row));
    display::setRow(1, row);
}

// ---- Arduino entry points ----------------------------------------------------------

static uint32_t lastSampleAt = 0;
static uint32_t lastDhtAt = 0;
static uint32_t lastTelemetryAt = 0;
static uint32_t lastLcdAt = 0;
static uint32_t lastSysLogAt = 0;

void setup() {
    Serial.begin(115200);
    snprintf(bootId, sizeof(bootId), "%08lx", (unsigned long)esp_random());
    Serial.printf("\n[boot] fw=%s device=%s bootId=%s reset=%s\n", FW_VERSION, DEVICE_ID, bootId,
                  resetReasonName(esp_reset_reason()));

    actuators::begin();
    sensors::begin();
    display::begin();
    display::setRow(0, "digital-twin");
    display::setRow(1, "fw " FW_VERSION);

    const uint32_t now = millis();
    engine.begin(now);
    // Sample right away so the first evaluation does not wait a full interval.
    lastSampleAt = now - SAMPLE_INTERVAL_MS;
    lastDhtAt = now - DHT_INTERVAL_MS;
    lastTelemetryAt = now;
    lastLcdAt = now;  // keep the boot banner for one LCD interval
    lastStatus = snapshot();
    lastStatusAt = now;
    printHelp();

    net::begin(bootId);  // after the engine: commands may arrive as soon as the uplink is up
}

void loop() {
    const uint32_t now = millis();

    net::poll(now);
    if (net::takeConnected()) onConnected(now);

    pollConsole(now);

    switch (sensors::pollButton(now)) {
        case ButtonEvent::Short: engine.onButton(edge::Press::Short, now); break;
        case ButtonEvent::Long: engine.onButton(edge::Press::Long, now); break;
        case ButtonEvent::None: break;
    }

    if (now - lastDhtAt >= DHT_INTERVAL_MS) {
        lastDhtAt = now;
        const bool wasValid = dhtReading.valid;
        dhtReading = sensors::readDht();
        if (wasValid && !dhtReading.valid) Serial.printf("[dht] read failed: %s\n", dhtReading.status);
        engine.pushDht(dhtReading.valid ? dhtReading.temperature : NAN,
                       dhtReading.valid ? dhtReading.humidity : NAN, now);
    }

    const edge::State before = engine.state();
    if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
        lastSampleAt = now;
        analog = sensors::readAnalog();
        engine.pushAnalog(analog.light, (float)analog.airQuality, sensors::readPresence());
        engine.evaluate(now);  // §7.1: after each sample
    }

    static NetCommand cmd;
    while (net::popCommand(cmd)) handleMqttCommand(cmd, now);

    applyOutputs(engine.tick(now));

    edge::Event e;
    while (engine.popEvent(e)) {
        printEvent(e);
        publishEvent(e);
    }

    // §5.3: periodic, plus immediately after a STATE_CHANGED (the timer restarts from it).
    const bool stateChanged = engine.state() != before;
    if (engine.ready() && (stateChanged || now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS)) {
        lastTelemetryAt = now;
        publishTelemetry();
        if (stateLog || stateChanged) printState(now);
    }

    // §5.4: heartbeat, plus right after an actuator/override (or state/fault) change.
    if (snapshot() != lastStatus || now - lastStatusAt >= STATUS_INTERVAL_MS) publishStatus(now);

    if (now - lastLcdAt >= LCD_INTERVAL_MS) {
        lastLcdAt = now;
        refreshLcd();
    }

    if (now - lastSysLogAt >= SYS_LOG_INTERVAL_MS) {
        lastSysLogAt = now;
        Serial.printf("[sys] up=%lus heap=%u min=%u\n", (unsigned long)(now / 1000), ESP.getFreeHeap(),
                      ESP.getMinFreeHeap());
    }
}
