import { expect, test } from "bun:test";
import {
  MAX_POLL_BACKOFF_MS,
  MAX_RETRY_AFTER_BACKOFF_MS,
  MIN_POLL_BACKOFF_MS,
  pollBackoffMs,
} from "../src/index.js";

/**
 * Test-gap coverage for `pollBackoffMs` (src/lib/serve.ts:77), the daemon's
 * poll-failure backoff. It is load-bearing for the serve loop
 * (src/cli/index.ts:211): a broken backoff either hammers Telegram after a 429
 * (escalating a soft rate limit into a longer one) or parks the poll for far
 * longer than the operator's interval. Every clamp below is part of that
 * contract, and none of it was covered by the pre-existing suite.
 */

test("honours Telegram's 429 retry_after in milliseconds", () => {
  expect(pollBackoffMs({ attempt: 1, intervalMs: 5_000, retryAfterSeconds: 7 })).toBe(7_000);
});

test("retry_after of zero still waits the minimum backoff, never zero", () => {
  // A 429 that says "retry immediately" must not translate into a zero-sleep
  // hot loop: the floor keeps the poller honest.
  expect(pollBackoffMs({ attempt: 1, intervalMs: 5_000, retryAfterSeconds: 0 })).toBe(MIN_POLL_BACKOFF_MS);
});

test("sub-second retry_after is clamped up to the minimum backoff", () => {
  expect(pollBackoffMs({ attempt: 1, intervalMs: 5_000, retryAfterSeconds: 0.5 })).toBe(MIN_POLL_BACKOFF_MS);
});

test("retry_after far above the cap is clamped to the retry-after ceiling", () => {
  expect(pollBackoffMs({ attempt: 1, intervalMs: 5_000, retryAfterSeconds: 1_000 })).toBe(MAX_RETRY_AFTER_BACKOFF_MS);
});

test("retry_after wins over the linear step even when the step would be shorter", () => {
  // attempt 5 at a 10s interval steps to 50s; a 2s retry_after must override
  // that, not be ignored.
  expect(pollBackoffMs({ attempt: 5, intervalMs: 10_000, retryAfterSeconds: 2 })).toBe(2_000);
});

test("a non-finite retry_after falls back to the linear step instead of producing NaN", () => {
  // A malformed upstream payload must degrade to the normal schedule. NaN or
  // Infinity would poison `setTimeout` (NaN -> 0ms hot loop) if it escaped.
  expect(pollBackoffMs({ attempt: 2, intervalMs: 5_000, retryAfterSeconds: Number.NaN })).toBe(10_000);
  expect(pollBackoffMs({ attempt: 2, intervalMs: 5_000, retryAfterSeconds: Number.POSITIVE_INFINITY })).toBe(10_000);
});

test("steps linearly with the configured interval", () => {
  expect(pollBackoffMs({ attempt: 1, intervalMs: 5_000 })).toBe(5_000);
  expect(pollBackoffMs({ attempt: 2, intervalMs: 5_000 })).toBe(10_000);
  expect(pollBackoffMs({ attempt: 3, intervalMs: 5_000 })).toBe(15_000);
});

test("an attempt count at or below zero clamps to the first step", () => {
  expect(pollBackoffMs({ attempt: 0, intervalMs: 5_000 })).toBe(5_000);
  expect(pollBackoffMs({ attempt: -3, intervalMs: 5_000 })).toBe(5_000);
});

test("the attempt multiplier is capped so a long outage cannot grow unboundedly", () => {
  // attempt is clamped at 30: a 10s interval at attempt 40 must step as if it
  // were attempt 30 (the 30s ceiling also applies, but the clamp is what keeps
  // the multiplication itself bounded).
  expect(pollBackoffMs({ attempt: 40, intervalMs: 500 })).toBe(15_000);
});

test("the linear step never exceeds the 30s ceiling", () => {
  expect(pollBackoffMs({ attempt: 2, intervalMs: 20_000 })).toBe(MAX_POLL_BACKOFF_MS);
  expect(pollBackoffMs({ attempt: 30, intervalMs: 10_000 })).toBe(MAX_POLL_BACKOFF_MS);
});

test("an interval below the minimum still floors the backoff", () => {
  expect(pollBackoffMs({ attempt: 1, intervalMs: 200 })).toBe(MIN_POLL_BACKOFF_MS);
});
