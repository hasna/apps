import { adapterError } from "./errors"

/**
 * Minimal database port used by the durable managed-task journal and its
 * independent witness.
 *
 * Sandboxes owns the protocol it needs, while callers remain free to supply a
 * Bun SQL, node-postgres, or other TLS-authenticated implementation. Keeping
 * this narrow avoids restoring the removed legacy sandbox repository.
 */
export interface PostgresSessionV1 {
  query<Row extends Record<string, unknown>>(
    statement: string,
    parameters?: readonly unknown[],
  ): Promise<Row[]>
}

export interface PostgresClientV1 extends PostgresSessionV1 {
  transaction<T>(fn: (session: PostgresSessionV1) => Promise<T>): Promise<T>
  close(): Promise<void>
}

/**
 * A port implementation may be a callable object: a Bun `SQL` instance is a function
 * (`typeof new SQL({ url }) === "function"`), so the documented adaptation
 * `Object.assign(sql, { query, transaction, close })` carries the port methods on a
 * function. Guarding on `typeof value === "object"` alone would fail closed on it.
 */
function carriesPort(value: unknown): value is Record<string, unknown> {
  return value !== null && (typeof value === "object" || typeof value === "function")
}

export function assertPostgresSessionV1(value: unknown, context: string): asserts value is PostgresSessionV1 {
  if (!carriesPort(value) || typeof value.query !== "function") {
    throw adapterError("dependency_unavailable", {
      retryable: true,
      message: `postgres database initialization failed: ${context} did not provide a query-capable session`,
    })
  }
}

export function assertPostgresClientV1(value: unknown, context: string): asserts value is PostgresClientV1 {
  if (!carriesPort(value) || typeof value.query !== "function") {
    throw adapterError("dependency_unavailable", {
      retryable: true,
      message: `postgres database initialization failed: ${context} did not provide a query-capable client`,
    })
  }
  if (typeof value.transaction !== "function") {
    throw adapterError("dependency_unavailable", {
      retryable: true,
      message: `postgres database initialization failed: ${context} did not provide a transaction-capable client`,
    })
  }
}
