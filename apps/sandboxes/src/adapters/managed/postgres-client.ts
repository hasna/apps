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
