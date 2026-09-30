#include "commands.h"

#include <ArduinoJson.h>
#include <math.h>
#include <string.h>

namespace proto {

namespace {

enum class Action : uint8_t { OpenWindow, CloseWindow, BuzzerOn, BuzzerOff, ClearOverride, Ping };

struct ActionName {
    const char* name;
    Action action;
};

const ActionName kActions[] = {
    {"OPEN_WINDOW", Action::OpenWindow},       {"CLOSE_WINDOW", Action::CloseWindow},
    {"BUZZER_ON", Action::BuzzerOn},           {"BUZZER_OFF", Action::BuzzerOff},
    {"CLEAR_OVERRIDE", Action::ClearOverride}, {"PING", Action::Ping},
};

bool parseSource(const char* s, edge::OverrideSource& out) {
    if (!strcmp(s, "dashboard")) out = edge::OverrideSource::Dashboard;
    else if (!strcmp(s, "ai")) out = edge::OverrideSource::Ai;
    else if (!strcmp(s, "api")) out = edge::OverrideSource::Api;
    else return false;
    return true;
}

}  // namespace

const char* ackStatusName(AckStatus s) {
    switch (s) {
        case AckStatus::Executed: return "executed";
        case AckStatus::Rejected: return "rejected";
        default: return "failed";
    }
}

const char* rejectReasonName(RejectReason r) {
    switch (r) {
        case RejectReason::InvalidPayload: return "INVALID_PAYLOAD";
        case RejectReason::UnsupportedVersion: return "UNSUPPORTED_VERSION";
        case RejectReason::UnknownAction: return "UNKNOWN_ACTION";
        case RejectReason::ValueOutOfRange: return "VALUE_OUT_OF_RANGE";
        default: return nullptr;
    }
}

CommandResult CommandHandler::handle(edge::Engine& engine, const char* payload, size_t len, uint32_t nowMs) {
    CommandResult r{};

    JsonDocument doc;
    if (deserializeJson(doc, payload, len) || !doc.is<JsonObject>()) return r;
    const JsonVariant idVar = doc["commandId"];
    const char* id = idVar.as<const char*>();
    if (!idVar.is<const char*>() || !id[0] || strlen(id) > kCommandIdMax) return r;

    r.ackable = true;
    strcpy(r.commandId, id);

    // §5.7: a redelivery gets the stored result and is not executed again.
    if (const Entry* seen = find(id)) {
        r.duplicate = true;
        r.status = seen->status;
        r.reason = seen->reason;
        return r;
    }

    r.status = AckStatus::Rejected;
    const JsonVariant v = doc["v"];
    const JsonVariant actionVar = doc["action"];
    const JsonVariant sourceVar = doc["source"];
    const JsonVariant valueVar = doc["value"];

    Action action = Action::Ping;
    edge::OverrideSource source = edge::OverrideSource::Api;
    int angle = WINDOW_ANGLE_MAX;  // OPEN_WINDOW default

    if (!v.is<int>()) {
        r.reason = RejectReason::InvalidPayload;
    } else if (v.as<int>() != 1) {
        r.reason = RejectReason::UnsupportedVersion;
    } else if (!actionVar.is<const char*>() || !sourceVar.is<const char*>() ||
               !parseSource(sourceVar.as<const char*>(), source)) {
        r.reason = RejectReason::InvalidPayload;
    } else {
        r.reason = RejectReason::UnknownAction;
        for (const ActionName& a : kActions) {
            if (!strcmp(actionVar.as<const char*>(), a.name)) {
                action = a.action;
                r.reason = RejectReason::None;
                break;
            }
        }
    }

    // OPEN_WINDOW: `value` is an optional int 1–90; the other actions ignore it.
    if (r.reason == RejectReason::None && action == Action::OpenWindow && !valueVar.isNull()) {
        const double d = valueVar.as<double>();
        if (!valueVar.is<double>() || d != floor(d)) {
            r.reason = RejectReason::InvalidPayload;
        } else if (d < 1 || d > WINDOW_ANGLE_MAX) {
            r.reason = RejectReason::ValueOutOfRange;
        } else {
            angle = (int)d;
        }
    }

    if (r.reason == RejectReason::None) {
        switch (action) {
            case Action::OpenWindow: engine.overrideWindow(angle, source, nowMs); break;
            case Action::CloseWindow: engine.overrideWindow(0, source, nowMs); break;
            case Action::BuzzerOn: engine.overrideBuzzer(true, source, nowMs); break;
            case Action::BuzzerOff: engine.overrideBuzzer(false, source, nowMs); break;
            case Action::ClearOverride: engine.clearOverrides(edge::ClearReason::Command); break;
            case Action::Ping: break;
        }
        r.status = AckStatus::Executed;
        r.executed = true;
    }

    remember(r);
    return r;
}

const CommandHandler::Entry* CommandHandler::find(const char* id) const {
    for (uint8_t i = 0; i < count_; i++) {
        if (!strcmp(entries_[i].id, id)) return &entries_[i];
    }
    return nullptr;
}

void CommandHandler::remember(const CommandResult& r) {
    Entry& e = entries_[next_];  // ring: overwrites the oldest once full
    strcpy(e.id, r.commandId);
    e.status = r.status;
    e.reason = r.reason;
    next_ = (next_ + 1) % COMMAND_DEDUP_SIZE;
    if (count_ < COMMAND_DEDUP_SIZE) count_++;
}

}  // namespace proto
