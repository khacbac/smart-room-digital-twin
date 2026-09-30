// lnk::GatewayLink on the host (docs/link-protocol.md §5): registration, TIME and
// LINK_STATE, routing to MQTT, offline status, commands. The last tests run it against
// lnk::NodeLink through the stream codec, the same scenarios as
// tools/link-sim/test/bridge.test.ts. Run with `pio test -e native`.

#include <string.h>
#include <unity.h>

#include "link_frame.h"
#include "link_gateway.h"
#include "link_messages.h"
#include "link_node.h"

using namespace lnk;

static const char kBoot[] = "a1b2c3d4";
static const char kOffline[] = "{\"v\":1,\"deviceId\":\"room-01\",\"online\":false}";

// ---- Recording sinks ------------------------------------------------------------------

struct Sent {
    Type type;
    uint8_t seq;
    char payload[160];
    size_t len;
};
static Sent sent[256];  // gateway → node
static size_t sentCount;

struct Pub {
    Uplink topic;
    char payload[160];
    size_t len;
};
static Pub pubs[256];
static size_t pubCount;
static bool publishOk;

static bool clockOk;
static int64_t epochMs;

// Stream bytes each way, for the NodeLink ⇄ GatewayLink tests.
static uint8_t down[8192], up[8192];
static size_t downLen, upLen;
static bool lineCut;

static void copyText(char* dst, size_t size, const uint8_t* src, size_t len, size_t& outLen) {
    outLen = len < size - 1 ? len : size - 1;
    memcpy(dst, src, outLen);
    dst[outLen] = '\0';
}

static void append(uint8_t* buf, size_t& len, size_t cap, Type type, uint8_t seq, const uint8_t* payload, size_t n) {
    if (lineCut) return;
    len += encodeStream(type, seq, payload, n, buf + len, cap - len);
}

static void gwSink(Type type, uint8_t seq, const uint8_t* payload, size_t len) {
    append(down, downLen, sizeof(down), type, seq, payload, len);
    if (sentCount >= sizeof(sent) / sizeof(sent[0])) return;
    Sent& s = sent[sentCount++];
    s.type = type;
    s.seq = seq;
    copyText(s.payload, sizeof(s.payload), payload, len, s.len);
}

static void nodeSink(Type type, uint8_t seq, const uint8_t* payload, size_t len) {
    append(up, upLen, sizeof(up), type, seq, payload, len);
}

static bool publish(Uplink topic, const uint8_t* payload, size_t len) {
    if (!publishOk) return false;
    if (pubCount < sizeof(pubs) / sizeof(pubs[0])) {
        Pub& p = pubs[pubCount++];
        p.topic = topic;
        copyText(p.payload, sizeof(p.payload), payload, len, p.len);
    }
    return true;
}

static bool ntpClock(int64_t& ms) {
    if (clockOk) ms = epochMs;
    return clockOk;
}

static size_t countOf(Type t) {
    size_t n = 0;
    for (size_t i = 0; i < sentCount; i++) n += sent[i].type == t ? 1 : 0;
    return n;
}

static const Sent& lastSent() { return sent[sentCount - 1]; }
static const Pub& lastPub() { return pubs[pubCount - 1]; }

// ---- Node frames ----------------------------------------------------------------------

static uint8_t rawBuf[kRawMax];
static uint8_t nodeSeq;

static Frame frameSeq(Type type, uint8_t seq, const char* json) {
    const size_t n = encodeRaw(type, seq, (const uint8_t*)json, strlen(json), rawBuf, sizeof(rawBuf));
    Frame f{};
    TEST_ASSERT_EQUAL(DecodeError::None, decodeRaw(rawBuf, n, f));
    return f;
}
static Frame frame(Type type, const char* json = "") { return frameSeq(type, nodeSeq++, json); }

static GatewayLink gw;
static uint32_t now;

static GwRx hello(const char* bootId = kBoot, const char* deviceId = "room-01") {
    char json[96];
    TEST_ASSERT_TRUE(buildHello(deviceId, bootId, "0.2.0", json, sizeof(json)) > 0);
    return gw.onFrame(frame(Type::Hello, json), now);
}

// MQTT up, node registered, ready to bridge.
static void ready() {
    gw.setMqtt(true, now);
    TEST_ASSERT_EQUAL(GwRx::Hello, hello());
}

void setUp() {
    sentCount = pubCount = 0;
    downLen = upLen = 0;
    lineCut = false;
    publishOk = true;
    clockOk = true;
    epochMs = 1790591200123LL;
    nodeSeq = 0;
    now = 1000;
    gw = GatewayLink();
    gw.begin("room-01", gwSink, publish, ntpClock, now);
}
void tearDown() {}

// ---- GatewayLink ----------------------------------------------------------------------

static void test_begin_asks_who_is_there() {
    TEST_ASSERT_EQUAL(2, sentCount);
    TEST_ASSERT_EQUAL(Type::HelloRequest, sent[0].type);
    TEST_ASSERT_EQUAL(0, sent[0].len);
    TEST_ASSERT_EQUAL(Type::LinkState, sent[1].type);
    TEST_ASSERT_EQUAL_STRING("{\"mqtt\":false}", sent[1].payload);
    TEST_ASSERT_EQUAL(0, pubCount);
    TEST_ASSERT_EQUAL_STRING(kOffline, gw.offlinePayload());
    TEST_ASSERT_EQUAL(strlen(kOffline), gw.offlineLen());
}

static void test_mqtt_up_with_node_down_publishes_offline() {
    gw.setMqtt(true, now);
    TEST_ASSERT_EQUAL(1, pubCount);
    TEST_ASSERT_EQUAL(Uplink::Status, pubs[0].topic);
    TEST_ASSERT_EQUAL_STRING(kOffline, pubs[0].payload);
    TEST_ASSERT_EQUAL_STRING("{\"mqtt\":true}", lastSent().payload);
    gw.setMqtt(true, now);  // no change: nothing
    TEST_ASSERT_EQUAL(1, pubCount);
    TEST_ASSERT_EQUAL(3, sentCount);
}

static void test_hello_registers_then_time_then_link_state() {
    gw.setMqtt(true, now);
    gw.setRssi(-61);
    const size_t before = sentCount;
    TEST_ASSERT_EQUAL(GwRx::Hello, hello());
    TEST_ASSERT_TRUE(gw.registered());
    TEST_ASSERT_TRUE(gw.cameUp());
    TEST_ASSERT_FALSE(gw.rebooted());
    TEST_ASSERT_EQUAL_STRING("0.2.0", gw.hello().fw);
    TEST_ASSERT_EQUAL(before + 2, sentCount);
    TEST_ASSERT_EQUAL(Type::Time, sent[before].type);
    TEST_ASSERT_EQUAL_STRING("{\"ts\":1790591200123}", sent[before].payload);
    TEST_ASSERT_EQUAL(Type::LinkState, sent[before + 1].type);
    TEST_ASSERT_EQUAL_STRING("{\"mqtt\":true,\"rssi\":-61,\"bootId\":\"a1b2c3d4\"}", sent[before + 1].payload);
}

static void test_hello_refused() {
    TEST_ASSERT_EQUAL(GwRx::HelloRefused, hello(kBoot, "room-99"));  // configured for room-01
    TEST_ASSERT_EQUAL(GwRx::HelloRefused, gw.onFrame(frame(Type::Hello, "{\"deviceId\":\"room-01\"}"), now));
    TEST_ASSERT_FALSE(gw.registered());
    TEST_ASSERT_EQUAL(2, gw.counters().invalid);
    TEST_ASSERT_EQUAL(0, countOf(Type::Time));
}

static void test_data_before_hello_requests_hello_throttled() {
    gw.setMqtt(true, now);
    TEST_ASSERT_EQUAL(GwRx::NotRegistered, gw.onFrame(frame(Type::Telemetry, "{}"), now + 10));
    TEST_ASSERT_EQUAL(1, countOf(Type::HelloRequest));  // < 1 s after the one from begin()
    TEST_ASSERT_EQUAL(GwRx::NotRegistered, gw.onFrame(frame(Type::Heartbeat), now + 1000));
    TEST_ASSERT_EQUAL(2, countOf(Type::HelloRequest));
    TEST_ASSERT_EQUAL(1, pubCount);  // only the offline status
    TEST_ASSERT_EQUAL(2, gw.counters().dropped);
}

static void test_uplink_published_byte_for_byte() {
    ready();
    const size_t base = pubCount;
    TEST_ASSERT_EQUAL(GwRx::Published, gw.onFrame(frame(Type::Telemetry, "{\"t\":1}"), now));
    TEST_ASSERT_EQUAL(GwRx::Published, gw.onFrame(frame(Type::Status, "{\"s\":2}"), now));
    TEST_ASSERT_EQUAL(GwRx::Published, gw.onFrame(frame(Type::Event, "{\"e\":3}"), now));
    TEST_ASSERT_EQUAL(GwRx::Published, gw.onFrame(frame(Type::Ack, "{\"a\":4}"), now));
    TEST_ASSERT_EQUAL(GwRx::None, gw.onFrame(frame(Type::Heartbeat), now));
    TEST_ASSERT_EQUAL(base + 4, pubCount);
    const Uplink topics[] = {Uplink::Telemetry, Uplink::Status, Uplink::Event, Uplink::Ack};
    const char* bodies[] = {"{\"t\":1}", "{\"s\":2}", "{\"e\":3}", "{\"a\":4}"};
    for (size_t i = 0; i < 4; i++) {
        TEST_ASSERT_EQUAL(topics[i], pubs[base + i].topic);
        TEST_ASSERT_EQUAL_STRING(bodies[i], pubs[base + i].payload);
    }
    TEST_ASSERT_EQUAL_STRING("command/ack", uplinkName(Uplink::Ack));
    TEST_ASSERT_EQUAL(4, gw.counters().uplink);
    TEST_ASSERT_EQUAL(4, gw.counters().published);
}

static void test_mqtt_down_drops_without_buffering() {
    ready();
    gw.setMqtt(false, now);
    TEST_ASSERT_EQUAL_STRING("{\"mqtt\":false,\"bootId\":\"a1b2c3d4\"}", lastSent().payload);
    const size_t base = pubCount;
    TEST_ASSERT_EQUAL(GwRx::Dropped, gw.onFrame(frame(Type::Telemetry, "{}"), now));
    gw.setMqtt(true, now);  // node is up: no offline status
    TEST_ASSERT_EQUAL(base, pubCount);
    TEST_ASSERT_EQUAL(GwRx::Published, gw.onFrame(frame(Type::Telemetry, "{}"), now));
    TEST_ASSERT_EQUAL(base + 1, pubCount);

    publishOk = false;  // the client refused it (buffer full …)
    TEST_ASSERT_EQUAL(GwRx::Dropped, gw.onFrame(frame(Type::Telemetry, "{}"), now));
    TEST_ASSERT_EQUAL(2, gw.counters().dropped);
}

static void test_node_timeout_publishes_offline_once() {
    ready();
    const size_t base = pubCount;
    TEST_ASSERT_EQUAL(PeerChange::None, gw.tick(now + LINK_PEER_TIMEOUT_MS - 1));
    TEST_ASSERT_EQUAL(PeerChange::Down, gw.tick(now + LINK_PEER_TIMEOUT_MS));
    TEST_ASSERT_EQUAL(base + 1, pubCount);
    TEST_ASSERT_EQUAL_STRING(kOffline, lastPub().payload);
    TEST_ASSERT_EQUAL(PeerChange::None, gw.tick(now + LINK_PEER_TIMEOUT_MS + 1000));
    TEST_ASSERT_EQUAL(base + 1, pubCount);

    // Back without a new HELLO (only the line was lost): still registered.
    now += LINK_PEER_TIMEOUT_MS + 2000;
    TEST_ASSERT_EQUAL(GwRx::Published, gw.onFrame(frame(Type::Status, "{}"), now));
    TEST_ASSERT_TRUE(gw.cameUp());
    TEST_ASSERT_TRUE(gw.nodeUp());
}

static void test_commands() {
    const uint8_t cmd[] = "{\"a\":1}";
    gw.setMqtt(true, now);
    TEST_ASSERT_EQUAL(GwCmd::NodeDown, gw.onCommand(cmd, 7, now));  // no HELLO yet
    TEST_ASSERT_EQUAL(GwRx::Hello, hello());

    TEST_ASSERT_EQUAL(GwCmd::Forwarded, gw.onCommand(cmd, 7, now));
    TEST_ASSERT_EQUAL(Type::Command, lastSent().type);
    TEST_ASSERT_EQUAL_STRING("{\"a\":1}", lastSent().payload);

    static uint8_t big[LINK_PAYLOAD_MAX + 1];
    TEST_ASSERT_EQUAL(GwCmd::TooLong, gw.onCommand(big, sizeof(big), now));
    gw.setMqtt(false, now);
    TEST_ASSERT_EQUAL(GwCmd::MqttDown, gw.onCommand(cmd, 7, now));
    gw.setMqtt(true, now);
    gw.tick(now + LINK_PEER_TIMEOUT_MS);
    TEST_ASSERT_EQUAL(GwCmd::NodeDown, gw.onCommand(cmd, 7, now + LINK_PEER_TIMEOUT_MS));
    TEST_ASSERT_EQUAL(1, gw.counters().commands);
}

static void test_time_waits_for_ntp_and_resyncs() {
    clockOk = false;
    ready();
    TEST_ASSERT_EQUAL(0, countOf(Type::Time));
    TEST_ASSERT_EQUAL(Type::LinkState, lastSent().type);  // LINK_STATE does not wait for NTP
    gw.tick(now + 100);
    TEST_ASSERT_EQUAL(0, countOf(Type::Time));

    clockOk = true;
    now += 200;
    gw.tick(now);
    TEST_ASSERT_EQUAL(1, countOf(Type::Time));
    gw.tick(now + LINK_TIME_RESYNC_MS - 1);
    TEST_ASSERT_EQUAL(1, countOf(Type::Time));
    epochMs += LINK_TIME_RESYNC_MS;
    gw.tick(now + LINK_TIME_RESYNC_MS);
    TEST_ASSERT_EQUAL(2, countOf(Type::Time));
    TEST_ASSERT_EQUAL(Type::Time, lastSent().type);
    TEST_ASSERT_EQUAL_STRING("{\"ts\":1790591800123}", lastSent().payload);
}

static void test_link_state_heartbeat_when_quiet() {
    gw.tick(now + LINK_HEARTBEAT_MS - 1);
    TEST_ASSERT_EQUAL(1, countOf(Type::LinkState));
    gw.tick(now + LINK_HEARTBEAT_MS);
    TEST_ASSERT_EQUAL(2, countOf(Type::LinkState));
    gw.tick(now + LINK_HEARTBEAT_MS + 100);
    TEST_ASSERT_EQUAL(2, countOf(Type::LinkState));
}

static void test_node_reboot_new_boot_id() {
    ready();
    for (int i = 0; i < 5; i++) gw.onFrame(frame(Type::Telemetry, "{}"), now);
    nodeSeq = 0;  // rebooted: seq restarts
    TEST_ASSERT_EQUAL(GwRx::Hello, hello("0badf00d"));
    TEST_ASSERT_TRUE(gw.rebooted());
    TEST_ASSERT_EQUAL_STRING("0badf00d", gw.hello().bootId);
    TEST_ASSERT_EQUAL(0, gw.node().lost());  // no false gap from the new seq run
    TEST_ASSERT_EQUAL(GwRx::Hello, hello("0badf00d"));  // HELLO_REQUEST answer, same boot
    TEST_ASSERT_FALSE(gw.rebooted());
}

static void test_wrong_direction_is_invalid() {
    TEST_ASSERT_EQUAL(GwRx::Invalid, gw.onFrame(frame(Type::Command, "{}"), now));
    TEST_ASSERT_FALSE(gw.nodeUp());
    TEST_ASSERT_EQUAL(1, gw.counters().invalid);
}

// ---- NodeLink ⇄ GatewayLink -----------------------------------------------------------

static NodeLink node;
static StreamDecoder toNode, toGw;

// Delivers the bytes in flight both ways until the line is quiet.
static void pump() {
    static uint8_t chunk[sizeof(down)];
    for (int round = 0; round < 16 && (downLen || upLen); round++) {
        size_t n = downLen;
        memcpy(chunk, down, n);
        downLen = 0;
        for (size_t i = 0; i < n; i++) {
            if (!toNode.push(chunk[i])) continue;
            const NodeRx rx = node.onFrame(toNode.frame(), now);
            TEST_ASSERT_NOT_EQUAL(NodeRx::Invalid, rx);
        }
        n = upLen;
        memcpy(chunk, up, n);
        upLen = 0;
        for (size_t i = 0; i < n; i++) {
            if (toGw.push(chunk[i])) gw.onFrame(toGw.frame(), now);
        }
    }
    TEST_ASSERT_EQUAL(0, downLen + upLen);
}

static uint32_t telemetrySent;

// The node's owed status, as main.cpp sends it on takeConnected().
static void serve() {
    if (node.takeStatusDue()) node.send(Type::Status, (const uint8_t*)"{\"online\":true}", 15, now);
    pump();
}

// The firmware loop: tick both every second, telemetry every 2 s, status when owed.
static void run(uint32_t ms) {
    for (uint32_t t = 0; t < ms; t += 1000) {
        now += 1000;
        node.tick(now);
        gw.tick(now);
        if ((now / 1000) % 2 == 0 && node.send(Type::Telemetry, (const uint8_t*)"{}", 2, now)) telemetrySent++;
        serve();
    }
}

static size_t onlineStatuses() {
    size_t n = 0;
    for (size_t i = 0; i < pubCount; i++) n += strcmp(pubs[i].payload, "{\"online\":true}") == 0 ? 1 : 0;
    return n;
}
static bool lastStatusOnline() {
    for (size_t i = pubCount; i-- > 0;) {
        if (pubs[i].topic == Uplink::Status) return strcmp(pubs[i].payload, kOffline) != 0;
    }
    return false;
}

// setUp() already started the gateway; boot the node on the other end.
static void pairUp() {
    node = NodeLink();
    toNode = StreamDecoder();
    toGw = StreamDecoder();
    telemetrySent = 0;
    downLen = 0;  // the gateway's boot frames went out before the node was listening
    gw.setMqtt(true, now);
    node.begin("room-01", kBoot, "0.2.0", nodeSink, now);
    pump();
}

static void test_pair_boot_offline_then_online() {
    pairUp();
    TEST_ASSERT_EQUAL_STRING(kOffline, pubs[0].payload);  // broker up before the node
    TEST_ASSERT_TRUE(node.mqttUp());
    TEST_ASSERT_TRUE(node.takeStatusDue());
    node.send(Type::Status, (const uint8_t*)"{\"online\":true}", 15, now);
    pump();
    TEST_ASSERT_TRUE(lastStatusOnline());
    TEST_ASSERT_EQUAL(1790591200123LL, node.timeMs());

    run(10000);
    TEST_ASSERT_EQUAL(5, telemetrySent);
    TEST_ASSERT_EQUAL(gw.counters().uplink, gw.counters().published);
}

static void test_pair_line_cut_and_back() {
    pairUp();
    run(4000);
    lineCut = true;  // last node frame: telemetry at now - 1 s
    run(13000);
    TEST_ASSERT_TRUE(lastStatusOnline());
    run(2000);
    TEST_ASSERT_FALSE(lastStatusOnline());  // gateway: node quiet 15 s
    TEST_ASSERT_FALSE(node.mqttUp());        // node: gateway quiet 15 s

    lineCut = false;
    const size_t statuses = onlineStatuses();
    run(6000);
    TEST_ASSERT_TRUE(gw.nodeUp() && node.mqttUp());
    TEST_ASSERT_EQUAL(statuses + 1, onlineStatuses());
    TEST_ASSERT_TRUE(lastStatusOnline());
}

static void test_pair_broker_down_and_back() {
    pairUp();
    run(4000);
    gw.setMqtt(false, now);
    pump();
    const uint32_t sentBefore = telemetrySent;
    run(10000);
    TEST_ASSERT_EQUAL(sentBefore, telemetrySent);  // the node holds off, nothing to drop
    TEST_ASSERT_FALSE(node.mqttUp());

    const size_t statuses = onlineStatuses();
    gw.setMqtt(true, now);
    pump();
    serve();
    TEST_ASSERT_EQUAL(statuses + 1, onlineStatuses());
    run(4000);
    TEST_ASSERT_TRUE(telemetrySent > sentBefore);
}

static void test_pair_gateway_restart() {
    pairUp();
    run(4000);
    const uint32_t hellos = node.hellos();
    gw = GatewayLink();  // fresh gateway on the same line, the node keeps running
    gw.begin("room-01", gwSink, publish, ntpClock, now);
    gw.setMqtt(true, now);
    pump();
    TEST_ASSERT_TRUE(gw.registered());
    TEST_ASSERT_EQUAL_STRING(kBoot, gw.hello().bootId);
    TEST_ASSERT_FALSE(gw.rebooted());
    TEST_ASSERT_EQUAL(hellos + 1, node.hellos());
    const size_t statuses = onlineStatuses();
    serve();
    TEST_ASSERT_EQUAL(statuses + 1, onlineStatuses());
}

static void test_pair_lost_hello() {
    node = NodeLink();
    toNode = StreamDecoder();
    toGw = StreamDecoder();
    downLen = 0;
    gw.setMqtt(true, now);
    lineCut = true;  // the node's HELLO goes out before the line is up
    node.begin("room-01", kBoot, "0.2.0", nodeSink, now);
    lineCut = false;
    run(6000);  // LINK_STATE heartbeat without bootId → node sends HELLO again
    TEST_ASSERT_TRUE(gw.registered());
    TEST_ASSERT_TRUE(node.mqttUp());
    TEST_ASSERT_EQUAL(1, onlineStatuses());
    TEST_ASSERT_EQUAL(gw.counters().uplink, gw.counters().published);
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_begin_asks_who_is_there);
    RUN_TEST(test_mqtt_up_with_node_down_publishes_offline);
    RUN_TEST(test_hello_registers_then_time_then_link_state);
    RUN_TEST(test_hello_refused);
    RUN_TEST(test_data_before_hello_requests_hello_throttled);
    RUN_TEST(test_uplink_published_byte_for_byte);
    RUN_TEST(test_mqtt_down_drops_without_buffering);
    RUN_TEST(test_node_timeout_publishes_offline_once);
    RUN_TEST(test_commands);
    RUN_TEST(test_time_waits_for_ntp_and_resyncs);
    RUN_TEST(test_link_state_heartbeat_when_quiet);
    RUN_TEST(test_node_reboot_new_boot_id);
    RUN_TEST(test_wrong_direction_is_invalid);
    RUN_TEST(test_pair_boot_offline_then_online);
    RUN_TEST(test_pair_line_cut_and_back);
    RUN_TEST(test_pair_broker_down_and_back);
    RUN_TEST(test_pair_gateway_restart);
    RUN_TEST(test_pair_lost_hello);
    return UNITY_END();
}
