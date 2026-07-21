import { ValidationError } from "./errors.js";

export interface RunCompletionInput {
  startedAt: string;
  requestedFinishedAt?: string;
  requestedDurationMs?: number;
  serverNow: Date;
}

export interface NormalizedRunCompletion {
  finishedAt: string;
  durationMs: number | undefined;
  updatedAt: string;
}

function timestampMs(value: unknown, field: string): number {
  if (typeof value !== "string") throw new ValidationError(`${field} must be a valid timestamp`);
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) throw new ValidationError(`${field} must be a valid timestamp`);
  return parsed;
}

/**
 * Treat the control-plane clock as authoritative while retaining a bounded
 * runner timestamp as evidence. In the normal case, where startedAt is not
 * ahead of the server clock, finishedAt is clamped into [startedAt, serverNow].
 * A backwards server-clock jump fails safe at serverNow and yields duration 0.
 */
export function normalizeRunCompletion(input: RunCompletionInput): NormalizedRunCompletion {
  const serverNowMs = input.serverNow.getTime();
  if (!Number.isFinite(serverNowMs)) throw new ValidationError("server completion time must be valid");
  const startedAtMs = timestampMs(input.startedAt, "run startedAt");
  const requestedFinishedAtMs = input.requestedFinishedAt === undefined
    ? serverNowMs
    : timestampMs(input.requestedFinishedAt, "run finishedAt");
  const finishedAtMs = Math.min(serverNowMs, Math.max(startedAtMs, requestedFinishedAtMs));
  if (
    input.requestedDurationMs !== undefined &&
    (typeof input.requestedDurationMs !== "number" || !Number.isFinite(input.requestedDurationMs) || input.requestedDurationMs < 0)
  ) {
    throw new ValidationError("run durationMs must be a non-negative finite number");
  }

  return {
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: input.requestedDurationMs ?? Math.max(0, serverNowMs - startedAtMs),
    updatedAt: new Date(serverNowMs).toISOString(),
  };
}
