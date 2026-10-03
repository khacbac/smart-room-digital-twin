#include "edge_ai.h"

#include <math.h>
#include <string.h>

#include "model_data.h"

namespace edge_ai {

namespace {

using namespace model;

// y = relu?(W x + b), W int8 [out][in] scaled by `scale`. Float accumulation.
void dense(const float* x, int in, const int8_t* w, const float* b, float scale, int out, bool relu, float* y) {
    for (int o = 0; o < out; o++) {
        int32_t acc = 0;  // int8 * float input would be fine too, but keep the weight sum exact
        float facc = 0.0f;
        const int8_t* row = w + o * in;
        for (int i = 0; i < in; i++) facc += (float)row[i] * x[i];
        (void)acc;
        float v = facc * scale + b[o];
        y[o] = (relu && v < 0.0f) ? 0.0f : v;
    }
}

int argmax(const float* v, int n, float* margin) {
    int best = 0;
    for (int i = 1; i < n; i++)
        if (v[i] > v[best]) best = i;
    if (margin) {
        float second = -INFINITY;
        for (int i = 0; i < n; i++)
            if (i != best && v[i] > second) second = v[i];
        *margin = v[best] - second;
    }
    return best;
}

bool sameDecision(const Inference& a, const Inference& b) {
    return a.valid == b.valid && a.state == b.state && a.windowAngle == b.windowAngle && a.buzzer == b.buzzer;
}

}  // namespace

bool forward(const Features& f, float* logits) {
    if (isnan(f.temperature) || isnan(f.humidity) || isnan(f.airQuality) || isnan(f.light)) return false;
    float x[kInputs];
    x[0] = (f.temperature - kTempOffset) / kTempScale;
    x[1] = (f.humidity - kHumOffset) / kHumScale;
    x[2] = (f.airQuality - kAqOffset) / kAqScale;
    const float lux = f.light < 0.0f ? 0.0f : f.light;
    x[3] = (log10f(1.0f + lux) - kLightOffset) / kLightScale;
    x[4] = f.presence ? 1.0f : 0.0f;

    float h1[kHidden1], h2[kHidden2];
    dense(x, kInputs, kW1, kB1, kScale1, kHidden1, true, h1);
    dense(h1, kHidden1, kW2, kB2, kScale2, kHidden2, true, h2);
    dense(h2, kHidden2, kW3, kB3, kScale3, kOutputs, false, logits);
    return true;
}

Inference classify(const Features& f) {
    Inference r{false, edge::State::Normal, 0, false, 0.0f};
    float logits[kOutputs];
    if (!forward(f, logits)) return r;
    r.valid = true;
    r.state = (edge::State)argmax(logits, 4, &r.stateMargin);
    r.windowAngle = kAngles[argmax(logits + 4, kAngleCount, nullptr)];
    r.buzzer = logits[kOutputs - 1] > 0.0f;
    return r;
}

void Controller::reset() {
    current_ = Inference{false, edge::State::Normal, 0, false, 0};
    pending_ = current_;
    pendingCount_ = 0;
}

Inference Controller::step(const Features& f) {
    const Inference now = classify(f);
    if (sameDecision(now, current_)) {
        pendingCount_ = 0;
        current_.stateMargin = now.stateMargin;
        return current_;
    }
    // Escalations (more severe state, buzzer turning on, window opening wider) apply at once;
    // relaxations wait for kConfirmSamples identical samples.
    const bool escalation = now.valid && (!current_.valid || now.state > current_.state ||
                                          (now.buzzer && !current_.buzzer) ||
                                          now.windowAngle > current_.windowAngle);
    if (escalation) {
        current_ = now;
        pendingCount_ = 0;
        return current_;
    }
    if (sameDecision(now, pending_)) {
        if (++pendingCount_ >= kConfirmSamples) {
            current_ = now;
            pendingCount_ = 0;
        }
    } else {
        pending_ = now;
        pendingCount_ = 1;
    }
    return current_;
}

const char* version() {
    return kVersion;
}

}  // namespace edge_ai
