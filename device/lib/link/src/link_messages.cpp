#include "link_messages.h"

#include <ArduinoJson.h>
#include <string.h>

namespace lnk {

static size_t finish(const JsonDocument& doc, char* out, size_t size) {
    if (measureJson(doc) + 1 > size) return 0;
    return serializeJson(doc, out, size);
}

// Copies a JSON string of length [minLen, maxLen] into `dst` (maxLen + 1 bytes).
static bool copyString(JsonVariantConst v, size_t minLen, size_t maxLen, char* dst) {
    const char* s = v.as<const char*>();
    if (!v.is<const char*>() || s == nullptr) return false;
    const size_t n = strlen(s);
    if (n < minLen || n > maxLen) return false;
    memcpy(dst, s, n + 1);
    return true;
}

size_t buildHello(const char* deviceId, const char* bootId, const char* fw, char* out, size_t size) {
    JsonDocument doc;
    doc["deviceId"] = deviceId;
    doc["bootId"] = bootId;
    doc["fw"] = fw;
    return finish(doc, out, size);
}

bool parseHello(const uint8_t* payload, size_t len, Hello& out) {
    JsonDocument doc;
    if (deserializeJson(doc, payload, len)) return false;
    return copyString(doc["deviceId"], 3, kDeviceIdMax, out.deviceId) &&
           copyString(doc["bootId"], kBootIdLen, kBootIdLen, out.bootId) && copyString(doc["fw"], 1, kFwMax, out.fw);
}

size_t buildTime(int64_t ts, char* out, size_t size) {
    JsonDocument doc;
    doc["ts"] = ts;
    return finish(doc, out, size);
}

bool parseTime(const uint8_t* payload, size_t len, int64_t& ts) {
    JsonDocument doc;
    if (deserializeJson(doc, payload, len)) return false;
    JsonVariantConst v = doc["ts"];
    if (!v.is<int64_t>() || v.as<int64_t>() <= 0) return false;
    ts = v.as<int64_t>();
    return true;
}

size_t buildLinkState(const LinkState& s, char* out, size_t size) {
    JsonDocument doc;
    doc["mqtt"] = s.mqtt;
    if (s.hasRssi) doc["rssi"] = s.rssi;
    if (s.hasBootId) doc["bootId"] = s.bootId;
    return finish(doc, out, size);
}

bool parseLinkState(const uint8_t* payload, size_t len, LinkState& out) {
    JsonDocument doc;
    if (deserializeJson(doc, payload, len)) return false;
    if (!doc["mqtt"].is<bool>()) return false;
    out.mqtt = doc["mqtt"].as<bool>();
    out.hasRssi = doc["rssi"].is<int>();
    out.rssi = out.hasRssi ? doc["rssi"].as<int>() : 0;
    out.hasBootId = !doc["bootId"].isNull();
    out.bootId[0] = '\0';
    if (out.hasBootId && !copyString(doc["bootId"], kBootIdLen, kBootIdLen, out.bootId)) return false;
    return true;
}

}  // namespace lnk
