/**
 * Shared Postgres error-shape helpers for the sync store and the storage
 * adapter. Both surfaces classify SQLSTATE 23505 (unique_violation) into typed
 * ResourceConflictError codes; keeping the classification helpers in one
 * module prevents the two implementations from drifting apart.
 */

/** True when the error (or its cause) carries SQLSTATE 23505 (unique_violation). */
export function isPostgresUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    code?: unknown;
    errno?: unknown;
    sqlState?: unknown;
    sqlstate?: unknown;
    cause?: unknown;
  };
  const states = [candidate.code, candidate.errno, candidate.sqlState, candidate.sqlstate];
  if (typeof candidate.cause === "object" && candidate.cause !== null) {
    const cause = candidate.cause as { code?: unknown; errno?: unknown; sqlState?: unknown; sqlstate?: unknown };
    states.push(cause.code, cause.errno, cause.sqlState, cause.sqlstate);
  }
  return states.some((state) => String(state) === "23505");
}

/**
 * The violating constraint/index name, when the driver surfaces it. Some
 * Postgres clients omit constraint metadata entirely; callers fall back to a
 * post-failure re-read in that case.
 */
export function postgresConstraintName(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const candidate = error as { constraint?: unknown; constraint_name?: unknown; cause?: unknown };
  const cause = typeof candidate.cause === "object" && candidate.cause !== null
    ? candidate.cause as { constraint?: unknown; constraint_name?: unknown }
    : undefined;
  const constraint = candidate.constraint ?? candidate.constraint_name ?? cause?.constraint ?? cause?.constraint_name;
  return typeof constraint === "string" ? constraint : "";
}
