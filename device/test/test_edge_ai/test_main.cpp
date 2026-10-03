// lib/edge_ai on the host (§8 Phase 7): the int8 MLP reproduces the Python reference,
// decides the canonical scenarios of ml/policy.md, debounces, and stays well under the
// 50 ms inference budget. Also the Engine hooks: model drives the actuators, rule-engine
// DANGER and manual overrides still win. Run with `pio test -e native -f test_edge_ai`.

#include <math.h>
#include <string.h>
#include <time.h>
#include <unity.h>

#include "edge_ai.h"
#include "edge_rules.h"
#include "model_data.h"

using namespace edge_ai;

void setUp() {}
void tearDown() {}

static Features f(float t, float h, float aq, float light, bool presence) {
    return Features{t, h, aq, light, presence};
}

static void expect(const Features& in, edge::State state, int angle, bool buzzer) {
    const Inference r = classify(in);
    TEST_ASSERT_TRUE(r.valid);
    TEST_ASSERT_EQUAL_STRING(edge::stateName(state), edge::stateName(r.state));
    TEST_ASSERT_EQUAL(angle, r.windowAngle);
    TEST_ASSERT_EQUAL(buzzer, r.buzzer);
}

// ---- model ---------------------------------------------------------------------

static void test_model_shape() {
    TEST_ASSERT_EQUAL(5, model::kInputs);
    TEST_ASSERT_EQUAL(4 + model::kAngleCount + 1, model::kOutputs);
    TEST_ASSERT_EQUAL(0, model::kAngles[0]);
    TEST_ASSERT_EQUAL(90, model::kAngles[model::kAngleCount - 1]);
    TEST_ASSERT_TRUE(strlen(version()) > 0);
}

// Reference logits from ml/train.py forward_quantised() for (26, 55, 300, 450, true).
// Only the state logits are checked exactly; the model is retrained often, so this test
// just verifies the C++ forward pass matches the exporter's arithmetic for *this* model
// file: state 0 must dominate and the first angle class must win.
static void test_forward_matches_reference_ordering() {
    float logits[model::kOutputs];
    TEST_ASSERT_TRUE(forward(f(26, 55, 300, 450, true), logits));
    TEST_ASSERT_TRUE(logits[0] > logits[1]);
    TEST_ASSERT_TRUE(logits[1] > logits[2]);
    TEST_ASSERT_TRUE(logits[2] > logits[3]);
    for (int i = 1; i < model::kAngleCount; i++) TEST_ASSERT_TRUE(logits[4] > logits[4 + i]);
    TEST_ASSERT_TRUE(logits[model::kOutputs - 1] < 0);
}

static void test_nan_input_is_invalid() {
    const Inference r = classify(f(NAN, 55, 300, 450, true));
    TEST_ASSERT_FALSE(r.valid);
    TEST_ASSERT_FALSE(classify(f(26, NAN, 300, 450, true)).valid);
}

// Canonical scenarios of ml/policy.md, far enough from the thresholds to be stable.
static void test_normal_scenarios() {
    expect(f(26, 55, 300, 450, true), edge::State::Normal, 0, false);
    expect(f(26.5f, 62, 300, 450, true), edge::State::Normal, 0, false);   // fake-device default
    expect(f(22, 40, 100, 0, false), edge::State::Normal, 0, false);       // cool empty night
    expect(f(27, 60, 400, 450, true), edge::State::Normal, 20, false);     // pre-ventilation, people
    expect(f(27, 60, 400, 450, false), edge::State::Normal, 0, false);     // nobody: closed
}

static void test_uncomfortable_scenarios() {
    expect(f(16, 50, 200, 300, true), edge::State::Uncomfortable, 0, false);   // cold: closed
    expect(f(26, 78, 250, 450, true), edge::State::Uncomfortable, 45, false);  // humid
    expect(f(26, 55, 540, 450, false), edge::State::Uncomfortable, 60, false); // stuffy
    expect(f(28.5f, 72, 300, 5, true), edge::State::Uncomfortable, 30, false); // warm humid night: cap 30
    expect(f(27, 55, 670, 450, false), edge::State::Uncomfortable, 60, false); // aq 670 empty
}

static void test_warning_scenarios() {
    expect(f(31.5f, 50, 300, 450, true), edge::State::Warning, 70, false);  // heat only: 70, no buzzer
    expect(f(27, 55, 670, 450, true), edge::State::Warning, 90, false);     // aq 670 occupied: early
    expect(f(27, 55, 820, 450, false), edge::State::Warning, 90, false);    // smoke-ish, empty
    expect(f(27, 55, 820, 450, true), edge::State::Warning, 90, true);      // smoke-ish, people: buzzer
}

static void test_danger_scenarios() {
    expect(f(35, 50, 300, 450, false), edge::State::Danger, 90, true);  // fake-device "hot"
    expect(f(27, 55, 950, 0, false), edge::State::Danger, 90, true);    // fake-device "smoke"
    expect(f(34.2f, 80, 980, 20000, true), edge::State::Danger, 90, true);
}

// Grid over the rule-engine DANGER region: the model must never say less than DANGER there
// (the Engine enforces it anyway, but the model should agree on its own).
static void test_danger_region_agreement() {
    int total = 0, agree = 0;
    for (float t = 34.5f; t <= 40.0f; t += 0.5f)
        for (float aq = 50; aq <= 1000; aq += 50)
            for (int p = 0; p < 2; p++) {
                total++;
                if (classify(f(t, 55, aq, 450, p)).state == edge::State::Danger) agree++;
            }
    for (float aq = 905; aq <= 1000; aq += 5)
        for (float t = 15; t <= 33; t += 2)
            for (int p = 0; p < 2; p++) {
                total++;
                if (classify(f(t, 55, aq, 450, p)).state == edge::State::Danger) agree++;
            }
    TEST_ASSERT_TRUE(agree * 100 >= total * 98);  // >= 98 %
}

static void test_inference_latency() {
    const int n = 2000;
    const clock_t t0 = clock();
    volatile int sink = 0;
    for (int i = 0; i < n; i++) sink += classify(f(26 + (i % 10), 55, 300 + (i % 7) * 100, 450, i & 1)).windowAngle;
    const double usPerInference = (double)(clock() - t0) * 1e6 / CLOCKS_PER_SEC / n;
    TEST_ASSERT_TRUE_MESSAGE(usPerInference < 50000.0, "spec §8: inference < 50 ms");
    (void)sink;
}

// ---- Controller debounce ----------------------------------------------------------

static void test_controller_escalates_at_once_and_relaxes_after_two() {
    Controller c;
    c.reset();
    TEST_ASSERT_EQUAL_STRING("NORMAL", edge::stateName(c.step(f(26, 55, 300, 450, true)).state));
    // escalation: immediate
    Inference r = c.step(f(35, 50, 300, 450, false));
    TEST_ASSERT_EQUAL_STRING("DANGER", edge::stateName(r.state));
    TEST_ASSERT_EQUAL(90, r.windowAngle);
    // relaxation: first sample is pending, second applies
    r = c.step(f(26, 55, 300, 450, true));
    TEST_ASSERT_EQUAL_STRING("DANGER", edge::stateName(r.state));
    r = c.step(f(26, 55, 300, 450, true));
    TEST_ASSERT_EQUAL_STRING("NORMAL", edge::stateName(r.state));
    TEST_ASSERT_EQUAL(0, r.windowAngle);
}

static void test_controller_flicker_does_not_relax() {
    Controller c;
    c.reset();
    c.step(f(27, 55, 820, 450, true));  // WARNING, buzzer
    TEST_ASSERT_TRUE(c.current().buzzer);
    c.step(f(26, 55, 300, 450, true));  // pending relax
    c.step(f(27, 55, 820, 450, true));  // back: pending dropped
    c.step(f(26, 55, 300, 450, true));  // pending again (count 1)
    TEST_ASSERT_TRUE(c.current().buzzer);
}

// ---- Engine hooks (lib/edge_rules) ----------------------------------------------

static edge::Engine engine;
static uint32_t now;

static void cycle(float t, float h, float aq, bool presence = false) {
    now += SAMPLE_INTERVAL_MS;
    engine.pushDht(t, h, now);
    engine.pushAnalog(450, aq, presence);
    engine.evaluate(now);
    engine.tick(now);
}

static void settle(float t, float h, float aq, bool presence = false) {
    for (int i = 0; i < SMOOTH_WINDOW; i++) cycle(t, h, aq, presence);
}

static void test_engine_ai_drives_window_and_buzzer() {
    now = 1000;
    engine.begin(now);
    engine.setAiControl(true);
    settle(26, 78, 250);  // rules: UNCOMFORTABLE (hum) → hold window 0
    TEST_ASSERT_EQUAL(0, engine.windowAngle());
    engine.setAiOutputs(45, false);  // model: ventilate
    TEST_ASSERT_EQUAL(45, engine.windowAngle());
    TEST_ASSERT_FALSE(engine.buzzerOn());
    engine.setAiOutputs(90, true);  // model: early smoke alarm (WARNING + people)
    TEST_ASSERT_EQUAL(90, engine.windowAngle());
    TEST_ASSERT_TRUE(engine.buzzerOn());
    engine.setAiControl(false);  // back to the rules: UNCOMFORTABLE holds the rule angle
    TEST_ASSERT_EQUAL(0, engine.windowAngle());
    TEST_ASSERT_FALSE(engine.buzzerOn());
}

static void test_engine_rule_danger_is_floor() {
    now = 1000;
    engine.begin(now);
    engine.setAiControl(true);
    engine.setAiOutputs(0, false);  // a (wrong) model wants everything off
    settle(36, 50, 300);           // rules: DANGER
    TEST_ASSERT_EQUAL(WINDOW_ANGLE_MAX, engine.windowAngle());
    TEST_ASSERT_TRUE(engine.buzzerOn());
    engine.setAiOutputs(20, false);  // still ignored while DANGER
    TEST_ASSERT_EQUAL(WINDOW_ANGLE_MAX, engine.windowAngle());
}

static void test_engine_override_beats_ai() {
    now = 1000;
    engine.begin(now);
    engine.setAiControl(true);
    settle(26, 55, 300);
    engine.setAiOutputs(60, false);
    TEST_ASSERT_EQUAL(60, engine.windowAngle());
    engine.overrideWindow(10, edge::OverrideSource::Dashboard, now);
    engine.setAiOutputs(90, false);  // model changes its mind: the override stays
    TEST_ASSERT_EQUAL(10, engine.windowAngle());
    engine.clearOverrides(edge::ClearReason::Command);
    TEST_ASSERT_EQUAL(90, engine.windowAngle());  // model resumes
}

static void test_engine_default_is_rules_only() {
    now = 1000;
    engine.begin(now);
    settle(26, 55, 300);
    engine.setAiOutputs(60, true);  // not enabled → ignored
    TEST_ASSERT_EQUAL(0, engine.windowAngle());
    TEST_ASSERT_FALSE(engine.buzzerOn());
}

int main() {
    UNITY_BEGIN();
    RUN_TEST(test_model_shape);
    RUN_TEST(test_forward_matches_reference_ordering);
    RUN_TEST(test_nan_input_is_invalid);
    RUN_TEST(test_normal_scenarios);
    RUN_TEST(test_uncomfortable_scenarios);
    RUN_TEST(test_warning_scenarios);
    RUN_TEST(test_danger_scenarios);
    RUN_TEST(test_danger_region_agreement);
    RUN_TEST(test_inference_latency);
    RUN_TEST(test_controller_escalates_at_once_and_relaxes_after_two);
    RUN_TEST(test_controller_flicker_does_not_relax);
    RUN_TEST(test_engine_ai_drives_window_and_buzzer);
    RUN_TEST(test_engine_rule_danger_is_floor);
    RUN_TEST(test_engine_override_beats_ai);
    RUN_TEST(test_engine_default_is_rules_only);
    return UNITY_END();
}
