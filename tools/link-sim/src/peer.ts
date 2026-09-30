// TypeScript twin of device/lib/link/src/link_peer.* (docs/link-protocol.md §5.3).

export const LINK_HEARTBEAT_MS = 5000;
export const LINK_PEER_TIMEOUT_MS = 15_000;

/** Sender side: owns the frame seq and remembers when the last frame went out. */
export class TxTracker {
  private seq = 0;
  private lastTx: number | null = null;

  take(nowMs: number): number {
    this.lastTx = nowMs;
    const s = this.seq;
    this.seq = (this.seq + 1) & 0xff;
    return s;
  }

  heartbeatDue(nowMs: number): boolean {
    return this.lastTx === null || nowMs - this.lastTx >= LINK_HEARTBEAT_MS;
  }
}

export type PeerChange = "up" | "down" | null;

/** Receiver side: presence of the peer, plus seq gaps as a link-quality counter. */
export class PeerMonitor {
  up = false;
  lost = 0;
  duplicates = 0;
  private lastSeq: number | null = null;
  private lastRx = 0;

  onFrame(seq: number, nowMs: number): PeerChange {
    this.lastRx = nowMs;
    if (this.lastSeq !== null) {
      const step = (seq - this.lastSeq) & 0xff;
      if (step === 0) this.duplicates++;
      else this.lost += step - 1;
    }
    this.lastSeq = seq;
    if (this.up) return null;
    this.up = true;
    return "up";
  }

  tick(nowMs: number): PeerChange {
    if (!this.up || nowMs - this.lastRx < LINK_PEER_TIMEOUT_MS) return null;
    this.up = false;
    this.lastSeq = null;
    return "down";
  }

  /** On HELLO: the peer rebooted and its seq restarts. */
  resetSeq() {
    this.lastSeq = null;
  }
}
