#pragma once

// Gateway side of the link (docs/link-protocol.md §5): registers the node from HELLO,
// answers with TIME + LINK_STATE (also the gateway heartbeat), keeps the node's
// presence, hands node payloads to MQTT byte for byte and forwards commands. Same
// logic as GatewayBridge in tools/link-sim/src/gateway.ts. The transport, the MQTT
// client and the clocks belong to the caller, so this builds and is tested on the host.

#include <stddef.h>
#include <stdint.h>

#include "link_frame.h"
#include "link_messages.h"
#include "link_peer.h"

#ifndef LINK_HELLO_REQUEST_MIN_MS
#define LINK_HELLO_REQUEST_MIN_MS 1000  // at most one HELLO_REQUEST per second (§5.2)
#endif
#ifndef LINK_TIME_RESYNC_MS
#define LINK_TIME_RESYNC_MS 600000  // TIME again every 10 min, the node has no NTP
#endif

namespace lnk {

// Where a node payload goes: {prefix}/{nodeId}/telemetry|status|event|command/ack.
// STATUS is QoS 1 retained, the others QoS 0 (§5.1).
enum class Uplink : uint8_t { Telemetry, Status, Event, Ack };
const char* uplinkName(Uplink u);  // "telemetry", "status", "event", "command/ack"

// Publishes one payload. false = not handed to the client (counted as dropped).
using PublishFn = bool (*)(Uplink topic, const uint8_t* payload, size_t len);

// UTC epoch ms, false while NTP has not synced yet (no TIME is sent until then).
using ClockFn = bool (*)(int64_t& epochMs);

// What onFrame() did, for the caller's log.
enum class GwRx : uint8_t {
    None,           // HEARTBEAT
    Hello,          // node registered: hello(), rebooted()
    HelloRefused,   // invalid HELLO, or another deviceId than the configured one
    Published,      // uplink handed to PublishFn
    Dropped,        // uplink while MQTT is down (no buffering, §5.1) or PublishFn failed
    NotRegistered,  // data before HELLO: dropped, HELLO_REQUEST sent (throttled)
    Invalid,        // gateway → node type, not from a node
};

// What onCommand() did.
enum class GwCmd : uint8_t { Forwarded, MqttDown, NodeDown, TooLong };

class GatewayLink {
public:
    struct Counters {
        uint32_t uplink;     // node payloads received after HELLO
        uint32_t published;  // … handed to PublishFn
        uint32_t dropped;    // every frame or command not delivered
        uint32_t commands;   // commands sent to the node
        uint32_t invalid;    // wrong direction, bad or refused HELLO
    };

    // `nodeId` is configured (like DEVICE_ID): the Last Will needs it before any HELLO.
    // Sends HELLO_REQUEST, then LINK_STATE. The string must outlive the object.
    void begin(const char* nodeId, FrameSink sink, PublishFn publish, ClockFn clock, uint32_t nowMs);

    // MQTT (re)connected or lost. Sends LINK_STATE; on (re)connect with the node down,
    // publishes the offline status again, since our Last Will may have replaced it.
    void setMqtt(bool up, uint32_t nowMs);
    // Wi-Fi RSSI for LINK_STATE; the node puts it in its status. Omitted until set.
    void setRssi(int rssi);
    void clearRssi() { hasRssi_ = false; }

    // A valid frame from the node.
    GwRx onFrame(const Frame& f, uint32_t nowMs);
    // A message on {prefix}/{nodeId}/command, forwarded untouched (§5.4).
    GwCmd onCommand(const uint8_t* payload, size_t len, uint32_t nowMs);
    // Every loop: node timeout (→ offline status), TIME, LINK_STATE heartbeat.
    // Returns Down once when the node goes quiet, Up is reported by onFrame().
    PeerChange tick(uint32_t nowMs);

    // {"v":1,"deviceId":nodeId,"online":false}: the Last Will, also published when the
    // node goes quiet (§5.3).
    const char* offlinePayload() const { return offline_; }
    size_t offlineLen() const { return offlineLen_; }

    bool mqttUp() const { return mqtt_; }
    bool nodeUp() const { return node_.up(); }
    bool registered() const { return registered_; }
    // The last HELLO; valid while registered().
    const Hello& hello() const { return hello_; }
    // The last HELLO carried another bootId than the one before (node rebooted).
    bool rebooted() const { return rebooted_; }
    // Whether the last onFrame() changed the node from down to up.
    bool cameUp() const { return cameUp_; }
    const PeerMonitor& node() const { return node_; }
    const Counters& counters() const { return counters_; }

private:
    GwRx onHello(const Frame& f, uint32_t nowMs);
    void requestHello(uint32_t nowMs, bool force);
    void sendLinkState(uint32_t nowMs);
    void sendTime(uint32_t nowMs);
    void publishOffline();
    void emit(Type type, const uint8_t* payload, size_t len, uint32_t nowMs);

    const char* nodeId_ = "";
    FrameSink sink_ = nullptr;
    PublishFn publish_ = nullptr;
    ClockFn clock_ = nullptr;
    TxTracker tx_;
    PeerMonitor node_;
    Hello hello_{};
    Counters counters_{};
    char offline_[kDeviceIdMax + 48] = "";
    size_t offlineLen_ = 0;
    bool registered_ = false;
    bool rebooted_ = false;
    bool cameUp_ = false;
    bool mqtt_ = false;
    bool hasRssi_ = false;
    int rssi_ = 0;
    bool helloRequested_ = false;
    uint32_t lastHelloRequestAt_ = 0;
    bool timeSent_ = false;
    uint32_t lastTimeAt_ = 0;
};

}  // namespace lnk
