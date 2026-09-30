#include "payloads.h"

#include <ArduinoJson.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

namespace proto {

namespace {

const size_t kRawMax = 128;  // COMMAND_REJECTED `raw` (§5.5)

// Writes `doc` to `out`; 0 when it does not fit in `size` or MQTT_PAYLOAD_MAX.
size_t finish(const JsonDocument& doc, char* out, size_t size) {
    const size_t n = measureJson(doc);
    if (n >= size || n > MQTT_PAYLOAD_MAX) return 0;
    return serializeJson(doc, out, size);
}

// §5.3: rounded to 1 decimal; NaN → null.
void setRounded(JsonDocument& doc, const char* key, float v) {
    if (isnan(v)) doc[key] = nullptr;
    else doc[key] = round(v * 10.0) / 10.0;
}

void setTs(JsonDocument& doc, const Meta& meta) {
    if (meta.hasTs) doc["ts"] = meta.ts;
    else doc["ts"] = nullptr;
}

// v, deviceId, bootId, seq, ts: the telemetry/event header (§5.1).
void setHeader(JsonDocument& doc, const Meta& meta) {
    doc["v"] = 1;
    doc["deviceId"] = meta.deviceId;
    doc["bootId"] = meta.bootId;
    doc["seq"] = meta.seq;
    setTs(doc, meta);
}

void setActuators(JsonDocument& doc, const edge::Engine& engine) {
    JsonObject a = doc["actuators"].to<JsonObject>();
    a["windowAngle"] = engine.windowAngle();
    a["buzzer"] = engine.buzzerOn();  // logical alarm state, not the pin (§5.3)
}

// `override` with expiresInSec (status, ack).
void setOverride(JsonDocument& doc, const edge::Engine& engine, uint32_t nowMs) {
    JsonObject o = doc["override"].to<JsonObject>();
    o["window"] = engine.windowOverridden();
    o["buzzer"] = engine.buzzerOverridden();
    o["expiresInSec"] = engine.overrideExpiresInSec(nowMs);
}

void setEventKind(JsonDocument& doc, const char* type, const char* severity, const char* message) {
    doc["type"] = type;
    doc["severity"] = severity;
    doc["message"] = message;
}

}  // namespace

size_t buildTelemetry(const edge::Engine& engine, const Meta& meta, char* out, size_t size) {
    JsonDocument doc;
    setHeader(doc, meta);
    setRounded(doc, "temperature", engine.temperature());
    setRounded(doc, "humidity", engine.humidity());
    setRounded(doc, "light", engine.light());
    setRounded(doc, "airQuality", engine.airQuality());
    doc["presence"] = engine.presence();
    doc["edgeState"] = edge::stateName(engine.state());
    setActuators(doc, engine);
    JsonObject o = doc["override"].to<JsonObject>();
    o["window"] = engine.windowOverridden();
    o["buzzer"] = engine.buzzerOverridden();
    return finish(doc, out, size);
}

size_t buildStatus(const edge::Engine& engine, const Meta& meta, const StatusInfo& info, uint32_t nowMs,
                   char* out, size_t size) {
    JsonDocument doc;
    doc["v"] = 1;
    doc["deviceId"] = meta.deviceId;
    doc["online"] = true;
    doc["bootId"] = meta.bootId;
    setTs(doc, meta);
    doc["fw"] = info.fw;
    doc["uptimeSec"] = info.uptimeSec;
    doc["rssi"] = info.rssi;
    doc["edgeState"] = edge::stateName(engine.state());
    setActuators(doc, engine);
    setOverride(doc, engine, nowMs);
    doc["sensorFault"]["dht"] = engine.dhtFault();
    return finish(doc, out, size);
}

size_t buildEvent(const edge::Event& e, const Meta& meta, char* out, size_t size) {
    JsonDocument doc;
    setHeader(doc, meta);
    const char* type = edge::eventTypeName(e.type);
    const char* severity = edge::severityName(e);
    char message[64];
    JsonObject data = doc["data"].to<JsonObject>();

    switch (e.type) {
        case edge::EventType::StateChanged: {
            snprintf(message, sizeof(message), "%s -> %s", edge::stateName(e.from), edge::stateName(e.to));
            data["from"] = edge::stateName(e.from);
            data["to"] = edge::stateName(e.to);
            JsonArray reasons = data["reasons"].to<JsonArray>();
            for (uint8_t bit = 1; bit; bit <<= 1) {
                if (!(e.reasons & bit)) continue;
                char text[32];
                edge::formatReason(e, (edge::Reason)bit, text, sizeof(text));
                reasons.add(text);  // copied into the document
            }
            break;
        }
        case edge::EventType::SensorFault:
            snprintf(message, sizeof(message), "DHT22 invalid for > %u s", (unsigned)(DHT_FAULT_AFTER_MS / 1000));
            data["sensor"] = "dht";
            break;
        case edge::EventType::SensorRecovered:
            snprintf(message, sizeof(message), "DHT22 valid again");
            data["sensor"] = "dht";
            break;
        case edge::EventType::ButtonPressed:
            snprintf(message, sizeof(message), "button %s press", edge::pressName(e.press));
            data["press"] = edge::pressName(e.press);
            break;
        case edge::EventType::OverrideSet:
            if (e.actuator == edge::Actuator::Window) {
                snprintf(message, sizeof(message), "window override %d deg for %u s (%s)", e.value,
                         (unsigned)e.durationSec, edge::sourceName(e.source));
                data["value"] = e.value;
            } else {
                snprintf(message, sizeof(message), "buzzer override %s for %u s (%s)", e.value ? "on" : "off",
                         (unsigned)e.durationSec, edge::sourceName(e.source));
                data["value"] = e.value != 0;
            }
            data["actuator"] = edge::actuatorName(e.actuator);
            data["durationSec"] = e.durationSec;
            data["source"] = edge::sourceName(e.source);
            break;
        case edge::EventType::OverrideCleared:
            snprintf(message, sizeof(message), "%s override cleared (%s)", edge::actuatorName(e.actuator),
                     edge::clearReasonName(e.clearReason));
            data["actuator"] = edge::actuatorName(e.actuator);
            data["reason"] = edge::clearReasonName(e.clearReason);
            break;
    }

    setEventKind(doc, type, severity, message);  // copies `message`
    return finish(doc, out, size);
}

size_t buildBootEvent(const Meta& meta, const char* fw, const char* resetReason, char* out, size_t size) {
    JsonDocument doc;
    setHeader(doc, meta);
    char message[48];
    snprintf(message, sizeof(message), "boot fw %s (%s)", fw, resetReason);
    setEventKind(doc, "BOOT", "info", message);
    doc["data"]["fw"] = fw;
    doc["data"]["resetReason"] = resetReason;
    return finish(doc, out, size);
}

size_t buildCommandRejectedEvent(const Meta& meta, const char* raw, size_t rawLen, char* out, size_t size) {
    JsonDocument doc;
    setHeader(doc, meta);
    setEventKind(doc, "COMMAND_REJECTED", "warning", "command without a parsable commandId");
    // First 128 chars; NULs would end the string early, so they become '?'.
    char text[kRawMax + 1];
    const size_t n = rawLen < kRawMax ? rawLen : kRawMax;
    for (size_t i = 0; i < n; i++) text[i] = raw[i] ? raw[i] : '?';
    text[n] = '\0';
    doc["data"]["raw"] = text;
    return finish(doc, out, size);
}

size_t buildAck(const edge::Engine& engine, const Meta& meta, const CommandResult& result, uint32_t nowMs,
                char* out, size_t size) {
    JsonDocument doc;
    doc["v"] = 1;
    doc["deviceId"] = meta.deviceId;
    doc["commandId"] = result.commandId;
    doc["status"] = ackStatusName(result.status);
    const char* reason = rejectReasonName(result.reason);
    if (reason) doc["reason"] = reason;
    else doc["reason"] = nullptr;
    setTs(doc, meta);
    setActuators(doc, engine);
    setOverride(doc, engine, nowMs);
    return finish(doc, out, size);
}

}  // namespace proto
