import type { LoopStatus } from "../types.js";
import { ValidationError } from "./errors.js";

export const LOOP_STATUSES = ["active", "paused", "stopped", "expired"] as const satisfies readonly LoopStatus[];

export function isLoopStatus(value: unknown): value is LoopStatus {
  return typeof value === "string" && (LOOP_STATUSES as readonly string[]).includes(value);
}

export function assertLoopStatus(value: unknown): asserts value is LoopStatus {
  if (!isLoopStatus(value)) {
    throw new ValidationError("loop status must be one of active, paused, stopped, expired");
  }
}

export function isMaxAttempts(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

// maxAttempts is the retry budget the scheduler compares an attempt number
// against (`attempt < loop.maxAttempts`), so 1 means "no retry" and 0 or a
// negative value would make every run unretryable AND unadmittable. Validate it
// in one place because both the sqlite and postgres backends write the column.
export function assertMaxAttempts(value: unknown): asserts value is number {
  if (!isMaxAttempts(value)) {
    throw new ValidationError("loop maxAttempts must be an integer >= 1");
  }
}

export function isExpiresAfterRuns(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

// --expires-after-runs is the number of consecutive successful runs after which
// the loop expires (status "expired"). 0 or a negative value would make the
// ceiling unusable ("expire after zero runs"), so require a positive integer.
// Shared by the sqlite and postgres backends and the hosted PATCH validation.
export function assertExpiresAfterRuns(value: unknown): asserts value is number {
  if (!isExpiresAfterRuns(value)) {
    throw new ValidationError("loop expiresAfterRuns must be an integer >= 1");
  }
}

export function isLeaseMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

// leaseMs is the run lease in milliseconds before an unresponsive runner is
// considered dead. 0 or a negative value would make every claim immediately
// wedged, so require a positive integer. Shared by the sqlite and postgres
// backends and the hosted PATCH validation (O15-00695: per-loop lease config
// so long-running agentic sweeps can be widened in place).
export function assertLeaseMs(value: unknown): asserts value is number {
  if (!isLeaseMs(value)) {
    throw new ValidationError("loop leaseMs must be an integer >= 1");
  }
}
