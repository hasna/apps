/**
 * Clock abstraction — every timestamp in the daemon path flows through a
 * Clock so tests can drive time deterministically. Production uses
 * SystemClock; tests use FakeClock.
 */

export interface Clock {
  /** Current time in epoch milliseconds. */
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class FakeClock implements Clock {
  private t: number;

  constructor(startMs = 0) {
    this.t = startMs;
  }

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    this.t += ms;
  }

  set(ms: number): void {
    this.t = ms;
  }
}
