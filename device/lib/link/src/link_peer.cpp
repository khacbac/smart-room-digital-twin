#include "link_peer.h"

namespace lnk {

uint8_t TxTracker::take(uint32_t nowMs) {
    sent_ = true;
    lastTx_ = nowMs;
    return seq_++;
}

bool TxTracker::heartbeatDue(uint32_t nowMs) const {
    return !sent_ || (uint32_t)(nowMs - lastTx_) >= LINK_HEARTBEAT_MS;
}

PeerChange PeerMonitor::onFrame(uint8_t seq, uint32_t nowMs) {
    lastRx_ = nowMs;
    if (haveSeq_) {
        const uint8_t step = (uint8_t)(seq - lastSeq_);
        if (step == 0) {
            dups_++;
        } else {
            lost_ += step - 1u;
        }
    }
    haveSeq_ = true;
    lastSeq_ = seq;
    if (up_) return PeerChange::None;
    up_ = true;
    return PeerChange::Up;
}

PeerChange PeerMonitor::tick(uint32_t nowMs) {
    if (!up_ || (uint32_t)(nowMs - lastRx_) < LINK_PEER_TIMEOUT_MS) return PeerChange::None;
    up_ = false;
    haveSeq_ = false;  // the gap across an outage is not link loss
    return PeerChange::Down;
}

}  // namespace lnk
