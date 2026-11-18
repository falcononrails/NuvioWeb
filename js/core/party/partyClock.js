// Server clock estimate, mirroring Android core/party/PartyClock.kt: keep the
// sample with the shortest round trip and advance it on a monotonic clock.

function defaultMonotonicMs() {
  const perf = globalThis.performance;
  return perf && typeof perf.now === "function" ? perf.now() : Date.now();
}

export class PartyClock {
  constructor({ monotonicMs = defaultMonotonicMs, wallClockMs = () => Date.now() } = {}) {
    this.monotonicMs = monotonicMs;
    this.wallClockMs = wallClockMs;
    this.reset();
  }

  get isSynced() {
    return this.anchorServerMs != null;
  }

  mark() {
    return this.monotonicMs();
  }

  elapsedSince(mark) {
    return Math.max(0, this.monotonicMs() - mark);
  }

  nowMs() {
    if (this.anchorServerMs == null || this.anchorMark == null) return this.wallClockMs();
    return Math.trunc(this.anchorServerMs + (this.monotonicMs() - this.anchorMark));
  }

  addSample(serverMs, sentAt) {
    const roundTripMs = Math.max(0, Math.trunc(this.monotonicMs() - sentAt));
    if (roundTripMs > this.bestRoundTripMs) return;
    this.bestRoundTripMs = roundTripMs;
    this.anchorServerMs = serverMs + Math.trunc(roundTripMs / 2);
    this.anchorMark = this.monotonicMs();
  }

  reset() {
    this.anchorServerMs = null;
    this.anchorMark = null;
    this.bestRoundTripMs = Number.POSITIVE_INFINITY;
  }
}
