/**
 * Parse canonical positive safe-integer syntax without trimming or prefixes.
 *
 * Omitted/default handling belongs to the caller so an explicit `0` can never
 * be confused with an omitted option whose historical default happens to be 0.
 */
export function parsePositiveSafeInteger(value: string, label = "value"): number {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

export function parseOptionalPositiveSafeInteger(
  value: string | undefined,
  label = "value",
): number | undefined {
  return value === undefined ? undefined : parsePositiveSafeInteger(value, label);
}

export function parsePositiveSafeIntegerOr(
  value: string | undefined,
  fallback: number,
  label = "value",
): number {
  return value === undefined ? fallback : parsePositiveSafeInteger(value, label);
}

/**
 * Preserve zero only for domains where it is a real value (for example a
 * successful process exit code or the pre-migration schema level). Every
 * positive value still goes through the one canonical positive parser, and
 * non-canonical zero spellings such as `00` remain invalid.
 */
export function parseNonNegativeSafeInteger(value: string, label = "value"): number {
  return value === "0" ? 0 : parsePositiveSafeInteger(value, label);
}

export function parseOptionalNonNegativeSafeInteger(
  value: string | undefined,
  label = "value",
): number | undefined {
  return value === undefined ? undefined : parseNonNegativeSafeInteger(value, label);
}
