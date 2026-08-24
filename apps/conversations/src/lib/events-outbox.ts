/**
 * Source outbox for the Conversations → Events webhook-delivery contract.
 *
 * Every committed message/task mutation writes exactly one
 * `conversations_event_outbox` row in the SAME transaction as the mutation, so
 * a commit can never lack durable event intent (closes the SOL P1 "silent
 * source/event divergence" defect). A separate outbox worker transports
 * pending rows into the Events durable substrate (local: the events spool
 * inbox; hosted: a signed webhook POST to the events durable ingress).
 */

export const EVENT_OUTBOX_TABLE = "conversations_event_outbox";

export type EventOutboxStatus = "pending" | "spooled" | "delivered" | "dead";

export interface EventOutboxRow {
  id: string;
  source: string;
  type: string;
  envelope_json: string;
  created_at: string;
  status: EventOutboxStatus;
  attempts: number;
}

export interface EventOutboxStatement {
  run(...params: any[]): { changes?: number | bigint };
  get(...params: any[]): Record<string, unknown> | null | undefined;
  all(...params: any[]): Record<string, unknown>[];
}

/**
 * Minimal SQLite surface the outbox helpers run against. The conversations
 * local database (`ConversationsDatabase`) satisfies this via its `prepare`
 * method; the hosted PostgreSQL path writes outbox rows inline with `$n`
 * placeholders and does not use these helpers.
 */
export type EventOutboxDatabase = Pick<import("./db.js").ConversationsDatabase, "prepare">;

export const EVENT_OUTBOX_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS conversations_event_outbox (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    envelope_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'spooled', 'delivered', 'dead')),
    attempts INTEGER NOT NULL DEFAULT 0
  )
`;

export function ensureEventsOutboxSchema(db: EventOutboxDatabase): void {
  db.prepare(EVENT_OUTBOX_SCHEMA_SQL).run();
}

/**
 * Inserts one outbox row inside the caller's transaction. `INSERT OR IGNORE`
 * by the stable event id keeps re-import/re-delivery idempotent: the first
 * write wins, so a replayed transition never mints a second row.
 */
export function insertEventOutboxRow(db: EventOutboxDatabase, row: EventOutboxRow): boolean {
  const result = db.prepare(`
    INSERT OR IGNORE INTO conversations_event_outbox
      (id, source, type, envelope_json, created_at, status, attempts)
    VALUES (?, ?, ?, ?, ?, 'pending', 0)
  `).run(row.id, row.source, row.type, row.envelope_json, row.created_at);
  const changes = Number(result?.changes ?? 0);
  return changes > 0;
}

export function listPendingEventOutbox(db: EventOutboxDatabase, limit: number): EventOutboxRow[] {
  const rows = db.prepare(`
    SELECT id, source, type, envelope_json, created_at, status, attempts
    FROM conversations_event_outbox
    WHERE status = 'pending'
    ORDER BY created_at, rowid
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    source: String(row.source),
    type: String(row.type),
    envelope_json: String(row.envelope_json),
    created_at: String(row.created_at),
    status: String(row.status) as EventOutboxStatus,
    attempts: Number(row.attempts),
  }));
}

export function markEventOutboxSpooled(db: EventOutboxDatabase, ids: string[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const result = db.prepare(`
    UPDATE conversations_event_outbox
    SET status = 'spooled'
    WHERE id IN (${placeholders}) AND status = 'pending'
  `).run(...ids);
  return Number(result?.changes ?? 0);
}

/**
 * Dead-letters one outbox row whose envelope cannot be transported (for
 * example a malformed envelope_json that cannot be parsed). Dead-lettered rows
 * are skipped by every later drain instead of sitting 'pending' forever and
 * being re-scanned (and re-failed) on each pass.
 */
export function markEventOutboxDead(db: EventOutboxDatabase, id: string): number {
  const result = db.prepare(`
    UPDATE conversations_event_outbox
    SET status = 'dead'
    WHERE id = ? AND status = 'pending'
  `).run(id);
  return Number(result?.changes ?? 0);
}

export function countEventOutboxByStatus(db: EventOutboxDatabase): Record<EventOutboxStatus, number> {
  const counts: Record<EventOutboxStatus, number> = { pending: 0, spooled: 0, delivered: 0, dead: 0 };
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM conversations_event_outbox
    GROUP BY status
  `).all() as Array<{ status: string; count: number }>;
  for (const row of rows) {
    const status = row.status as EventOutboxStatus;
    if (status in counts) counts[status] = Number(row.count);
  }
  return counts;
}
