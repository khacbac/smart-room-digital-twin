#include "link_gateway.h"

#include <string.h>

namespace lnk {

const char* uplinkName(Uplink u) {
    switch (u) {
        case Uplink::Telemetry: return "telemetry";
        case Uplink::Status: return "status";
        case Uplink::Event: return "event";
        case Uplink::Ack: return "command/ack";
    }
    return "?";
}

void GatewayLink::begin(const char* nodeId, FrameSink sink, PublishFn publish, ClockFn clock, uint32_t nowMs) {
    nodeId_ = nodeId;
    sink_ = sink;
    publish_ = publish;
    clock_ = clock;
    offlineLen_ = buildOffline(nodeId_, offline_, sizeof(offline_));
    // Who is there? A node that booted before us answers with HELLO (§5.2).
    requestHello(nowMs, true);
    sendLinkState(nowMs);
}

void GatewayLink::setMqtt(bool up, uint32_t nowMs) {
    if (up == mqtt_) return;
    mqtt_ = up;
    if (mqtt_ && !node_.up()) publishOffline();
    sendLinkState(nowMs);
}

void GatewayLink::setRssi(int rssi) {
    hasRssi_ = true;
    rssi_ = rssi;
}

GwRx GatewayLink::onFrame(const Frame& f, uint32_t nowMs) {
    cameUp_ = false;
    if (!fromNode(f.type)) {
        counters_.invalid++;
        counters_.dropped++;
        return GwRx::Invalid;
    }
    // A HELLO starts a new seq run (the node may have rebooted), so no false gap.
    if (f.type == Type::Hello) node_.resetSeq();
    cameUp_ = node_.onFrame(f.seq, nowMs) == PeerChange::Up;

    if (f.type == Type::Hello) return onHello(f, nowMs);
    if (!registered_) {
        counters_.dropped++;
        requestHello(nowMs, false);
        return GwRx::NotRegistered;
    }

    Uplink topic;
    switch (f.type) {
        case Type::Telemetry: topic = Uplink::Telemetry; break;
        case Type::Status: topic = Uplink::Status; break;
        case Type::Event: topic = Uplink::Event; break;
        case Type::Ack: topic = Uplink::Ack; break;
        default: return GwRx::None;  // HEARTBEAT
    }
    counters_.uplink++;
    if (!mqtt_ || !publish_ || !publish_(topic, f.payload, f.len)) {
        counters_.dropped++;
        return GwRx::Dropped;
    }
    counters_.published++;
    return GwRx::Published;
}

GwRx GatewayLink::onHello(const Frame& f, uint32_t nowMs) {
    Hello h;
    if (!parseHello(f.payload, f.len, h) || strcmp(h.deviceId, nodeId_) != 0) {
        counters_.invalid++;
        counters_.dropped++;
        return GwRx::HelloRefused;
    }
    rebooted_ = registered_ && strcmp(h.bootId, hello_.bootId) != 0;
    hello_ = h;
    registered_ = true;
    // TIME first, so the STATUS / BOOT the node sends on LINK_STATE already has a ts.
    sendTime(nowMs);
    sendLinkState(nowMs);
    return GwRx::Hello;
}

GwCmd GatewayLink::onCommand(const uint8_t* payload, size_t len, uint32_t nowMs) {
    if (!mqtt_) return GwCmd::MqttDown;
    if (!registered_ || !node_.up()) {
        counters_.dropped++;
        return GwCmd::NodeDown;
    }
    if (len > LINK_PAYLOAD_MAX) {
        counters_.dropped++;
        return GwCmd::TooLong;
    }
    counters_.commands++;
    emit(Type::Command, payload, len, nowMs);
    return GwCmd::Forwarded;
}

PeerChange GatewayLink::tick(uint32_t nowMs) {
    const PeerChange change = node_.tick(nowMs);
    if (change == PeerChange::Down) publishOffline();
    // Also catches NTP syncing after the HELLO.
    if (registered_ && (!timeSent_ || (uint32_t)(nowMs - lastTimeAt_) >= LINK_TIME_RESYNC_MS)) sendTime(nowMs);
    if (tx_.heartbeatDue(nowMs)) sendLinkState(nowMs);  // LINK_STATE is the gateway heartbeat
    return change;
}

void GatewayLink::requestHello(uint32_t nowMs, bool force) {
    if (!force && helloRequested_ && (uint32_t)(nowMs - lastHelloRequestAt_) < LINK_HELLO_REQUEST_MIN_MS) return;
    helloRequested_ = true;
    lastHelloRequestAt_ = nowMs;
    emit(Type::HelloRequest, nullptr, 0, nowMs);
}

void GatewayLink::sendLinkState(uint32_t nowMs) {
    LinkState s{};
    s.mqtt = mqtt_;
    s.hasRssi = hasRssi_;
    s.rssi = rssi_;
    s.hasBootId = registered_;
    if (registered_) memcpy(s.bootId, hello_.bootId, sizeof(s.bootId));
    char json[64];
    const size_t n = buildLinkState(s, json, sizeof(json));
    if (n) emit(Type::LinkState, (const uint8_t*)json, n, nowMs);
}

void GatewayLink::sendTime(uint32_t nowMs) {
    int64_t ts;
    if (!clock_ || !clock_(ts)) return;  // no NTP yet: tick() retries
    char json[32];
    const size_t n = buildTime(ts, json, sizeof(json));
    if (n == 0) return;
    timeSent_ = true;
    lastTimeAt_ = nowMs;
    emit(Type::Time, (const uint8_t*)json, n, nowMs);
}

void GatewayLink::publishOffline() {
    if (mqtt_ && publish_ && offlineLen_) publish_(Uplink::Status, (const uint8_t*)offline_, offlineLen_);
}

void GatewayLink::emit(Type type, const uint8_t* payload, size_t len, uint32_t nowMs) {
    const uint8_t seq = tx_.take(nowMs);
    if (sink_) sink_(type, seq, payload, len);
}

}  // namespace lnk
