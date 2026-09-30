// lnk::NodeLink on the host: registration, mqttUp, owed status, heartbeat, gateway
// timeout (docs/link-protocol.md §4.3, §5.2). Same scenarios as
// tools/link-sim/test/bridge.test.ts, seen from the node. Run with `pio test -e native`.

#include <string.h>
#include <unity.h>

#include "link_frame.h"
#include "link_messages.h"
#include "link_node.h"

using namespace lnk;

static const char kBoot[] = "a1b2c3d4";

// ---- Recording sink -------------------------------------------------------------------

struct Sent {
    Type type;
    uint8_t seq;
    char payload[256];
    size_t len;
};
static Sent sent[64];
static size_t sentCount;

static void record(Type type, uint8_t seq, const uint8_t* payload, size_t len) {
    if (sentCount >= sizeof(sent) / sizeof(sent[0])) return;
    Sent& s = sent[sentCount++];
    s.type = type;
    s.seq = seq;
    s.len = len < sizeof(s.payload) - 1 ? len : sizeof(s.payload) - 1;
    memcpy(s.payload, payload, s.len);
    s.payload[s.len] = '\0';
}

static size_t countOf(Type t) {
    size_t n = 0;
    for (size_t i = 0; i < sentCount; i++) n += sent[i].type == t ? 1 : 0;
    return n;
}

// ---- Gateway frames -------------------------------------------------------------------

static uint8_t rawBuf[kRawMax];
static uint8_t gwSeq;

// Encodes and decodes like the wire would, so the frame is exactly what the node sees.
static Frame frame(Type type, const char* json = "") {
    const size_t n = encodeRaw(type, gwSeq++, (const uint8_t*)json, strlen(json), rawBuf, sizeof(rawBuf));
    Frame f{};
    TEST_ASSERT_EQUAL(DecodeError::None, decodeRaw(rawBuf, n, f));
    return f;
}

static NodeRx linkState(NodeLink& n, uint32_t now, bool mqtt, const char* bootId) {
    LinkState s{mqtt, true, -61, bootId != nullptr, ""};
    if (bootId) strcpy(s.bootId, bootId);
    char json[96];
    TEST_ASSERT_TRUE(buildLinkState(s, json, sizeof(json)) > 0);
    return n.onFrame(frame(Type::LinkState, json), now);
}

static NodeLink node;
static uint32_t now;

// Boot + the gateway's answer to HELLO (§5.2): TIME, then LINK_STATE with our bootId.
static void registered() {
    TEST_ASSERT_EQUAL(NodeRx::Time, node.onFrame(frame(Type::Time, "{\"ts\":1790591200123}"), now));
    linkState(node, now, true, kBoot);
}

void setUp() {
    sentCount = 0;
    gwSeq = 0;
    now = 1000;
    node = NodeLink();
    node.begin("room-01", kBoot, "0.2.0", record, now);
}
void tearDown() {}

// ---- Tests ----------------------------------------------------------------------------

static void test_boot_sends_hello() {
    TEST_ASSERT_EQUAL(1, sentCount);
    TEST_ASSERT_EQUAL(Type::Hello, sent[0].type);
    TEST_ASSERT_EQUAL(0, sent[0].seq);
    TEST_ASSERT_EQUAL_STRING("{\"deviceId\":\"room-01\",\"bootId\":\"a1b2c3d4\",\"fw\":\"0.2.0\"}", sent[0].payload);
    TEST_ASSERT_FALSE(node.gatewayUp());
    TEST_ASSERT_FALSE(node.mqttUp());
    TEST_ASSERT_FALSE(node.takeStatusDue());
}

static void test_registration_then_status_once() {
    registered();
    TEST_ASSERT_TRUE(node.gatewayUp());
    TEST_ASSERT_TRUE(node.mqttUp());
    TEST_ASSERT_EQUAL(1790591200123LL, node.timeMs());
    TEST_ASSERT_EQUAL(-61, node.linkState().rssi);
    TEST_ASSERT_TRUE(node.takeStatusDue());
    TEST_ASSERT_FALSE(node.takeStatusDue());
    TEST_ASSERT_EQUAL(1, node.hellos());  // our bootId came back: no second HELLO
}

static void test_send_only_while_mqtt_up() {
    const uint8_t json[] = "{}";
    TEST_ASSERT_FALSE(node.send(Type::Telemetry, json, 2, now));
    registered();
    TEST_ASSERT_TRUE(node.send(Type::Telemetry, json, 2, now));
    TEST_ASSERT_TRUE(node.send(Type::Status, json, 2, now));
    TEST_ASSERT_FALSE(node.send(Type::Hello, json, 2, now));  // not an MQTT payload
    TEST_ASSERT_FALSE(node.send(Type::Command, json, 2, now));
    TEST_ASSERT_EQUAL(3, sentCount);
    TEST_ASSERT_EQUAL(1, sent[1].seq);
    TEST_ASSERT_EQUAL(2, sent[2].seq);

    linkState(node, now, false, kBoot);  // broker gone
    TEST_ASSERT_FALSE(node.send(Type::Event, json, 2, now));
    TEST_ASSERT_EQUAL(3, sentCount);
}

static void test_lost_hello_is_resent_throttled() {
    // LINK_STATE without bootId: the gateway never got our HELLO.
    linkState(node, now, true, nullptr);
    TEST_ASSERT_EQUAL(1, countOf(Type::Hello));  // < 1 s since the boot HELLO
    now += 1000;
    linkState(node, now, true, nullptr);
    TEST_ASSERT_EQUAL(2, countOf(Type::Hello));
    linkState(node, now + 10, true, nullptr);
    TEST_ASSERT_EQUAL(2, countOf(Type::Hello));
    TEST_ASSERT_FALSE(node.mqttUp());

    // A LINK_STATE registered for another boot (a stale gateway) is not ours either.
    now += 1000;
    linkState(node, now, true, "deadbeef");
    TEST_ASSERT_FALSE(node.mqttUp());
    TEST_ASSERT_EQUAL(3, countOf(Type::Hello));

    linkState(node, now, true, kBoot);
    TEST_ASSERT_TRUE(node.mqttUp());
    TEST_ASSERT_TRUE(node.takeStatusDue());
}

static void test_broker_down_and_back_owes_status() {
    registered();
    TEST_ASSERT_TRUE(node.takeStatusDue());
    linkState(node, now, false, kBoot);
    TEST_ASSERT_FALSE(node.mqttUp());
    TEST_ASSERT_FALSE(node.takeStatusDue());
    linkState(node, now, true, kBoot);
    TEST_ASSERT_TRUE(node.takeStatusDue());
    TEST_ASSERT_EQUAL(1, node.hellos());
}

static void test_gateway_timeout_and_recovery() {
    registered();
    TEST_ASSERT_TRUE(node.takeStatusDue());
    now += LINK_PEER_TIMEOUT_MS - 1;
    node.tick(now);
    TEST_ASSERT_TRUE(node.mqttUp());
    now += 1;
    node.tick(now);
    TEST_ASSERT_FALSE(node.gatewayUp());
    TEST_ASSERT_FALSE(node.mqttUp());

    // The gateway is back and still knows us (it only lost the line).
    linkState(node, now, true, kBoot);
    TEST_ASSERT_TRUE(node.mqttUp());
    TEST_ASSERT_TRUE(node.takeStatusDue());
}

static void test_gateway_restart_hello_request() {
    registered();
    TEST_ASSERT_TRUE(node.takeStatusDue());
    // A fresh gateway asks who is there before anything else.
    TEST_ASSERT_EQUAL(NodeRx::None, node.onFrame(frame(Type::HelloRequest), now));
    TEST_ASSERT_EQUAL(2, countOf(Type::Hello));
    linkState(node, now, true, kBoot);
    TEST_ASSERT_TRUE(node.takeStatusDue());  // status again, the caller sends BOOT only once
}

static void test_heartbeat_when_quiet() {
    node.tick(now + LINK_HEARTBEAT_MS - 1);
    TEST_ASSERT_EQUAL(0, countOf(Type::Heartbeat));
    node.tick(now + LINK_HEARTBEAT_MS);
    TEST_ASSERT_EQUAL(1, countOf(Type::Heartbeat));
    TEST_ASSERT_EQUAL(0, sent[sentCount - 1].len);
    node.tick(now + LINK_HEARTBEAT_MS + 100);
    TEST_ASSERT_EQUAL(1, countOf(Type::Heartbeat));
}

static void test_command_and_invalid_frames() {
    registered();
    const Frame cmd = frame(Type::Command, "{\"a\":1}");
    TEST_ASSERT_EQUAL(NodeRx::Command, node.onFrame(cmd, now));
    TEST_ASSERT_EQUAL(7, cmd.len);

    TEST_ASSERT_EQUAL(NodeRx::Invalid, node.onFrame(frame(Type::Telemetry, "{}"), now));  // wrong direction
    TEST_ASSERT_EQUAL(NodeRx::Invalid, node.onFrame(frame(Type::Time, "{\"ts\":\"x\"}"), now));
    TEST_ASSERT_EQUAL(NodeRx::Invalid, node.onFrame(frame(Type::LinkState, "nope"), now));
    TEST_ASSERT_EQUAL(3, node.invalid());
    TEST_ASSERT_TRUE(node.mqttUp());  // a bad LINK_STATE keeps the last good one
}

static void test_wrong_direction_does_not_count_as_alive() {
    node.onFrame(frame(Type::Heartbeat), now);
    TEST_ASSERT_FALSE(node.gatewayUp());
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_boot_sends_hello);
    RUN_TEST(test_registration_then_status_once);
    RUN_TEST(test_send_only_while_mqtt_up);
    RUN_TEST(test_lost_hello_is_resent_throttled);
    RUN_TEST(test_broker_down_and_back_owes_status);
    RUN_TEST(test_gateway_timeout_and_recovery);
    RUN_TEST(test_gateway_restart_hello_request);
    RUN_TEST(test_heartbeat_when_quiet);
    RUN_TEST(test_command_and_invalid_frames);
    RUN_TEST(test_wrong_direction_does_not_count_as_alive);
    return UNITY_END();
}
