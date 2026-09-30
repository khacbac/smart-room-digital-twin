// lib/link on the host: CRC, COBS, raw / stream frames, liveness and the link-only
// JSON bodies (docs/link-protocol.md). Run with `pio test -e native`.
//
// The golden byte vectors are also listed in the doc (§3.4); a PC-side fake peer must
// produce the same bytes.

#include <string.h>
#include <unity.h>

#include "link_frame.h"
#include "link_messages.h"
#include "link_peer.h"

using namespace lnk;

void setUp() {}
void tearDown() {}

static const uint8_t* bytes(const char* s) { return (const uint8_t*)s; }

// Feeds `n` bytes and returns how many frames completed.
static int feed(StreamDecoder& d, const uint8_t* in, size_t n) {
    int frames = 0;
    for (size_t i = 0; i < n; i++) frames += d.push(in[i]) ? 1 : 0;
    return frames;
}

// ---- CRC / COBS ----------------------------------------------------------------------

static void test_crc16_check_value() { TEST_ASSERT_EQUAL_HEX16(0x29B1, crc16(bytes("123456789"), 9)); }

static void test_cobs_known_vector() {
    const uint8_t in[] = {0x11, 0x22, 0x00, 0x33};
    const uint8_t want[] = {0x03, 0x11, 0x22, 0x02, 0x33};
    uint8_t out[8];
    TEST_ASSERT_EQUAL(sizeof(want), cobsEncode(in, sizeof(in), out, sizeof(out)));
    TEST_ASSERT_EQUAL_HEX8_ARRAY(want, out, sizeof(want));
}

static void roundtrip(const uint8_t* in, size_t n) {
    static uint8_t enc[cobsMaxEncoded(2048)];
    static uint8_t dec[2048];
    const size_t m = cobsEncode(in, n, enc, sizeof(enc));
    TEST_ASSERT_TRUE(m > 0 && m <= cobsMaxEncoded(n));
    for (size_t i = 0; i < m; i++) TEST_ASSERT_NOT_EQUAL(0, enc[i]);
    TEST_ASSERT_EQUAL(n, cobsDecode(enc, m, dec, sizeof(dec)));
    TEST_ASSERT_EQUAL_MEMORY(in, dec, n);
}

static void test_cobs_roundtrip_block_edges() {
    static uint8_t buf[1100];
    // All non-zero around the 254-byte block boundary, then with zeros sprinkled in.
    const size_t sizes[] = {1, 253, 254, 255, 508, 1029};
    for (size_t s : sizes) {
        for (size_t i = 0; i < s; i++) buf[i] = (uint8_t)(i % 255 + 1);
        roundtrip(buf, s);
        for (size_t i = 0; i < s; i += 7) buf[i] = 0;
        roundtrip(buf, s);
    }
    memset(buf, 0, 300);
    roundtrip(buf, 300);
}

static void test_cobs_rejects_bad_input() {
    uint8_t out[16];
    const uint8_t zeroInside[] = {0x03, 0x11, 0x00};
    const uint8_t truncated[] = {0x05, 0x11, 0x22};
    TEST_ASSERT_EQUAL(0, cobsDecode(zeroInside, sizeof(zeroInside), out, sizeof(out)));
    TEST_ASSERT_EQUAL(0, cobsDecode(truncated, sizeof(truncated), out, sizeof(out)));

    const uint8_t in[] = {1, 2, 3, 4};
    TEST_ASSERT_EQUAL(0, cobsEncode(in, sizeof(in), out, 4));  // needs 5
}

// ---- Raw frames ----------------------------------------------------------------------

static void test_raw_golden_heartbeat() {
    const uint8_t want[] = {0x01, 0x06, 0x07, 0xED, 0x21};
    uint8_t out[8];
    TEST_ASSERT_EQUAL(sizeof(want), encodeRaw(Type::Heartbeat, 7, nullptr, 0, out, sizeof(out)));
    TEST_ASSERT_EQUAL_HEX8_ARRAY(want, out, sizeof(want));
}

static void test_raw_roundtrip() {
    const char* json = "{\"v\":1,\"deviceId\":\"room-01\"}";
    uint8_t out[kRawMax];
    const size_t n = encodeRaw(Type::Status, 200, bytes(json), strlen(json), out, sizeof(out));
    TEST_ASSERT_EQUAL(kHeaderSize + strlen(json) + kCrcSize, n);

    Frame f;
    TEST_ASSERT_EQUAL(DecodeError::None, decodeRaw(out, n, f));
    TEST_ASSERT_EQUAL(kVersion, f.version);
    TEST_ASSERT_TRUE(f.type == Type::Status);
    TEST_ASSERT_EQUAL(200, f.seq);
    TEST_ASSERT_EQUAL(strlen(json), f.len);
    TEST_ASSERT_EQUAL_MEMORY(json, f.payload, f.len);
}

static void test_raw_payload_limits() {
    static uint8_t payload[LINK_PAYLOAD_MAX + 1];
    static uint8_t out[kRawMax + 8];
    memset(payload, 'x', sizeof(payload));
    TEST_ASSERT_EQUAL(kRawMax, encodeRaw(Type::Telemetry, 0, payload, LINK_PAYLOAD_MAX, out, sizeof(out)));
    TEST_ASSERT_EQUAL(0, encodeRaw(Type::Telemetry, 0, payload, LINK_PAYLOAD_MAX + 1, out, sizeof(out)));
    TEST_ASSERT_EQUAL(0, encodeRaw(Type::Telemetry, 0, payload, 10, out, 14));  // needs 15
}

static void test_raw_decode_errors() {
    uint8_t f[16];
    Frame out;
    const size_t n = encodeRaw(Type::Event, 1, bytes("{}"), 2, f, sizeof(f));

    TEST_ASSERT_EQUAL(DecodeError::TooShort, decodeRaw(f, 4, out));

    f[3] ^= 0x01;
    TEST_ASSERT_EQUAL(DecodeError::BadCrc, decodeRaw(f, n, out));
    f[3] ^= 0x01;

    // Valid CRC but a future version / unknown type (re-sealed by hand).
    auto reseal = [&](uint8_t idx, uint8_t value) {
        f[idx] = value;
        const uint16_t crc = crc16(f, n - kCrcSize);
        f[n - 2] = (uint8_t)(crc & 0xFF);
        f[n - 1] = (uint8_t)(crc >> 8);
    };
    reseal(0, 2);
    TEST_ASSERT_EQUAL(DecodeError::BadVersion, decodeRaw(f, n, out));
    reseal(0, kVersion);
    reseal(1, 0x7F);
    TEST_ASSERT_EQUAL(DecodeError::UnknownType, decodeRaw(f, n, out));
}

static void test_type_direction() {
    TEST_ASSERT_TRUE(fromNode(Type::Telemetry));
    TEST_ASSERT_TRUE(fromNode(Type::Heartbeat));
    TEST_ASSERT_FALSE(fromNode(Type::Command));
    TEST_ASSERT_FALSE(fromNode(Type::HelloRequest));
    TEST_ASSERT_EQUAL_STRING("LINK_STATE", typeName(Type::LinkState));
}

// ---- Stream frames -------------------------------------------------------------------

static void test_stream_golden_command() {
    const uint8_t want[] = {0x03, 0x01, 0x81, 0x0A, 0x7B, 0x22, 0x61, 0x22, 0x3A, 0x31, 0x7D, 0xBA, 0x59, 0x00};
    uint8_t out[kWireMax];
    TEST_ASSERT_EQUAL(sizeof(want), encodeStream(Type::Command, 0, bytes("{\"a\":1}"), 7, out, sizeof(out)));
    TEST_ASSERT_EQUAL_HEX8_ARRAY(want, out, sizeof(want));
}

static void test_stream_decoder_back_to_back() {
    uint8_t wire[64];
    size_t n = encodeStream(Type::Heartbeat, 1, nullptr, 0, wire, sizeof(wire));
    n += encodeStream(Type::Ack, 2, bytes("{\"ok\":1}"), 8, wire + n, sizeof(wire) - n);

    StreamDecoder d;
    int got = 0;
    for (size_t i = 0; i < n; i++) {
        if (!d.push(wire[i])) continue;
        got++;
        if (got == 1) {
            TEST_ASSERT_TRUE(d.frame().type == Type::Heartbeat);
            TEST_ASSERT_EQUAL(0, d.frame().len);
        } else {
            TEST_ASSERT_TRUE(d.frame().type == Type::Ack);
            TEST_ASSERT_EQUAL(2, d.frame().seq);
            TEST_ASSERT_EQUAL_MEMORY("{\"ok\":1}", d.frame().payload, 8);
        }
    }
    TEST_ASSERT_EQUAL(2, got);
    TEST_ASSERT_EQUAL(2, d.stats().frames);
    TEST_ASSERT_EQUAL(0, d.stats().errors);
}

static void test_stream_decoder_resyncs_after_noise() {
    uint8_t wire[64];
    const size_t n = encodeStream(Type::Telemetry, 9, bytes("{\"t\":1}"), 7, wire, sizeof(wire));
    StreamDecoder d;

    // Idle delimiters are ignored, noise before the first delimiter is one dropped frame.
    const uint8_t idle[] = {0x00, 0x00};
    const uint8_t noise[] = {0x5A, 0xA5, 0x13, 0x00};
    TEST_ASSERT_EQUAL(0, feed(d, idle, sizeof(idle)));
    TEST_ASSERT_EQUAL(0, feed(d, noise, sizeof(noise)));
    TEST_ASSERT_EQUAL(1, d.stats().errors);

    // A corrupted byte mid-frame drops only that frame.
    uint8_t bad[64];
    memcpy(bad, wire, n);
    bad[5] ^= 0x40;
    TEST_ASSERT_EQUAL(0, feed(d, bad, n));
    TEST_ASSERT_EQUAL(DecodeError::BadCrc, d.lastError());

    TEST_ASSERT_EQUAL(1, feed(d, wire, n));
    TEST_ASSERT_EQUAL(9, d.frame().seq);
    TEST_ASSERT_EQUAL(2, d.stats().errors);
}

static void test_stream_decoder_overflow() {
    StreamDecoder d;
    for (size_t i = 0; i < kWireMax + 10; i++) d.push(0x41);
    TEST_ASSERT_FALSE(d.push(0x00));
    TEST_ASSERT_EQUAL(DecodeError::TooLong, d.lastError());
    TEST_ASSERT_EQUAL(1, d.stats().overflows);

    uint8_t wire[16];
    const size_t n = encodeStream(Type::Heartbeat, 3, nullptr, 0, wire, sizeof(wire));
    TEST_ASSERT_EQUAL(1, feed(d, wire, n));
}

static void test_stream_max_payload() {
    static uint8_t payload[LINK_PAYLOAD_MAX];
    static uint8_t wire[kWireMax];
    for (size_t i = 0; i < sizeof(payload); i++) payload[i] = (uint8_t)i;  // includes zeros
    const size_t n = encodeStream(Type::Status, 4, payload, sizeof(payload), wire, sizeof(wire));
    TEST_ASSERT_TRUE(n > 0 && n <= kWireMax);

    static StreamDecoder d;
    TEST_ASSERT_EQUAL(1, feed(d, wire, n));
    TEST_ASSERT_EQUAL(LINK_PAYLOAD_MAX, d.frame().len);
    TEST_ASSERT_EQUAL_MEMORY(payload, d.frame().payload, LINK_PAYLOAD_MAX);
}

// ---- Liveness ------------------------------------------------------------------------

static void test_tx_tracker() {
    TxTracker tx;
    TEST_ASSERT_TRUE(tx.heartbeatDue(0));
    TEST_ASSERT_EQUAL(0, tx.take(1000));
    TEST_ASSERT_FALSE(tx.heartbeatDue(1000 + LINK_HEARTBEAT_MS - 1));
    TEST_ASSERT_TRUE(tx.heartbeatDue(1000 + LINK_HEARTBEAT_MS));
    for (int i = 1; i < 256; i++) tx.take(2000);
    TEST_ASSERT_EQUAL(0, tx.take(2000));  // wrapped
}

static void test_peer_monitor_presence() {
    PeerMonitor p;
    TEST_ASSERT_FALSE(p.up());
    TEST_ASSERT_TRUE(p.onFrame(0, 1000) == PeerChange::Up);
    TEST_ASSERT_TRUE(p.onFrame(1, 2000) == PeerChange::None);
    TEST_ASSERT_TRUE(p.tick(2000 + LINK_PEER_TIMEOUT_MS - 1) == PeerChange::None);
    TEST_ASSERT_TRUE(p.tick(2000 + LINK_PEER_TIMEOUT_MS) == PeerChange::Down);
    TEST_ASSERT_TRUE(p.tick(2000 + LINK_PEER_TIMEOUT_MS * 2) == PeerChange::None);  // already down
    TEST_ASSERT_TRUE(p.onFrame(50, 40000) == PeerChange::Up);
    TEST_ASSERT_EQUAL(0, p.lost());  // no gap counted across the outage
}

// Also covers the uint32_t millis() wrap: elapsed time is unsigned subtraction.
static void test_peer_monitor_millis_wrap() {
    PeerMonitor p;
    const uint32_t t0 = 0xFFFFF000u;
    p.onFrame(0, t0);
    TEST_ASSERT_TRUE(p.tick(t0 + 1000) == PeerChange::None);
    TEST_ASSERT_TRUE(p.tick(t0 + LINK_PEER_TIMEOUT_MS) == PeerChange::Down);
}

static void test_peer_monitor_seq_gaps() {
    PeerMonitor p;
    p.onFrame(250, 0);
    p.onFrame(253, 0);  // 251, 252 lost
    p.onFrame(253, 0);  // duplicate
    p.onFrame(1, 0);    // 254, 255, 0 lost across the wrap
    TEST_ASSERT_EQUAL(5, p.lost());
    TEST_ASSERT_EQUAL(1, p.duplicates());

    p.resetSeq();  // HELLO: peer rebooted, seq restarts at 0
    p.onFrame(0, 0);
    TEST_ASSERT_EQUAL(5, p.lost());
}

// ---- Link-only JSON ------------------------------------------------------------------

static void test_hello_roundtrip() {
    char out[128];
    const size_t n = buildHello("room-01", "a1b2c3d4", "0.2.0", out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"deviceId\":\"room-01\",\"bootId\":\"a1b2c3d4\",\"fw\":\"0.2.0\"}", out);

    Hello h;
    TEST_ASSERT_TRUE(parseHello(bytes(out), n, h));
    TEST_ASSERT_EQUAL_STRING("room-01", h.deviceId);
    TEST_ASSERT_EQUAL_STRING("a1b2c3d4", h.bootId);
    TEST_ASSERT_EQUAL_STRING("0.2.0", h.fw);
}

static void test_hello_rejects_bad_fields() {
    Hello h;
    const char* missing = "{\"bootId\":\"a1b2c3d4\",\"fw\":\"0.2.0\"}";
    const char* longId = "{\"deviceId\":\"room-0123456789012345678901234567890\",\"bootId\":\"a1b2c3d4\",\"fw\":\"x\"}";
    const char* shortBoot = "{\"deviceId\":\"room-01\",\"bootId\":\"a1b2\",\"fw\":\"x\"}";
    TEST_ASSERT_FALSE(parseHello(bytes(missing), strlen(missing), h));
    TEST_ASSERT_FALSE(parseHello(bytes(longId), strlen(longId), h));
    TEST_ASSERT_FALSE(parseHello(bytes(shortBoot), strlen(shortBoot), h));
    TEST_ASSERT_FALSE(parseHello(bytes("not json"), 8, h));
}

static void test_time_roundtrip() {
    char out[64];
    const size_t n = buildTime(1790591200123LL, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"ts\":1790591200123}", out);
    int64_t ts = 0;
    TEST_ASSERT_TRUE(parseTime(bytes(out), n, ts));
    TEST_ASSERT_TRUE(ts == 1790591200123LL);
    TEST_ASSERT_FALSE(parseTime(bytes("{\"ts\":null}"), 11, ts));
    TEST_ASSERT_EQUAL(0, buildTime(1790591200123LL, out, 10));  // does not fit
}

static void test_link_state_roundtrip() {
    char out[64];
    size_t n = buildLinkState({true, true, -61, true, "a1b2c3d4"}, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"mqtt\":true,\"rssi\":-61,\"bootId\":\"a1b2c3d4\"}", out);
    LinkState s{};
    TEST_ASSERT_TRUE(parseLinkState(bytes(out), n, s));
    TEST_ASSERT_TRUE(s.mqtt && s.hasRssi && s.hasBootId);
    TEST_ASSERT_EQUAL(-61, s.rssi);
    TEST_ASSERT_EQUAL_STRING("a1b2c3d4", s.bootId);

    // No HELLO yet: no bootId.
    n = buildLinkState({false, false, 0, false, ""}, out, sizeof(out));
    TEST_ASSERT_EQUAL_STRING("{\"mqtt\":false}", out);
    TEST_ASSERT_TRUE(parseLinkState(bytes(out), n, s));
    TEST_ASSERT_FALSE(s.mqtt || s.hasRssi || s.hasBootId);
    TEST_ASSERT_EQUAL_STRING("", s.bootId);

    const char* badBoot = "{\"mqtt\":true,\"bootId\":\"xyz\"}";
    TEST_ASSERT_FALSE(parseLinkState(bytes(badBoot), strlen(badBoot), s));
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_crc16_check_value);
    RUN_TEST(test_cobs_known_vector);
    RUN_TEST(test_cobs_roundtrip_block_edges);
    RUN_TEST(test_cobs_rejects_bad_input);
    RUN_TEST(test_raw_golden_heartbeat);
    RUN_TEST(test_raw_roundtrip);
    RUN_TEST(test_raw_payload_limits);
    RUN_TEST(test_raw_decode_errors);
    RUN_TEST(test_type_direction);
    RUN_TEST(test_stream_golden_command);
    RUN_TEST(test_stream_decoder_back_to_back);
    RUN_TEST(test_stream_decoder_resyncs_after_noise);
    RUN_TEST(test_stream_decoder_overflow);
    RUN_TEST(test_stream_max_payload);
    RUN_TEST(test_tx_tracker);
    RUN_TEST(test_peer_monitor_presence);
    RUN_TEST(test_peer_monitor_millis_wrap);
    RUN_TEST(test_peer_monitor_seq_gaps);
    RUN_TEST(test_hello_roundtrip);
    RUN_TEST(test_hello_rejects_bad_fields);
    RUN_TEST(test_time_roundtrip);
    RUN_TEST(test_link_state_roundtrip);
    return UNITY_END();
}
