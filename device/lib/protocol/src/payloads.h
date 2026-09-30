#pragma once

// JSON payloads the device publishes (spec §5.3–§5.5, §5.7).
//
// Plain C++ + ArduinoJson (no Arduino includes), so `pio test -e native` builds it
// like lib/edge_rules. Every builder writes into `out` and returns the length, or 0
// when the payload does not fit (§6.5: at most MQTT_PAYLOAD_MAX bytes).

#include <stddef.h>
#include <stdint.h>

#include "commands.h"
#include "edge_rules.h"

namespace proto {

// §5.1 common fields. `seq` is only used by telemetry and events; `bootId` is not
// used by the ack.
struct Meta {
    const char* deviceId;
    const char* bootId;
    uint32_t seq;
    bool hasTs;  // false → "ts": null (NTP not synced yet)
    int64_t ts;  // epoch ms UTC
};

// Status-only fields (§5.4).
struct StatusInfo {
    const char* fw;
    uint32_t uptimeSec;
    int rssi;
};

// §5.3. Values are the smoothed ones, rounded to 1 decimal; temperature/humidity
// are null while there is no valid DHT22 value.
size_t buildTelemetry(const edge::Engine& engine, const Meta& meta, char* out, size_t size);

// §5.4, `online: true`. The LWT (`online: false`) is a static string in net_task.
size_t buildStatus(const edge::Engine& engine, const Meta& meta, const StatusInfo& info, uint32_t nowMs,
                   char* out, size_t size);

// §5.5 for an engine event (STATE_CHANGED, SENSOR_*, BUTTON_PRESSED, OVERRIDE_*).
size_t buildEvent(const edge::Event& e, const Meta& meta, char* out, size_t size);

// §5.5 BOOT: `{ fw, resetReason }`.
size_t buildBootEvent(const Meta& meta, const char* fw, const char* resetReason, char* out, size_t size);

// §5.5 COMMAND_REJECTED: `{ raw }` with the first 128 chars of the command payload.
size_t buildCommandRejectedEvent(const Meta& meta, const char* raw, size_t rawLen, char* out, size_t size);

// §5.7. Actuators and override are read from the engine after the command ran.
size_t buildAck(const edge::Engine& engine, const Meta& meta, const CommandResult& result, uint32_t nowMs,
                char* out, size_t size);

}  // namespace proto
