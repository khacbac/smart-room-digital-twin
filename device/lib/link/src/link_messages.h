#pragma once

// JSON bodies of the link-only frames (docs/link-protocol.md §4.2): HELLO, TIME,
// LINK_STATE. Frames that carry an MQTT payload (TELEMETRY, STATUS, EVENT, ACK,
// COMMAND) have no builder here: their payload is the §5 JSON from lib/protocol,
// forwarded byte for byte. HEARTBEAT and HELLO_REQUEST have an empty payload.
//
// Builders write into `out` and return the length, or 0 when it does not fit.
// Parsers return false on invalid JSON or a missing / out-of-range field.

#include <stddef.h>
#include <stdint.h>

namespace lnk {

const size_t kDeviceIdMax = 32;  // contracts DeviceId: ^[a-z0-9-]{3,32}$
const size_t kBootIdLen = 8;     // contracts BootId: ^[0-9a-f]{8}$
const size_t kFwMax = 32;

struct Hello {
    char deviceId[kDeviceIdMax + 1];
    char bootId[kBootIdLen + 1];
    char fw[kFwMax + 1];
};

// node → gateway, after boot and in reply to HELLO_REQUEST.
size_t buildHello(const char* deviceId, const char* bootId, const char* fw, char* out, size_t size);
bool parseHello(const uint8_t* payload, size_t len, Hello& out);

// gateway → node: epoch ms UTC once NTP has synced.
size_t buildTime(int64_t ts, char* out, size_t size);
bool parseTime(const uint8_t* payload, size_t len, int64_t& ts);

// gateway → node, also the gateway's heartbeat: whether it can reach the broker, its
// Wi-Fi RSSI (the node reports it in its status, §5.4), and the bootId of the node it
// registered from HELLO. The node only sends MQTT payloads while that bootId is its own.
struct LinkState {
    bool mqtt;
    bool hasRssi;
    int rssi;
    bool hasBootId;
    char bootId[kBootIdLen + 1];
};

size_t buildLinkState(const LinkState& s, char* out, size_t size);
bool parseLinkState(const uint8_t* payload, size_t len, LinkState& out);

}  // namespace lnk
