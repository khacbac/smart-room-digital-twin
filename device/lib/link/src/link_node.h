#pragma once

// Node side of the link (docs/link-protocol.md §4.3, §5.2): registration with HELLO,
// gateway presence, whether MQTT payloads may go out (mqttUp) and the owed status.
// Same logic as NodeSim in tools/link-sim/src/node.ts. The transport (UART, tunnel)
// and the clock belong to the caller, so this builds and is tested on the host.

#include <stddef.h>
#include <stdint.h>

#include "link_frame.h"
#include "link_messages.h"
#include "link_peer.h"

#ifndef LINK_HELLO_MIN_MS
#define LINK_HELLO_MIN_MS 1000  // at most one HELLO per second in reply to LINK_STATE
#endif

namespace lnk {

// Hands one frame to the transport. The payload is only valid during the call.
using FrameSink = void (*)(Type type, uint8_t seq, const uint8_t* payload, size_t len);

// What onFrame() leaves for the caller to act on.
enum class NodeRx : uint8_t {
    None,     // handled here (LINK_STATE, HELLO_REQUEST)
    Command,  // COMMAND: run frame.payload through proto::CommandHandler
    Time,     // TIME: set the clock to timeMs()
    Invalid,  // wrong direction or bad JSON, ignored
};

class NodeLink {
public:
    // Sends the first HELLO. The strings must outlive the object.
    void begin(const char* deviceId, const char* bootId, const char* fw, FrameSink sink, uint32_t nowMs);

    // A valid frame from the gateway.
    NodeRx onFrame(const Frame& f, uint32_t nowMs);
    // Every loop: gateway timeout and heartbeat.
    void tick(uint32_t nowMs);

    // TELEMETRY / STATUS / EVENT / ACK. Nothing is sent (false) while !mqttUp(), like
    // the firmware skips publishing while MQTT is down, or for any other type.
    bool send(Type type, const uint8_t* payload, size_t len, uint32_t nowMs);

    // The gateway is up, connected to the broker, and has registered this boot.
    bool mqttUp() const;
    // true once every time the path to MQTT comes (back) up or after a new HELLO: send
    // a STATUS now, plus BOOT the first time.
    bool takeStatusDue();

    bool gatewayUp() const { return gateway_.up(); }
    const PeerMonitor& gateway() const { return gateway_; }
    const LinkState& linkState() const { return state_; }
    int64_t timeMs() const { return timeMs_; }
    uint32_t hellos() const { return hellos_; }
    uint32_t invalid() const { return invalid_; }

private:
    void sendHello(uint32_t nowMs, bool throttled);
    void emit(Type type, const uint8_t* payload, size_t len, uint32_t nowMs);
    void update();

    const char* deviceId_ = "";
    const char* bootId_ = "";
    const char* fw_ = "";
    FrameSink sink_ = nullptr;
    TxTracker tx_;
    PeerMonitor gateway_;
    LinkState state_{};
    int64_t timeMs_ = 0;
    bool statusPending_ = true;
    bool lastUp_ = false;
    bool helloSent_ = false;
    uint32_t lastHelloAt_ = 0;
    uint32_t hellos_ = 0;
    uint32_t invalid_ = 0;
};

}  // namespace lnk
