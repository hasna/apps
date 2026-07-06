// ============================================================================
// MESSAGE SYNC — interim fleet shared-storage phase (uuid-keyed, incremental)
// ----------------------------------------------------------------------------
// Replicates `messages` and `message_read_receipts` between per-machine SQLite
// and a shared hub PostgreSQL. SQLite integer ids are per-machine and collide
// across the fleet, so replication is keyed on `messages.uuid`; `reply_to` and
// receipt `message_id` references are translated through the parent message's
// uuid on each side. Per-machine cursors live in the local (never-synced)
// `_message_sync_state` table.
//
// Semantics (v1 — documented in docs/FLEET-SHARED-STORAGE-INTERIM.md):
//   - Append-only replication. New rows flow everywhere; steady-state edits,
//     deletes, pin/unpin and read-state changes made AFTER a row was synced do
//     NOT re-send (no change log yet). When a row does re-sync (cursor reset),
//     conflicts resolve as: content/edited_at last-writer-wins by edited_at;
//     read_at and pinned_at are set-once (never cleared).
//   - Receipts are insert-only, deduped by (message_id, agent). A receipt whose
//     message has not replicated yet holds the cursor back and retries next run.
//   - Timestamps: SQLite stores naive-UTC text; TIMESTAMPTZ-bound values are
//     sent Z-suffixed and normalized back to naive-UTC text on pull.
//
// CUTOVER: gate off. This module is part of the LEGACY bidirectional sync
// engine (see storage-sync.ts header). Under Storage Amendment A1 the fleet
// cloud cutover is PURE REMOTE; the flip lane must remove this data path along
// with the rest of the sync engine. See docs/CUTOVER-RUNBOOK.md.
// ============================================================================
import type { Database } from "./db.js";

export const MESSAGE_SYNC_TABLES = ["messages", "message_read_receipts"] as const;
export const MESSAGE_SYNC_STATE_TABLE = "_message_sync_state";

const PAGE_SIZE = 1000;

/** Minimal async adapter surface (PgAdapterAsync satisfies this). */
export interface RemoteAdapter {
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  all(sql: string, ...params: unknown[]): Promise<unknown[]>;
  get(sql: string, ...params: unknown[]): Promise<unknown | null>;
}

export interface MessageSyncResult {
  table: string;
  rowsRead: number;
  rowsWritten: number;
  errors: string[];
}

export interface MessageSyncStatus {
  push_last_message_id: number;
  pull_last_remote_message_id: number;
  receipts_push_since: string | null;
  receipts_pull_since: string | null;
  local_messages: number;
  local_receipts: number;
  null_uuid_messages: number;
}

type Row = Record<string, unknown>;

const STATE_KEYS = {
  pushMessages: "messages_push_last_id",
  pullMessages: "messages_pull_last_remote_id",
  pushReceipts: "receipts_push_since",
  pullReceipts: "receipts_pull_since",
} as const;

// Naive ISO timestamp (SQLite strftime('%Y-%m-%dT%H:%M:%f','now') is UTC without zone).
const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/** Values bound to pg TIMESTAMPTZ params must be zone-explicit so the hub session TZ never shifts them. */
export function toRemoteTimestamp(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  if (NAIVE_ISO.test(text)) return `${text.replace(" ", "T")}Z`;
  return text;
}

/** Normalize pulled timestamps to the local SQLite naive-UTC text format. */
export function toLocalTimestamp(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString().replace("Z", "");
  const text = String(value);
  return text.endsWith("Z") ? text.slice(0, -1) : text;
}

function localTableExists(db: Database, table: string): boolean {
  return Boolean(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", table));
}

/**
 * Idempotent local readiness: repair uuids (older migrations added the column
 * without backfilling, leaving NULL uuids forever), enforce uniqueness, and
 * create the per-machine sync-state table.
 */
export function ensureLocalMessageSyncReady(db: Database): void {
  if (localTableExists(db, "messages")) {
    db.exec("UPDATE messages SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL OR uuid = ''");
    db.exec(`
      UPDATE messages SET uuid = lower(hex(randomblob(16)))
      WHERE id IN (SELECT m2.id FROM messages m1 JOIN messages m2 ON m1.uuid = m2.uuid AND m1.id < m2.id)
    `);
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_uuid ON messages(uuid)");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MESSAGE_SYNC_STATE_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

/** Idempotent remote readiness: the uuid unique index must exist for ON CONFLICT (uuid). */
export async function ensureRemoteMessageSyncReady(remote: RemoteAdapter): Promise<void> {
  await remote.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_uuid ON messages(uuid)");
}

export function getMessageSyncState(db: Database, key: string): string | null {
  ensureLocalMessageSyncReady(db);
  const row = db.get<{ value: string }>(`SELECT value FROM ${MESSAGE_SYNC_STATE_TABLE} WHERE key = ?`, key);
  return row?.value ?? null;
}

export function setMessageSyncState(db: Database, key: string, value: string): void {
  db.run(
    `INSERT INTO ${MESSAGE_SYNC_STATE_TABLE} (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

export function messageSyncStatus(db: Database): MessageSyncStatus {
  ensureLocalMessageSyncReady(db);
  const count = (sql: string): number => Number((db.get<{ n: number }>(sql))?.n ?? 0);
  return {
    push_last_message_id: Number(getMessageSyncState(db, STATE_KEYS.pushMessages) ?? 0),
    pull_last_remote_message_id: Number(getMessageSyncState(db, STATE_KEYS.pullMessages) ?? 0),
    receipts_push_since: getMessageSyncState(db, STATE_KEYS.pushReceipts),
    receipts_pull_since: getMessageSyncState(db, STATE_KEYS.pullReceipts),
    local_messages: count("SELECT COUNT(*) AS n FROM messages"),
    local_receipts: count("SELECT COUNT(*) AS n FROM message_read_receipts"),
    null_uuid_messages: count("SELECT COUNT(*) AS n FROM messages WHERE uuid IS NULL OR uuid = ''"),
  };
}

const MESSAGE_COLUMNS = [
  "uuid", "session_id", "from_agent", "to_agent", "channel", "project_id", "content",
  "priority", "working_dir", "repository", "branch", "metadata", "edited_at",
  "pinned_at", "blocking", "attachments",
] as const;

// Conflict clause shared by both directions: edits win by newer edited_at;
// read_at/pinned_at are set-once. The WHERE gate keeps no-op re-syncs at 0 changes.
const MESSAGE_CONFLICT_CLAUSE = `
  ON CONFLICT (uuid) DO UPDATE SET
    content = CASE WHEN excluded.edited_at IS NOT NULL AND (messages.edited_at IS NULL OR excluded.edited_at > messages.edited_at) THEN excluded.content ELSE messages.content END,
    edited_at = CASE WHEN excluded.edited_at IS NOT NULL AND (messages.edited_at IS NULL OR excluded.edited_at > messages.edited_at) THEN excluded.edited_at ELSE messages.edited_at END,
    pinned_at = COALESCE(messages.pinned_at, excluded.pinned_at),
    read_at = COALESCE(messages.read_at, excluded.read_at)
  WHERE (excluded.edited_at IS NOT NULL AND (messages.edited_at IS NULL OR excluded.edited_at > messages.edited_at))
     OR (messages.read_at IS NULL AND excluded.read_at IS NOT NULL)
     OR (messages.pinned_at IS NULL AND excluded.pinned_at IS NOT NULL)
`;

function messageParams(row: Row): unknown[] {
  return MESSAGE_COLUMNS.map((column) => {
    const value = row[column];
    if (column === "blocking") return value === true || value === 1 || value === "1" ? 1 : 0;
    return value ?? null;
  });
}

/** Push local messages (id > cursor) to the hub, translating reply_to via parent uuid. */
export async function pushMessages(db: Database, remote: RemoteAdapter): Promise<MessageSyncResult> {
  const result: MessageSyncResult = { table: "messages", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    ensureLocalMessageSyncReady(db);
    await ensureRemoteMessageSyncReady(remote);
    let cursor = Number(getMessageSyncState(db, STATE_KEYS.pushMessages) ?? 0);
    const insertSql = `
      INSERT INTO messages (${MESSAGE_COLUMNS.join(", ")}, reply_to, created_at, read_at)
      VALUES (${MESSAGE_COLUMNS.map(() => "?").join(", ")}, (SELECT id FROM messages WHERE uuid = ?), ?, ?)
      ${MESSAGE_CONFLICT_CLAUSE}
    `;
    for (;;) {
      const rows = db.all<Row>(
        `SELECT m.*, p.uuid AS reply_to_uuid
         FROM messages m LEFT JOIN messages p ON p.id = m.reply_to
         WHERE m.id > ? AND m.uuid IS NOT NULL AND m.uuid != ''
         ORDER BY m.id LIMIT ${PAGE_SIZE}`,
        cursor,
      );
      if (rows.length === 0) break;
      result.rowsRead += rows.length;
      for (const row of rows) {
        const written = await remote.run(
          insertSql,
          ...messageParams(row),
          row["reply_to_uuid"] ?? null,
          toRemoteTimestamp(row["created_at"]),
          row["read_at"] ?? null,
        );
        result.rowsWritten += written.changes;
        cursor = Number(row["id"]);
      }
      setMessageSyncState(db, STATE_KEYS.pushMessages, String(cursor));
      if (rows.length < PAGE_SIZE) break;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

/** Pull hub messages (remote id > cursor) into local SQLite, remapping reply_to to local ids. */
export async function pullMessages(remote: RemoteAdapter, db: Database): Promise<MessageSyncResult> {
  const result: MessageSyncResult = { table: "messages", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    ensureLocalMessageSyncReady(db);
    await ensureRemoteMessageSyncReady(remote);
    let cursor = Number(getMessageSyncState(db, STATE_KEYS.pullMessages) ?? 0);
    const insertSql = `
      INSERT INTO messages (${MESSAGE_COLUMNS.join(", ")}, created_at, read_at)
      VALUES (${MESSAGE_COLUMNS.map(() => "?").join(", ")}, ?, ?)
      ${MESSAGE_CONFLICT_CLAUSE}
    `;
    for (;;) {
      const rows = (await remote.all(
        `SELECT m.*, p.uuid AS reply_to_uuid
         FROM messages m LEFT JOIN messages p ON p.id = m.reply_to
         WHERE m.id > ? ORDER BY m.id LIMIT ${PAGE_SIZE}`,
        cursor,
      )) as Row[];
      if (rows.length === 0) break;
      result.rowsRead += rows.length;
      const replyPairs: Array<{ uuid: string; parentUuid: string }> = [];
      for (const row of rows) {
        const written = db.run(
          insertSql,
          ...messageParams(row),
          toLocalTimestamp(row["created_at"]),
          row["read_at"] ?? null,
        );
        result.rowsWritten += written.changes;
        if (row["reply_to_uuid"]) {
          replyPairs.push({ uuid: String(row["uuid"]), parentUuid: String(row["reply_to_uuid"]) });
        }
        cursor = Number(row["id"]);
      }
      // Second phase: remap reply_to through the parent uuid once the whole
      // page is present locally (parents can arrive after children).
      for (const pair of replyPairs) {
        db.run(
          "UPDATE messages SET reply_to = (SELECT p.id FROM messages p WHERE p.uuid = ?) WHERE uuid = ? AND reply_to IS NULL",
          pair.parentUuid,
          pair.uuid,
        );
      }
      setMessageSyncState(db, STATE_KEYS.pullMessages, String(cursor));
      if (rows.length < PAGE_SIZE) break;
    }
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

/**
 * Push local read receipts (read_at >= cursor) to the hub, resolving message_id
 * via the message uuid. Receipts whose message is not on the hub yet hold the
 * cursor back so they retry after the message replicates.
 */
export async function pushReceipts(db: Database, remote: RemoteAdapter): Promise<MessageSyncResult> {
  const result: MessageSyncResult = { table: "message_read_receipts", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    ensureLocalMessageSyncReady(db);
    await ensureRemoteMessageSyncReady(remote);
    const cursor = getMessageSyncState(db, STATE_KEYS.pushReceipts) ?? "";
    let maxSeen = cursor;
    let holdback: string | null = null;
    let offset = 0;
    for (;;) {
      const rows = db.all<Row>(
        `SELECT r.agent, r.read_at, m.uuid
         FROM message_read_receipts r JOIN messages m ON m.id = r.message_id
         WHERE r.read_at >= ? ORDER BY r.read_at, r.message_id LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
        cursor,
      );
      if (rows.length === 0) break;
      result.rowsRead += rows.length;
      for (const row of rows) {
        const readAt = String(row["read_at"]);
        const exists = await remote.get("SELECT id FROM messages WHERE uuid = ?", row["uuid"]);
        if (!exists) {
          if (holdback === null || readAt < holdback) holdback = readAt;
          continue;
        }
        const written = await remote.run(
          `INSERT INTO message_read_receipts (message_id, agent, read_at)
           SELECT id, ?, ? FROM messages WHERE uuid = ?
           ON CONFLICT (message_id, agent) DO NOTHING`,
          row["agent"],
          toRemoteTimestamp(readAt),
          row["uuid"],
        );
        result.rowsWritten += written.changes;
        if (readAt > maxSeen) maxSeen = readAt;
      }
      offset += rows.length;
      if (rows.length < PAGE_SIZE) break;
    }
    setMessageSyncState(db, STATE_KEYS.pushReceipts, holdback !== null ? holdback : maxSeen);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

/** Pull hub read receipts (read_at >= cursor) into local SQLite, resolving message_id via uuid. */
export async function pullReceipts(remote: RemoteAdapter, db: Database): Promise<MessageSyncResult> {
  const result: MessageSyncResult = { table: "message_read_receipts", rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    ensureLocalMessageSyncReady(db);
    await ensureRemoteMessageSyncReady(remote);
    const cursor = getMessageSyncState(db, STATE_KEYS.pullReceipts) ?? "1970-01-01T00:00:00.000Z";
    let maxSeen = cursor;
    let holdback: string | null = null;
    let offset = 0;
    for (;;) {
      const rows = (await remote.all(
        `SELECT r.agent, r.read_at, m.uuid
         FROM message_read_receipts r JOIN messages m ON m.id = r.message_id
         WHERE r.read_at >= ? ORDER BY r.read_at, r.message_id LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
        cursor,
      )) as Row[];
      if (rows.length === 0) break;
      result.rowsRead += rows.length;
      for (const row of rows) {
        const readAtRemote = toRemoteTimestamp(row["read_at"]) ?? "";
        const local = db.get<{ id: number }>("SELECT id FROM messages WHERE uuid = ?", row["uuid"]);
        if (!local) {
          if (holdback === null || readAtRemote < holdback) holdback = readAtRemote;
          continue;
        }
        const written = db.run(
          "INSERT OR IGNORE INTO message_read_receipts (message_id, agent, read_at) VALUES (?, ?, ?)",
          local.id,
          row["agent"],
          toLocalTimestamp(row["read_at"]),
        );
        result.rowsWritten += written.changes;
        if (readAtRemote > maxSeen) maxSeen = readAtRemote;
      }
      offset += rows.length;
      if (rows.length < PAGE_SIZE) break;
    }
    setMessageSyncState(db, STATE_KEYS.pullReceipts, holdback !== null ? holdback : maxSeen);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}
