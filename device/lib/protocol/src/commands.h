#pragma once

// Command handling on the device (spec §5.6, §5.7): parse, validate, dedup, execute.
// Plain C++ + ArduinoJson, tested on native. main.cpp publishes the status and the
// ack (or the COMMAND_REJECTED event) from the returned CommandResult.

#include <stddef.h>
#include <stdint.h>

#include "config.h"
#include "edge_rules.h"

namespace proto {

enum class AckStatus : uint8_t { Executed, Rejected, Failed };
enum class RejectReason : uint8_t { None, InvalidPayload, UnsupportedVersion, UnknownAction, ValueOutOfRange };

const char* ackStatusName(AckStatus s);        // "executed" | "rejected" | "failed"
const char* rejectReasonName(RejectReason r);  // "INVALID_PAYLOAD" …, nullptr for None

// A UUID is 36 chars; anything longer than this is treated as unparsable.
const size_t kCommandIdMax = 64;

struct CommandResult {
    bool ackable;    // false: invalid JSON or no string commandId → COMMAND_REJECTED event, no ack
    bool duplicate;  // QoS 1 redelivery: stored result re-acked, command not executed again
    bool executed;   // ran now (not a duplicate): publish status before the ack (§6.6)
    char commandId[kCommandIdMax + 1];
    AckStatus status;
    RejectReason reason;
};

class CommandHandler {
public:
    // One raw payload from {prefix}/{deviceId}/command.
    CommandResult handle(edge::Engine& engine, const char* payload, size_t len, uint32_t nowMs);

private:
    struct Entry {
        char id[kCommandIdMax + 1];
        AckStatus status;
        RejectReason reason;
    };

    const Entry* find(const char* id) const;
    void remember(const CommandResult& r);

    Entry entries_[COMMAND_DEDUP_SIZE] = {};
    uint8_t count_ = 0;
    uint8_t next_ = 0;
};

}  // namespace proto
