/** Requests per peer in the server's fixed one-minute window. */
export const DEFAULT_RATE_LIMIT_MAX = 12_000;
export const MAX_RATE_LIMIT_MAX = 1_000_000;

/** Reject malformed configuration instead of accidentally disabling the limiter. */
export function resolveRateLimitMax(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_RATE_LIMIT_MAX;
  const maximum = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_RATE_LIMIT_MAX) {
    // Never echo configuration values: an accidental secret in this variable
    // must not be copied into startup logs.
    throw new Error(`HASNA_RECORDINGS_RATE_LIMIT_MAX (legacy RECORDINGS_RATE_LIMIT_MAX) must be an integer from 1 to ${MAX_RATE_LIMIT_MAX}.`);
  }
  return maximum;
}
