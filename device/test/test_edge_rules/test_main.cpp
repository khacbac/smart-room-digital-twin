// lib/edge_rules on the host (§19 Phase 2): escalation, step-down with hold time,
// hysteresis, null inputs, DHT fault, override set/expire/escalation, button,
// patterns and LCD rows. Run with `pio test -e native`.

#include <math.h>
#include <string.h>
#include <unity.h>

#include "edge_rules.h"
#include "lcd_format.h"

using namespace edge;

static Engine engine;
static uint32_t now;

void setUp() {
    now = 1000;
    engine.begin(now);
}

void tearDown() {}

// ---- Helpers -------------------------------------------------------------------

// One 1 s cycle as in main.cpp: DHT (NaN = read error), analog, then evaluate.
static void cycle(float t, float h, float aq) {
    now += SAMPLE_INTERVAL_MS;
    engine.pushDht(t, h, now);
    engine.pushAnalog(400, aq, false);
    engine.evaluate(now);
    engine.tick(now);
}

// Enough cycles to fill the smoothing window with the same values.
static void settle(float t, float h, float aq) {
    for (int i = 0; i < SMOOTH_WINDOW; i++) cycle(t, h, aq);
}

static void drainEvents() {
    Event e;
    while (engine.popEvent(e)) {}
}

// Pops events until one of `type` shows up; fails if none.
static Event expectEvent(EventType type) {
    Event e;
    while (engine.popEvent(e)) {
        if (e.type == type) return e;
    }
    TEST_FAIL_MESSAGE(eventTypeName(type));
    return e;
}

static int countEvents(EventType type) {
    int n = 0;
    Event e;
    while (engine.popEvent(e)) {
        if (e.type == type) n++;
    }
    return n;
}

static void assertState(State expected) {
    TEST_ASSERT_EQUAL_STRING(stateName(expected), stateName(engine.state()));
}

// Waits in the current state long enough for the next step-down.
static void holdAndCycle(float t, float h, float aq) {
    now += MIN_STATE_HOLD_MS;
    cycle(t, h, aq);
}

// ---- Preprocessing (§7.2) -------------------------------------------------------

static void test_not_ready_before_analog_sample() {
    TEST_ASSERT_FALSE(engine.ready());
    engine.evaluate(now);
    assertState(State::Normal);
    engine.pushAnalog(400, 950, false);
    TEST_ASSERT_TRUE(engine.ready());
}

static void test_moving_average_over_window() {
    MovingAverage avg;
    TEST_ASSERT_TRUE(isnan(avg.value()));
    avg.push(3);
    TEST_ASSERT_EQUAL_FLOAT(3, avg.value());
    avg.push(6);
    avg.push(9);
    TEST_ASSERT_EQUAL_FLOAT(6, avg.value());
    avg.push(12);  // drops 3
    TEST_ASSERT_EQUAL_FLOAT(9, avg.value());
}

static void test_invalid_values_keep_previous_smoothed_value() {
    settle(25, 50, 300);
    engine.pushDht(NAN, 50, now);
    engine.pushDht(25, 150, now);  // humidity out of range
    engine.pushDht(99, 50, now);   // temperature out of range
    engine.pushAnalog(-1, 2000, false);
    TEST_ASSERT_EQUAL_FLOAT(25, engine.temperature());
    TEST_ASSERT_EQUAL_FLOAT(50, engine.humidity());
    TEST_ASSERT_EQUAL_FLOAT(400, engine.light());
    TEST_ASSERT_EQUAL_FLOAT(300, engine.airQuality());
}

static void test_rules_run_on_smoothed_values() {
    settle(25, 50, 300);
    cycle(25, 50, 950);  // avg (300 + 300 + 950) / 3 = 516.7 → UNCOMFORTABLE, not DANGER
    assertState(State::Uncomfortable);
}

// ---- State machine (§7.4, §7.5) ------------------------------------------------

static void test_escalates_immediately_and_skips_levels() {
    settle(25, 50, 300);
    drainEvents();
    engine.pushAnalog(400, 950, false);
    engine.pushAnalog(400, 950, false);
    engine.pushAnalog(400, 950, false);
    engine.evaluate(now);  // no hold time for escalation
    assertState(State::Danger);

    const Event e = expectEvent(EventType::StateChanged);
    TEST_ASSERT_EQUAL(State::Normal, e.from);
    TEST_ASSERT_EQUAL(State::Danger, e.to);
    TEST_ASSERT_EQUAL(kReasonAirQuality, e.reasons);
    TEST_ASSERT_EQUAL_STRING("critical", severityName(e));
    char text[32];
    formatReason(e, kReasonAirQuality, text, sizeof(text));
    TEST_ASSERT_EQUAL_STRING("airQuality>=900", text);
}

static void test_escalation_reasons_list_every_enter_condition() {
    settle(34.5, 50, 950);
    const Event e = expectEvent(EventType::StateChanged);
    TEST_ASSERT_EQUAL(kReasonTemperature | kReasonAirQuality, e.reasons);
    char text[32];
    formatReason(e, kReasonTemperature, text, sizeof(text));
    TEST_ASSERT_EQUAL_STRING("temperature>=34.0", text);
}

static void test_humidity_only_raises_uncomfortable() {
    settle(25, 90, 300);
    assertState(State::Uncomfortable);
    const Event e = expectEvent(EventType::StateChanged);
    TEST_ASSERT_EQUAL(kReasonHumidity, e.reasons);
    TEST_ASSERT_EQUAL_STRING("info", severityName(e));
}

static void test_steps_down_one_level_per_evaluation_after_hold() {
    settle(34.5, 50, 950);  // DANGER entered on the first cycle
    const uint32_t enteredAt = now - (SMOOTH_WINDOW - 1) * SAMPLE_INTERVAL_MS;
    assertState(State::Danger);
    drainEvents();

    cycle(26, 50, 300);  // exit conditions hold, but only 3 s in DANGER
    cycle(26, 50, 300);
    TEST_ASSERT_EQUAL(MIN_STATE_HOLD_MS - SAMPLE_INTERVAL_MS, now - enteredAt);
    assertState(State::Danger);

    cycle(26, 50, 300);  // exactly MIN_STATE_HOLD_MS in DANGER
    assertState(State::Warning);
    const Event e = expectEvent(EventType::StateChanged);
    TEST_ASSERT_EQUAL(State::Danger, e.from);
    TEST_ASSERT_EQUAL(kReasonTemperature | kReasonAirQuality, e.reasons);
    char text[32];
    formatReason(e, kReasonAirQuality, text, sizeof(text));
    TEST_ASSERT_EQUAL_STRING("airQuality<850", text);

    cycle(26, 50, 300);  // the hold timer restarted in WARNING
    assertState(State::Warning);
    holdAndCycle(26, 50, 300);
    assertState(State::Uncomfortable);
    holdAndCycle(26, 50, 300);
    assertState(State::Normal);
}

static void test_step_down_needs_exit_of_current_level() {
    settle(25, 50, 720);
    assertState(State::Warning);
    settle(25, 50, 660);  // below WARNING enter (700) but not below exit (650)
    holdAndCycle(25, 50, 660);
    assertState(State::Warning);
    settle(25, 50, 640);
    holdAndCycle(25, 50, 640);
    assertState(State::Uncomfortable);
}

static void test_hysteresis_no_flapping_around_900() {
    settle(25, 50, 900);
    assertState(State::Danger);
    drainEvents();
    const float wobble[] = {880, 920, 885, 905, 880, 915, 895, 882};
    for (int round = 0; round < 5; round++) {
        for (float aq : wobble) {
            now += MIN_STATE_HOLD_MS;
            cycle(25, 50, aq);
            assertState(State::Danger);
        }
    }
    TEST_ASSERT_EQUAL(0, countEvents(EventType::StateChanged));
}

// ---- Null inputs + DHT fault (§7.2) --------------------------------------------

static void test_before_first_dht_reading_rules_use_air_quality_only() {
    settle(NAN, NAN, 300);
    TEST_ASSERT_TRUE(isnan(engine.temperature()));
    TEST_ASSERT_FALSE(engine.dhtFault());
    assertState(State::Normal);
    settle(NAN, NAN, 720);
    assertState(State::Warning);
}

static void test_null_temperature_counts_as_exit() {
    settle(35, 50, 300);  // DANGER on temperature only
    assertState(State::Danger);
    // DHT stops answering: fault after > 10 s, temperature becomes null, exit allowed.
    for (int i = 0; i < 12; i++) cycle(NAN, NAN, 300);
    TEST_ASSERT_TRUE(engine.dhtFault());
    TEST_ASSERT_TRUE(isnan(engine.temperature()));
    TEST_ASSERT_TRUE(isnan(engine.humidity()));
    assertState(State::Warning);  // stepped down once the fault made the exit true
    holdAndCycle(NAN, NAN, 300);
    holdAndCycle(NAN, NAN, 300);
    assertState(State::Normal);
}

static void test_dht_fault_after_10s_and_recovery() {
    settle(25, 50, 300);
    drainEvents();
    const uint32_t lastValid = now;
    while (now - lastValid <= DHT_FAULT_AFTER_MS) {
        TEST_ASSERT_FALSE(engine.dhtFault());
        TEST_ASSERT_EQUAL_FLOAT(25, engine.temperature());  // kept while < 10 s
        cycle(NAN, NAN, 300);
    }
    TEST_ASSERT_TRUE(engine.dhtFault());
    TEST_ASSERT_EQUAL(1, countEvents(EventType::SensorFault));

    for (int i = 0; i < 5; i++) cycle(NAN, NAN, 300);
    TEST_ASSERT_EQUAL(0, countEvents(EventType::SensorFault));  // once per fault

    cycle(30, 60, 300);
    TEST_ASSERT_FALSE(engine.dhtFault());
    TEST_ASSERT_EQUAL_FLOAT(30, engine.temperature());  // fresh average, no pre-fault values
    TEST_ASSERT_EQUAL(1, countEvents(EventType::SensorRecovered));
}

static void test_fault_timer_starts_at_boot() {
    for (int i = 0; i < 10; i++) cycle(NAN, NAN, 300);  // exactly 10 s
    TEST_ASSERT_FALSE(engine.dhtFault());
    cycle(NAN, NAN, 300);
    TEST_ASSERT_TRUE(engine.dhtFault());
}

// ---- Actions (§7.6) ---------------------------------------------------------------

static void test_actions_per_state() {
    settle(25, 50, 300);
    Outputs o = engine.tick(now);
    TEST_ASSERT_TRUE(o.green);
    TEST_ASSERT_FALSE(o.yellow || o.red || o.buzzerPin);
    TEST_ASSERT_EQUAL(0, o.windowAngle);

    settle(29.5, 50, 300);
    o = engine.tick(now);
    TEST_ASSERT_TRUE(o.yellow);
    TEST_ASSERT_FALSE(o.green || o.red);

    settle(35, 50, 300);
    o = engine.tick(now);
    TEST_ASSERT_TRUE(o.red);
    TEST_ASSERT_FALSE(o.green || o.yellow);
    TEST_ASSERT_TRUE(engine.buzzerOn());
    TEST_ASSERT_EQUAL(WINDOW_ANGLE_MAX, o.windowAngle);
}

static void test_hold_states_keep_window_and_normal_closes() {
    settle(35, 50, 300);
    TEST_ASSERT_EQUAL(90, engine.windowAngle());
    settle(26, 50, 300);
    int steps = 0;
    while (engine.state() != State::Normal && steps < 5) {
        TEST_ASSERT_EQUAL(90, engine.windowAngle());  // WARNING and UNCOMFORTABLE hold
        holdAndCycle(26, 50, 300);
        steps++;
    }
    assertState(State::Normal);
    TEST_ASSERT_EQUAL(0, engine.windowAngle());
}

static void test_warning_blinks_2hz() {
    settle(31.5, 50, 300);
    assertState(State::Warning);
    const uint32_t start = now - (SMOOTH_WINDOW - 1) * SAMPLE_INTERVAL_MS;  // settle entered WARNING on cycle 1
    for (uint32_t t = start; t < start + 2000; t += 50) {
        const bool expected = ((t - start) / 250) % 2 == 0;
        if (engine.tick(t).yellow != expected) TEST_FAIL_MESSAGE("blink out of phase");
    }
}

static void test_danger_buzzer_pattern_500ms() {
    settle(25, 50, 300);
    now += 10;
    engine.pushAnalog(400, 1000, false);
    engine.pushAnalog(400, 1000, false);
    engine.pushAnalog(400, 1000, false);
    engine.evaluate(now);
    const uint32_t start = now;
    for (uint32_t t = start; t < start + 3000; t += 50) {
        const bool expected = ((t - start) / 500) % 2 == 0;
        if (engine.tick(t).buzzerPin != expected) TEST_FAIL_MESSAGE("buzzer pattern out of phase");
    }
    TEST_ASSERT_TRUE(engine.buzzerOn());  // logical state stays true through the pattern
}

// ---- Manual override (§7.6, D2) ---------------------------------------------------

static void test_window_override_in_danger_then_expires() {
    settle(35, 50, 950);
    drainEvents();
    engine.overrideWindow(0, OverrideSource::Dashboard, now);
    const uint32_t setAt = now;

    const Event set = expectEvent(EventType::OverrideSet);
    TEST_ASSERT_EQUAL(Actuator::Window, set.actuator);
    TEST_ASSERT_EQUAL(0, set.value);
    TEST_ASSERT_EQUAL(MANUAL_OVERRIDE_SEC, set.durationSec);
    TEST_ASSERT_EQUAL_STRING("dashboard", sourceName(set.source));

    Outputs o = engine.tick(now);
    TEST_ASSERT_EQUAL(0, o.windowAngle);
    TEST_ASSERT_TRUE(o.red);               // LEDs are never overridden
    TEST_ASSERT_TRUE(engine.buzzerOn());   // only the window is overridden
    TEST_ASSERT_EQUAL(MANUAL_OVERRIDE_SEC, engine.overrideExpiresInSec(now));

    for (int i = 0; i < 30; i++) cycle(35, 50, 950);  // rules keep running, window stays
    TEST_ASSERT_EQUAL(0, engine.windowAngle());
    TEST_ASSERT_EQUAL(MANUAL_OVERRIDE_SEC - 30, engine.overrideExpiresInSec(now));

    engine.tick(setAt + MANUAL_OVERRIDE_SEC * 1000 - 1);
    TEST_ASSERT_TRUE(engine.windowOverridden());
    o = engine.tick(setAt + MANUAL_OVERRIDE_SEC * 1000);
    TEST_ASSERT_FALSE(engine.windowOverridden());
    TEST_ASSERT_EQUAL(90, o.windowAngle);  // back to what DANGER requires
    const Event cleared = expectEvent(EventType::OverrideCleared);
    TEST_ASSERT_EQUAL_STRING("expired", clearReasonName(cleared.clearReason));
    TEST_ASSERT_EQUAL(0, engine.overrideExpiresInSec(now));
}

static void test_override_cleared_on_escalation() {
    settle(31.5, 50, 300);
    assertState(State::Warning);
    engine.overrideWindow(0, OverrideSource::Api, now);
    engine.overrideBuzzer(true, OverrideSource::Api, now);
    drainEvents();

    settle(31.5, 50, 300);  // same level: stays
    TEST_ASSERT_TRUE(engine.windowOverridden());

    settle(35, 50, 300);
    assertState(State::Danger);
    TEST_ASSERT_FALSE(engine.windowOverridden());
    TEST_ASSERT_FALSE(engine.buzzerOverridden());
    TEST_ASSERT_EQUAL(90, engine.windowAngle());
    TEST_ASSERT_TRUE(engine.buzzerOn());
    TEST_ASSERT_EQUAL(2, countEvents(EventType::OverrideCleared));
}

static void test_mute_in_warning_is_cancelled_by_danger() {
    settle(31.5, 50, 300);
    engine.overrideBuzzer(false, OverrideSource::Dashboard, now);
    settle(35, 50, 300);
    TEST_ASSERT_TRUE(engine.buzzerOn());
}

static void test_escalation_into_hold_state_keeps_opened_window() {
    settle(25, 50, 300);
    engine.overrideWindow(90, OverrideSource::Dashboard, now);
    settle(29.5, 50, 300);  // NORMAL → UNCOMFORTABLE cancels the override
    assertState(State::Uncomfortable);
    TEST_ASSERT_FALSE(engine.windowOverridden());
    TEST_ASSERT_EQUAL(90, engine.windowAngle());
    TEST_ASSERT_EQUAL(90, engine.edgeWindowAngle());

    settle(25, 50, 300);
    holdAndCycle(25, 50, 300);
    assertState(State::Normal);
    TEST_ASSERT_EQUAL(0, engine.windowAngle());
}

static void test_clear_in_hold_state_returns_to_edge_angle() {
    settle(31.5, 50, 300);  // WARNING from NORMAL: edge angle stays 0
    engine.overrideWindow(60, OverrideSource::Dashboard, now);
    TEST_ASSERT_EQUAL(60, engine.windowAngle());
    engine.clearOverrides(ClearReason::Command);
    TEST_ASSERT_EQUAL(0, engine.windowAngle());  // last edge angle, not the override's
    const Event e = expectEvent(EventType::OverrideCleared);
    TEST_ASSERT_EQUAL_STRING("command", clearReasonName(e.clearReason));
}

static void test_edge_angle_tracked_during_override() {
    settle(25, 50, 300);
    engine.overrideWindow(45, OverrideSource::Dashboard, now);
    settle(35, 50, 300);  // escalation cancels it anyway
    settle(35, 50, 300);
    engine.overrideWindow(10, OverrideSource::Dashboard, now);  // set in DANGER
    settle(26, 50, 300);  // DANGER → WARNING while overridden
    assertState(State::Warning);
    TEST_ASSERT_EQUAL(10, engine.windowAngle());
    TEST_ASSERT_EQUAL(90, engine.edgeWindowAngle());  // DANGER set it, WARNING holds it
    engine.clearOverrides(ClearReason::Command);
    TEST_ASSERT_EQUAL(90, engine.windowAngle());
}

static void test_override_angle_is_clamped() {
    engine.overrideWindow(200, OverrideSource::Api, now);
    TEST_ASSERT_EQUAL(WINDOW_ANGLE_MAX, engine.windowAngle());
    engine.overrideWindow(-5, OverrideSource::Api, now);
    TEST_ASSERT_EQUAL(0, engine.windowAngle());
}

static void test_clear_without_override_sends_no_event() {
    settle(25, 50, 300);
    drainEvents();
    engine.clearOverrides(ClearReason::Command);
    TEST_ASSERT_EQUAL(0, countEvents(EventType::OverrideCleared));
}

// ---- Button (§7.6) -------------------------------------------------------------------

static void test_short_press_mutes_long_press_clears() {
    settle(35, 50, 950);
    engine.overrideWindow(0, OverrideSource::Dashboard, now);
    drainEvents();

    engine.onButton(Press::Short, now);
    TEST_ASSERT_FALSE(engine.buzzerOn());
    TEST_ASSERT_FALSE(engine.tick(now).buzzerPin);
    Event e = expectEvent(EventType::ButtonPressed);
    TEST_ASSERT_EQUAL_STRING("short", pressName(e.press));
    e = expectEvent(EventType::OverrideSet);
    TEST_ASSERT_EQUAL(Actuator::Buzzer, e.actuator);
    TEST_ASSERT_EQUAL(0, e.value);
    TEST_ASSERT_EQUAL_STRING("button", sourceName(e.source));

    engine.onButton(Press::Long, now);
    TEST_ASSERT_TRUE(engine.buzzerOn());
    TEST_ASSERT_EQUAL(90, engine.windowAngle());
    expectEvent(EventType::ButtonPressed);
    e = expectEvent(EventType::OverrideCleared);
    TEST_ASSERT_EQUAL_STRING("button", clearReasonName(e.clearReason));
    e = expectEvent(EventType::OverrideCleared);
    TEST_ASSERT_EQUAL_STRING("button", clearReasonName(e.clearReason));
}

// ---- Events + LCD -------------------------------------------------------------------

static void test_event_queue_drops_oldest() {
    for (int i = 0; i < 10; i++) engine.overrideWindow(i, OverrideSource::Api, now);
    Event e;
    TEST_ASSERT_TRUE(engine.popEvent(e));
    TEST_ASSERT_EQUAL(2, e.value);  // 0 and 1 were dropped
    int n = 1;
    while (engine.popEvent(e)) n++;
    TEST_ASSERT_EQUAL(8, n);
}

static void test_lcd_rows() {
    char row[24];
    settle(NAN, NAN, 680);
    formatLcdRow0(engine, row, sizeof(row));
    TEST_ASSERT_EQUAL_STRING("T--.- H-- A680", row);

    settle(31.2, 75.4, 680);
    formatLcdRow0(engine, row, sizeof(row));
    TEST_ASSERT_EQUAL_STRING("T31.2 H75 A680", row);
    formatLcdRow1(engine, false, row, sizeof(row));
    TEST_ASSERT_EQUAL_STRING("WARNING  OFF", row);
    engine.overrideWindow(0, OverrideSource::Api, now);
    formatLcdRow1(engine, true, row, sizeof(row));
    TEST_ASSERT_EQUAL_STRING("WARNING  NET OV", row);

    for (int i = 0; i < 12; i++) cycle(NAN, NAN, 680);
    formatLcdRow0(engine, row, sizeof(row));
    TEST_ASSERT_EQUAL_STRING("DHT ERR A680", row);
}

static void test_lcd_row0_never_exceeds_16() {
    char row[24];
    settle(-12.4, 100, 1000);
    formatLcdRow0(engine, row, sizeof(row));
    TEST_ASSERT_EQUAL_STRING("T-12 H100 A1000", row);
    TEST_ASSERT_TRUE(strlen(row) <= 16);
}

static void test_lcd_uncomfortable_label() {
    char row[24];
    settle(25, 90, 300);
    formatLcdRow1(engine, true, row, sizeof(row));
    TEST_ASSERT_EQUAL_STRING("UNCOMF   NET", row);
}

// ---- millis() wrap ----------------------------------------------------------------------

static void test_timers_survive_millis_wrap() {
    now = 0xFFFFFFFFu - 5000;
    engine.begin(now);
    settle(35, 50, 300);
    engine.overrideWindow(0, OverrideSource::Api, now);
    const uint32_t setAt = now;
    engine.tick(setAt + 3000);  // past the wrap
    TEST_ASSERT_TRUE(setAt + 3000 < setAt);
    TEST_ASSERT_TRUE(engine.windowOverridden());
    TEST_ASSERT_EQUAL(MANUAL_OVERRIDE_SEC - 3, engine.overrideExpiresInSec(setAt + 3000));
    engine.tick(setAt + MANUAL_OVERRIDE_SEC * 1000);
    TEST_ASSERT_FALSE(engine.windowOverridden());
}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_not_ready_before_analog_sample);
    RUN_TEST(test_moving_average_over_window);
    RUN_TEST(test_invalid_values_keep_previous_smoothed_value);
    RUN_TEST(test_rules_run_on_smoothed_values);
    RUN_TEST(test_escalates_immediately_and_skips_levels);
    RUN_TEST(test_escalation_reasons_list_every_enter_condition);
    RUN_TEST(test_humidity_only_raises_uncomfortable);
    RUN_TEST(test_steps_down_one_level_per_evaluation_after_hold);
    RUN_TEST(test_step_down_needs_exit_of_current_level);
    RUN_TEST(test_hysteresis_no_flapping_around_900);
    RUN_TEST(test_before_first_dht_reading_rules_use_air_quality_only);
    RUN_TEST(test_null_temperature_counts_as_exit);
    RUN_TEST(test_dht_fault_after_10s_and_recovery);
    RUN_TEST(test_fault_timer_starts_at_boot);
    RUN_TEST(test_actions_per_state);
    RUN_TEST(test_hold_states_keep_window_and_normal_closes);
    RUN_TEST(test_warning_blinks_2hz);
    RUN_TEST(test_danger_buzzer_pattern_500ms);
    RUN_TEST(test_window_override_in_danger_then_expires);
    RUN_TEST(test_override_cleared_on_escalation);
    RUN_TEST(test_mute_in_warning_is_cancelled_by_danger);
    RUN_TEST(test_escalation_into_hold_state_keeps_opened_window);
    RUN_TEST(test_clear_in_hold_state_returns_to_edge_angle);
    RUN_TEST(test_edge_angle_tracked_during_override);
    RUN_TEST(test_override_angle_is_clamped);
    RUN_TEST(test_clear_without_override_sends_no_event);
    RUN_TEST(test_short_press_mutes_long_press_clears);
    RUN_TEST(test_event_queue_drops_oldest);
    RUN_TEST(test_lcd_rows);
    RUN_TEST(test_lcd_row0_never_exceeds_16);
    RUN_TEST(test_lcd_uncomfortable_label);
    RUN_TEST(test_timers_survive_millis_wrap);
    return UNITY_END();
}
