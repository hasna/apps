/**
 * Shared domain errors for the storage layer.
 */

/**
 * Thrown for invalid client input (missing/blank required fields). Its message
 * is safe to surface to the caller as a clean 400. This is distinct from an
 * unexpected internal/DB error, whose raw text (e.g. a Postgres constraint name)
 * must NEVER be returned to the client.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
