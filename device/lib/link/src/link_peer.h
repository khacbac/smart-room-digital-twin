#pragma once

// Liveness on the link (docs/link-protocol.md §5): the node sends a HEARTBEAT when it
// has been quiet for LINK_HEARTBEAT_MS; the gateway marks the node down after
// LINK_PEER_TIMEOUT_MS without a valid frame. Time is passed in as `nowMs`.

#include <stdint.h>

#ifndef LINK_HEARTBEAT_MS
#define LINK_HEARTBEAT_MS 5000
#endif
#ifndef LINK_PEER_TIMEOUT_MS
#define LINK_PEER_TIMEOUT_MS 15000  // 3 missed heartbeats
#endif

namespace lnk {

// Sender side: owns the frame seq and remembers when the last frame went out.
class TxTracker {
public:
    uint8_t take(uint32_t nowMs);  // seq for the frame about to be sent (wraps 255 → 0)
    bool heartbeatDue(uint32_t nowMs) const;

private:
    uint8_t seq_ = 0;
    bool sent_ = false;
    uint32_t lastTx_ = 0;
};

enum class PeerChange : uint8_t { None, Up, Down };

// Receiver side: presence of the peer, plus seq gaps as a link-quality counter.
class PeerMonitor {
public:
    PeerChange onFrame(uint8_t seq, uint32_t nowMs);  // Up on the first frame after being down
    PeerChange tick(uint32_t nowMs);                  // Down once the timeout passes
    void resetSeq() { haveSeq_ = false; }             // on HELLO: the peer rebooted, seq restarts

    bool up() const { return up_; }
    uint32_t lost() const { return lost_; }        // frames missing from seq gaps
    uint32_t duplicates() const { return dups_; }  // same seq twice in a row

private:
    bool up_ = false;
    bool haveSeq_ = false;
    uint8_t lastSeq_ = 0;
    uint32_t lastRx_ = 0;
    uint32_t lost_ = 0;
    uint32_t dups_ = 0;
};

}  // namespace lnk
