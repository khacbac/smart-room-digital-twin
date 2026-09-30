// lib/protocol on the host (§19 Phase 3): §5.3–§5.5 / §5.7 payloads, and command
// parse / validate / dedup / execute (§5.6, §5.7). Run with `pio test -e native`.

#include <ArduinoJson.h>
#include <string.h>
#include <unity.h>

#include "commands.h"
#include "edge_rules.h"
#include "payloads.h"

using namespace edge;
using namespace proto;

static Engine engine;
static CommandHandler* handler;
static uint32_t now;
static char out[MQTT_PAYLOAD_MAX + 1];
static JsonDocument doc;

static const Meta kMeta{"room-01", "a1b2c3d4", 1532, true, 1790591200123LL};
static const Meta kMetaNoTs{"room-01", "a1b2c3d4", 7, false, 0};

void setUp() {
    now = 1000;
    engine.begin(now);
    delete handler;
    handler = new CommandHandler();
}

void tearDown() {}

// ---- Helpers -------------------------------------------------------------------

static void cycle(float t, float h, float aq) {
    now += SAMPLE_INTERVAL_MS;
    engine.pushDht(t, h, now);
    engine.pushAnalog(420.54f, aq, true);
    engine.evaluate(now);
    engine.tick(now);
}

static void settle(float t, float h, float aq) {
    for (int i = 0; i < SMOOTH_WINDOW; i++) cycle(t, h, aq);
}

static void drainEvents() {
    Event e;
    while (engine.popEvent(e)) {}
}

static Event nextEvent() {
    Event e{};
    TEST_ASSERT_TRUE_MESSAGE(engine.popEvent(e), "expected an event");
    return e;
}

// Parses `out` (length n) into `doc`.
static void parse(size_t n) {
    TEST_ASSERT_GREATER_THAN(0, n);
    TEST_ASSERT_EQUAL(strlen(out), n);
    TEST_ASSERT_FALSE(deserializeJson(doc, out, n));
}

static CommandResult command(const char* json) {
    return handler->handle(engine, json, strlen(json), now);
}

static void assertAck(const CommandResult& r, AckStatus status, RejectReason reason) {
    TEST_ASSERT_TRUE(r.ackable);
    TEST_ASSERT_EQUAL_STRING(ackStatusName(status), ackStatusName(r.status));
    TEST_ASSERT_EQUAL(reason, r.reason);
}

static void assertRejected(const char* json, RejectReason reason) {
    const bool windowBefore = engine.windowOverridden(), buzzerBefore = engine.buzzerOverridden();
    const CommandResult r = command(json);
    TEST_ASSERT_EQUAL_STRING_MESSAGE(rejectReasonName(reason), rejectReasonName(r.reason), json);
    assertAck(r, AckStatus::Rejected, reason);
    TEST_ASSERT_FALSE(r.executed);
    TEST_ASSERT_EQUAL(windowBefore, engine.windowOverridden());
    TEST_ASSERT_EQUAL(buzzerBefore, engine.buzzerOverridden());
}

// ---- Telemetry (§5.3) ------------------------------------------------------------

static void test_telemetry_fields_and_rounding() {
    settle(31.24f, 75.36f, 680);
    parse(buildTelemetry(engine, kMeta, out, sizeof(out)));

    TEST_ASSERT_EQUAL(1, doc["v"].as<int>());
    TEST_ASSERT_EQUAL_STRING("room-01", doc["deviceId"]);
    TEST_ASSERT_EQUAL_STRING("a1b2c3d4", doc["bootId"]);
    TEST_ASSERT_EQUAL(1532, doc["seq"].as<int>());
    TEST_ASSERT_TRUE(doc["ts"].as<int64_t>() == 1790591200123LL);  // 64-bit ms, no overflow
    TEST_ASSERT_NOT_NULL(strstr(out, "\"ts\":1790591200123"));
    TEST_ASSERT_NOT_NULL(strstr(out, "\"temperature\":31.2,"));
    TEST_ASSERT_NOT_NULL(strstr(out, "\"humidity\":75.4,"));
    TEST_ASSERT_NOT_NULL(strstr(out, "\"light\":420.5,"));
    TEST_ASSERT_NOT_NULL(strstr(out, "\"airQuality\":680,"));
    TEST_ASSERT_TRUE(doc["presence"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("WARNING", doc["edgeState"]);
    TEST_ASSERT_EQUAL(0, doc["actuators"]["windowAngle"].as<int>());
    TEST_ASSERT_FALSE(doc["actuators"]["buzzer"].as<bool>());
    TEST_ASSERT_FALSE(doc["override"]["window"].as<bool>());
    TEST_ASSERT_FALSE(doc["override"]["buzzer"].as<bool>());
    TEST_ASSERT_TRUE(doc["override"]["expiresInSec"].isUnbound());  // status/ack only
}

static void test_telemetry_null_ts_and_dht() {
    engine.pushAnalog(400, 300, false);  // no DHT reading yet
    parse(buildTelemetry(engine, kMetaNoTs, out, sizeof(out)));
    TEST_ASSERT_NOT_NULL(strstr(out, "\"ts\":null,"));  // present, not omitted
    TEST_ASSERT_NOT_NULL(strstr(out, "\"temperature\":null,\"humidity\":null,"));
    TEST_ASSERT_EQUAL(300, doc["airQuality"].as<int>());
}

static void test_telemetry_buzzer_is_logical_state() {
    settle(25, 50, 950);  // DANGER: the pin toggles, the logical alarm stays on
    now += BUZZER_HALF_PERIOD_MS;
    TEST_ASSERT_FALSE(engine.tick(now).buzzerPin);
    parse(buildTelemetry(engine, kMeta, out, sizeof(out)));
    TEST_ASSERT_TRUE(doc["actuators"]["buzzer"].as<bool>());
    TEST_ASSERT_EQUAL(90, doc["actuators"]["windowAngle"].as<int>());
}

static void test_payload_too_small_buffer_returns_0() {
    settle(25, 50, 300);
    char small[32];
    TEST_ASSERT_EQUAL(0, buildTelemetry(engine, kMeta, small, sizeof(small)));
}

// ---- Status (§5.4) -----------------------------------------------------------------

static void test_status_fields() {
    settle(25, 50, 300);
    engine.overrideWindow(45, OverrideSource::Dashboard, now);
    now += 20500;
    const StatusInfo info{"0.1.0", 3605, -55};
    parse(buildStatus(engine, kMeta, info, now, out, sizeof(out)));

    TEST_ASSERT_EQUAL(1, doc["v"].as<int>());
    TEST_ASSERT_TRUE(doc["online"].as<bool>());
    TEST_ASSERT_EQUAL_STRING("a1b2c3d4", doc["bootId"]);
    TEST_ASSERT_TRUE(doc["seq"].isUnbound());
    TEST_ASSERT_EQUAL_STRING("0.1.0", doc["fw"]);
    TEST_ASSERT_EQUAL(3605, doc["uptimeSec"].as<int>());
    TEST_ASSERT_EQUAL(-55, doc["rssi"].as<int>());
    TEST_ASSERT_EQUAL_STRING("NORMAL", doc["edgeState"]);
    TEST_ASSERT_EQUAL(45, doc["actuators"]["windowAngle"].as<int>());
    TEST_ASSERT_TRUE(doc["override"]["window"].as<bool>());
    TEST_ASSERT_FALSE(doc["override"]["buzzer"].as<bool>());
    TEST_ASSERT_EQUAL(100, doc["override"]["expiresInSec"].as<int>());  // 120 − 20.5, rounded up
    TEST_ASSERT_FALSE(doc["sensorFault"]["dht"].as<bool>());
}

// ---- Events (§5.5) -------------------------------------------------------------------

static void test_state_changed_event() {
    cycle(25, 50, 950);  // first sample, so the average is 950 right away
    parse(buildEvent(nextEvent(), kMeta, out, sizeof(out)));

    TEST_ASSERT_EQUAL(1532, doc["seq"].as<int>());
    TEST_ASSERT_EQUAL_STRING("STATE_CHANGED", doc["type"]);
    TEST_ASSERT_EQUAL_STRING("critical", doc["severity"]);
    TEST_ASSERT_EQUAL_STRING("NORMAL -> DANGER", doc["message"]);
    TEST_ASSERT_EQUAL_STRING("NORMAL", doc["data"]["from"]);
    TEST_ASSERT_EQUAL_STRING("DANGER", doc["data"]["to"]);
    TEST_ASSERT_EQUAL(1, doc["data"]["reasons"].size());
    TEST_ASSERT_EQUAL_STRING("airQuality>=900", doc["data"]["reasons"][0]);
}

static void test_step_down_event_lists_exit_reasons() {
    settle(34.5f, 50, 950);
    drainEvents();
    settle(26, 50, 300);
    now += MIN_STATE_HOLD_MS;
    cycle(26, 50, 300);
    parse(buildEvent(nextEvent(), kMeta, out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("DANGER -> WARNING", doc["message"]);
    TEST_ASSERT_EQUAL_STRING("warning", doc["severity"]);
    TEST_ASSERT_EQUAL(2, doc["data"]["reasons"].size());
    TEST_ASSERT_EQUAL_STRING("temperature<33.0", doc["data"]["reasons"][0]);
    TEST_ASSERT_EQUAL_STRING("airQuality<850", doc["data"]["reasons"][1]);
}

static void test_sensor_fault_and_button_events() {
    for (int i = 0; i < 12; i++) cycle(NAN, NAN, 300);
    parse(buildEvent(nextEvent(), kMeta, out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("SENSOR_FAULT", doc["type"]);
    TEST_ASSERT_EQUAL_STRING("warning", doc["severity"]);
    TEST_ASSERT_EQUAL_STRING("dht", doc["data"]["sensor"]);

    engine.onButton(Press::Short, now);
    parse(buildEvent(nextEvent(), kMeta, out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("BUTTON_PRESSED", doc["type"]);
    TEST_ASSERT_EQUAL_STRING("short", doc["data"]["press"]);

    parse(buildEvent(nextEvent(), kMeta, out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("OVERRIDE_SET", doc["type"]);
    TEST_ASSERT_EQUAL_STRING("buzzer", doc["data"]["actuator"]);
    TEST_ASSERT_FALSE(doc["data"]["value"].as<bool>());
    TEST_ASSERT_TRUE(doc["data"]["value"].is<bool>());
    TEST_ASSERT_EQUAL(MANUAL_OVERRIDE_SEC, doc["data"]["durationSec"].as<int>());
    TEST_ASSERT_EQUAL_STRING("button", doc["data"]["source"]);
}

static void test_override_events() {
    settle(25, 50, 300);
    drainEvents();
    engine.overrideWindow(60, OverrideSource::Dashboard, now);
    parse(buildEvent(nextEvent(), kMeta, out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("OVERRIDE_SET", doc["type"]);
    TEST_ASSERT_EQUAL_STRING("info", doc["severity"]);
    TEST_ASSERT_EQUAL_STRING("window", doc["data"]["actuator"]);
    TEST_ASSERT_EQUAL(60, doc["data"]["value"].as<int>());
    TEST_ASSERT_EQUAL_STRING("dashboard", doc["data"]["source"]);

    engine.clearOverrides(ClearReason::Command);
    parse(buildEvent(nextEvent(), kMeta, out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("OVERRIDE_CLEARED", doc["type"]);
    TEST_ASSERT_EQUAL_STRING("window", doc["data"]["actuator"]);
    TEST_ASSERT_EQUAL_STRING("command", doc["data"]["reason"]);
}

static void test_boot_event() {
    parse(buildBootEvent(kMetaNoTs, "0.1.0", "POWERON", out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("BOOT", doc["type"]);
    TEST_ASSERT_EQUAL_STRING("info", doc["severity"]);
    TEST_ASSERT_EQUAL(7, doc["seq"].as<int>());
    TEST_ASSERT_TRUE(doc["ts"].isNull());
    TEST_ASSERT_EQUAL_STRING("0.1.0", doc["data"]["fw"]);
    TEST_ASSERT_EQUAL_STRING("POWERON", doc["data"]["resetReason"]);
}

static void test_command_rejected_event_truncates_raw() {
    char raw[300];
    memset(raw, 'x', sizeof(raw));
    raw[0] = '"';  // escaped in the output
    parse(buildCommandRejectedEvent(kMeta, raw, sizeof(raw), out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("COMMAND_REJECTED", doc["type"]);
    TEST_ASSERT_EQUAL_STRING("warning", doc["severity"]);
    const char* text = doc["data"]["raw"];
    TEST_ASSERT_EQUAL(128, strlen(text));
    TEST_ASSERT_EQUAL('"', text[0]);
}

// ---- Commands (§5.6, §5.7) --------------------------------------------------------

static void test_open_window_default_and_value() {
    settle(25, 50, 300);
    CommandResult r = command(R"({"v":1,"commandId":"c1","action":"OPEN_WINDOW","source":"dashboard","ts":1})");
    assertAck(r, AckStatus::Executed, RejectReason::None);
    TEST_ASSERT_TRUE(r.executed);
    TEST_ASSERT_FALSE(r.duplicate);
    TEST_ASSERT_EQUAL_STRING("c1", r.commandId);
    TEST_ASSERT_EQUAL(90, engine.windowAngle());
    TEST_ASSERT_TRUE(engine.windowOverridden());
    const Event e = nextEvent();
    TEST_ASSERT_EQUAL(EventType::OverrideSet, e.type);
    TEST_ASSERT_EQUAL(OverrideSource::Dashboard, e.source);

    r = command(R"({"v":1,"commandId":"c2","action":"OPEN_WINDOW","value":45,"source":"ai"})");
    assertAck(r, AckStatus::Executed, RejectReason::None);
    TEST_ASSERT_EQUAL(45, engine.windowAngle());
    r = command(R"({"v":1,"commandId":"c3","action":"OPEN_WINDOW","value":null,"source":"api"})");
    assertAck(r, AckStatus::Executed, RejectReason::None);
    TEST_ASSERT_EQUAL(90, engine.windowAngle());
}

static void test_close_window_buzzer_clear_ping() {
    settle(25, 50, 950);  // DANGER: window 90, buzzer on
    assertAck(command(R"({"v":1,"commandId":"a","action":"CLOSE_WINDOW","value":999,"source":"api"})"),
              AckStatus::Executed, RejectReason::None);  // value ignored
    TEST_ASSERT_EQUAL(0, engine.windowAngle());
    assertAck(command(R"({"v":1,"commandId":"b","action":"BUZZER_OFF","source":"api"})"), AckStatus::Executed,
              RejectReason::None);
    TEST_ASSERT_FALSE(engine.buzzerOn());
    TEST_ASSERT_TRUE(engine.buzzerOverridden());
    TEST_ASSERT_EQUAL_STRING("DANGER", stateName(engine.state()));  // state keeps running

    drainEvents();
    assertAck(command(R"({"v":1,"commandId":"c","action":"CLEAR_OVERRIDE","source":"api"})"), AckStatus::Executed,
              RejectReason::None);
    TEST_ASSERT_FALSE(engine.windowOverridden());
    TEST_ASSERT_FALSE(engine.buzzerOverridden());
    TEST_ASSERT_EQUAL(90, engine.windowAngle());
    TEST_ASSERT_TRUE(engine.buzzerOn());
    TEST_ASSERT_EQUAL(ClearReason::Command, nextEvent().clearReason);

    drainEvents();
    const CommandResult r = command(R"({"v":1,"commandId":"d","action":"PING","source":"api"})");
    assertAck(r, AckStatus::Executed, RejectReason::None);
    Event e;
    TEST_ASSERT_FALSE(engine.popEvent(e));  // no effect

    settle(25, 50, 300);
    assertAck(command(R"({"v":1,"commandId":"e","action":"BUZZER_ON","source":"api"})"), AckStatus::Executed,
              RejectReason::None);
    TEST_ASSERT_TRUE(engine.buzzerOn());
}

static void test_validation_rejects_with_reason() {
    settle(25, 50, 300);
    assertRejected(R"({"v":2,"commandId":"r1","action":"PING","source":"api"})", RejectReason::UnsupportedVersion);
    assertRejected(R"({"commandId":"r2","action":"PING","source":"api"})", RejectReason::InvalidPayload);
    assertRejected(R"({"v":"1","commandId":"r3","action":"PING","source":"api"})", RejectReason::InvalidPayload);
    assertRejected(R"({"v":1,"commandId":"r4","action":"FLY","source":"api"})", RejectReason::UnknownAction);
    assertRejected(R"({"v":1,"commandId":"r5","source":"api"})", RejectReason::InvalidPayload);
    assertRejected(R"({"v":1,"commandId":"r6","action":"PING"})", RejectReason::InvalidPayload);
    assertRejected(R"({"v":1,"commandId":"r7","action":"PING","source":"button"})", RejectReason::InvalidPayload);
    assertRejected(R"({"v":1,"commandId":"r8","action":"OPEN_WINDOW","value":0,"source":"api"})",
                   RejectReason::ValueOutOfRange);
    assertRejected(R"({"v":1,"commandId":"r9","action":"OPEN_WINDOW","value":91,"source":"api"})",
                   RejectReason::ValueOutOfRange);
    assertRejected(R"({"v":1,"commandId":"r10","action":"OPEN_WINDOW","value":45.5,"source":"api"})",
                   RejectReason::InvalidPayload);
    assertRejected(R"({"v":1,"commandId":"r11","action":"OPEN_WINDOW","value":"45","source":"api"})",
                   RejectReason::InvalidPayload);
}

static void test_unparsable_command_is_not_ackable() {
    const char* bad[] = {
        "not json",
        R"({"v":1,"action":"PING","source":"api"})",
        R"({"v":1,"commandId":42,"action":"PING","source":"api"})",
        R"({"v":1,"commandId":"","action":"PING","source":"api"})",
        R"(["commandId","x"])",
        R"({"v":1,"commandId":"12345678901234567890123456789012345678901234567890123456789012345"})",  // 65
    };
    for (const char* json : bad) {
        const CommandResult r = command(json);
        TEST_ASSERT_FALSE_MESSAGE(r.ackable, json);
        TEST_ASSERT_FALSE(r.executed);
    }
}

static void test_duplicate_is_reacked_not_reexecuted() {
    settle(25, 50, 300);
    const char* open = R"({"v":1,"commandId":"7f1c2a9e-4b1d-4a5e-9d7a-2b6c1f0e8a11","action":"OPEN_WINDOW","source":"api"})";
    assertAck(command(open), AckStatus::Executed, RejectReason::None);
    engine.clearOverrides(ClearReason::Button);
    TEST_ASSERT_EQUAL(0, engine.windowAngle());
    drainEvents();

    const CommandResult r = command(open);  // QoS 1 redelivery
    assertAck(r, AckStatus::Executed, RejectReason::None);
    TEST_ASSERT_TRUE(r.duplicate);
    TEST_ASSERT_FALSE(r.executed);
    TEST_ASSERT_FALSE(engine.windowOverridden());
    Event e;
    TEST_ASSERT_FALSE(engine.popEvent(e));

    // A rejected result is stored too, and a duplicate is not re-validated.
    assertRejected(R"({"v":2,"commandId":"x","action":"PING","source":"api"})", RejectReason::UnsupportedVersion);
    const CommandResult again = command(R"({"v":1,"commandId":"x","action":"PING","source":"api"})");
    TEST_ASSERT_TRUE(again.duplicate);
    assertAck(again, AckStatus::Rejected, RejectReason::UnsupportedVersion);
}

static void test_dedup_keeps_last_16() {
    settle(25, 50, 300);
    char json[96];
    for (int i = 0; i <= COMMAND_DEDUP_SIZE; i++) {  // 17 ids: "id0" falls out
        snprintf(json, sizeof(json), R"({"v":1,"commandId":"id%d","action":"PING","source":"api"})", i);
        TEST_ASSERT_FALSE(command(json).duplicate);
    }
    snprintf(json, sizeof(json), R"({"v":1,"commandId":"id%d","action":"PING","source":"api"})", 1);
    TEST_ASSERT_TRUE(command(json).duplicate);
    snprintf(json, sizeof(json), R"({"v":1,"commandId":"id%d","action":"PING","source":"api"})", 0);
    TEST_ASSERT_FALSE(command(json).duplicate);
}

// ---- Ack (§5.7) ----------------------------------------------------------------------

static void test_ack_executed_and_rejected() {
    settle(25, 50, 300);
    CommandResult r = command(R"({"v":1,"commandId":"7f1c","action":"OPEN_WINDOW","value":90,"source":"dashboard"})");
    parse(buildAck(engine, kMeta, r, now, out, sizeof(out)));
    TEST_ASSERT_EQUAL(1, doc["v"].as<int>());
    TEST_ASSERT_EQUAL_STRING("room-01", doc["deviceId"]);
    TEST_ASSERT_EQUAL_STRING("7f1c", doc["commandId"]);
    TEST_ASSERT_EQUAL_STRING("executed", doc["status"]);
    TEST_ASSERT_NOT_NULL(strstr(out, "\"reason\":null,"));
    TEST_ASSERT_TRUE(doc["ts"].as<int64_t>() == 1790591200123LL);
    TEST_ASSERT_TRUE(doc["bootId"].isUnbound());
    TEST_ASSERT_EQUAL(90, doc["actuators"]["windowAngle"].as<int>());
    TEST_ASSERT_TRUE(doc["override"]["window"].as<bool>());
    TEST_ASSERT_EQUAL(MANUAL_OVERRIDE_SEC, doc["override"]["expiresInSec"].as<int>());

    r = command(R"({"v":1,"commandId":"bad","action":"OPEN_WINDOW","value":120,"source":"api"})");
    parse(buildAck(engine, kMetaNoTs, r, now, out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("rejected", doc["status"]);
    TEST_ASSERT_EQUAL_STRING("VALUE_OUT_OF_RANGE", doc["reason"]);
    TEST_ASSERT_TRUE(doc["ts"].isNull());
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_telemetry_fields_and_rounding);
    RUN_TEST(test_telemetry_null_ts_and_dht);
    RUN_TEST(test_telemetry_buzzer_is_logical_state);
    RUN_TEST(test_payload_too_small_buffer_returns_0);
    RUN_TEST(test_status_fields);
    RUN_TEST(test_state_changed_event);
    RUN_TEST(test_step_down_event_lists_exit_reasons);
    RUN_TEST(test_sensor_fault_and_button_events);
    RUN_TEST(test_override_events);
    RUN_TEST(test_boot_event);
    RUN_TEST(test_command_rejected_event_truncates_raw);
    RUN_TEST(test_open_window_default_and_value);
    RUN_TEST(test_close_window_buzzer_clear_ping);
    RUN_TEST(test_validation_rejects_with_reason);
    RUN_TEST(test_unparsable_command_is_not_ackable);
    RUN_TEST(test_duplicate_is_reacked_not_reexecuted);
    RUN_TEST(test_dedup_keeps_last_16);
    RUN_TEST(test_ack_executed_and_rejected);
    return UNITY_END();
}
