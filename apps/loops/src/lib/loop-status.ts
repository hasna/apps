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
