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
