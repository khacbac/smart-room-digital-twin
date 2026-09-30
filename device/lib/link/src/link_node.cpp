#include "link_node.h"

#include <string.h>

namespace lnk {

void NodeLink::begin(const char* deviceId, const char* bootId, const char* fw, FrameSink sink, uint32_t nowMs) {
    deviceId_ = deviceId;
    bootId_ = bootId;
    fw_ = fw;
    sink_ = sink;
    statusPending_ = true;
    sendHello(nowMs, false);
}

bool NodeLink::mqttUp() const {
    return gateway_.up() && state_.mqtt && state_.hasBootId && strcmp(state_.bootId, bootId_) == 0;
}

bool NodeLink::takeStatusDue() {
    if (!statusPending_ || !mqttUp()) return false;
    statusPending_ = false;
    return true;
}

NodeRx NodeLink::onFrame(const Frame& f, uint32_t nowMs) {
    if (fromNode(f.type)) {
        invalid_++;
        return NodeRx::Invalid;
    }
    gateway_.onFrame(f.seq, nowMs);  // every gateway frame counts as alive (§4.1)

    NodeRx rx = NodeRx::None;
    switch (f.type) {
        case Type::Command: rx = NodeRx::Command; break;
        case Type::Time: {
            int64_t ts;
            if (parseTime(f.payload, f.len, ts)) {
                timeMs_ = ts;
                rx = NodeRx::Time;
            } else {
                rx = NodeRx::Invalid;
            }
            break;
        }
        case Type::LinkState: {
            LinkState s;
            if (!parseLinkState(f.payload, f.len, s)) {
                rx = NodeRx::Invalid;
                break;
            }
            state_ = s;
            // Our HELLO was lost, or the gateway restarted: register again (§5.2).
            if (!s.hasBootId || strcmp(s.bootId, bootId_) != 0) sendHello(nowMs, true);
            break;
        }
        case Type::HelloRequest: sendHello(nowMs, false); break;
        default: break;
    }
    if (rx == NodeRx::Invalid) invalid_++;
    update();
    return rx;
}

void NodeLink::tick(uint32_t nowMs) {
    gateway_.tick(nowMs);
    update();
    if (tx_.heartbeatDue(nowMs)) emit(Type::Heartbeat, nullptr, 0, nowMs);
}

bool NodeLink::send(Type type, const uint8_t* payload, size_t len, uint32_t nowMs) {
    switch (type) {
        case Type::Telemetry:
        case Type::Status:
        case Type::Event:
        case Type::Ack: break;
        default: return false;
    }
    if (!mqttUp() || len > LINK_PAYLOAD_MAX) return false;
    emit(type, payload, len, nowMs);
    return true;
}

void NodeLink::sendHello(uint32_t nowMs, bool throttled) {
    if (throttled && helloSent_ && (uint32_t)(nowMs - lastHelloAt_) < LINK_HELLO_MIN_MS) return;
    char json[kDeviceIdMax + kBootIdLen + kFwMax + 48];
    const size_t n = buildHello(deviceId_, bootId_, fw_, json, sizeof(json));
    if (n == 0) return;
    helloSent_ = true;
    lastHelloAt_ = nowMs;
    hellos_++;
    statusPending_ = true;  // the gateway publishes nothing of ours until it answers
    emit(Type::Hello, (const uint8_t*)json, n, nowMs);
}

void NodeLink::emit(Type type, const uint8_t* payload, size_t len, uint32_t nowMs) {
    const uint8_t seq = tx_.take(nowMs);
    if (sink_) sink_(type, seq, payload, len);
}

// A status is owed every time the path to MQTT goes away (§4.3).
void NodeLink::update() {
    const bool up = mqttUp();
    if (lastUp_ && !up) statusPending_ = true;
    lastUp_ = up;
}

}  // namespace lnk
