import { Database as BunDatabase } from "bun:sqlite";
import type { Changes, SQLQueryBindings, Statement } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";
import { buildLegacyChannelNameMap, normalizeChannelName } from "./channel-names.js";
import { backfilledChannelIdForName } from "./channel-id.js";

export interface ConversationsStatement<ReturnType = any, ParamsType extends unknown[] = unknown[]> {
  all(...params: ParamsType): ReturnType[];
  get(...params: ParamsType): ReturnType | null;
  run(...params: ParamsType): Changes;
}

class LocalConversationsStatement<ReturnType = any, ParamsType extends unknown[] = unknown[]> implements ConversationsStatement<ReturnType, ParamsType> {
  constructor(private readonly statement: Statement<ReturnType, any[]>) {}

  all(...params: ParamsType): ReturnType[] {
    return this.statement.all(...normalizeBindings(params));
  }

  get(...params: ParamsType): ReturnType | null {
    return this.statement.get(...normalizeBindings(params));
  }

  run(...params: ParamsType): Changes {
    return this.statement.run(...normalizeBindings(params));
  }
}

export class ConversationsDatabase {
  private readonly database: BunDatabase;

  constructor(path: string) {
    this.database = new BunDatabase(path);
  }

  exec(sql: string): Changes {
    return this.database.exec(sql);
  }

  all<ReturnType = any>(sql: string, ...params: unknown[]): ReturnType[] {
    return this.database.query(sql).all(...normalizeBindings(params)) as ReturnType[];
  }

  get<ReturnType = any>(sql: string, ...params: unknown[]): ReturnType | null {
    return this.database.query(sql).get(...normalizeBindings(params)) as ReturnType | null;
  }

  query<ReturnType = any, ParamsType extends unknown[] = unknown[]>(sql: string): ConversationsStatement<ReturnType, ParamsType> {
    return new LocalConversationsStatement(this.database.query(sql));
  }

  prepare<ReturnType = any, ParamsType extends unknown[] = unknown[]>(sql: string): ConversationsStatement<ReturnType, ParamsType> {
    return new LocalConversationsStatement(this.database.prepare(sql));
  }

  run(sql: string, ...params: unknown[]): Changes {
    const bindings = normalizeBindings(params);
    return bindings.length === 0 ? this.database.run(sql) : this.database.run(sql, bindings);
  }

  transaction<T>(fn: () => T): T {
    return this.database.transaction(fn)();
  }

  close(): void {
    this.database.close();
  }
}

export type Database = ConversationsDatabase;

function normalizeBindings(params: unknown[]): SQLQueryBindings[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map(coerceBinding);
}

function coerceBinding(value: unknown): SQLQueryBindings {
  if (value === undefined) return null;
  return value as SQLQueryBindings;
}

let db: Database | null = null;

type PresenceColumnInfo = {
  name: string;
  notnull: number;
  pk: number;
};

type LegacyPresenceRow = Record<string, unknown> & {
  _rowid: number;
};

type LegacyChannelRow = {
  name: string;
  description: string | null;
  parent_id: string | null;
  project_id: string | null;
  created_by: string | null;
  created_at: string | null;
  archived_at: string | null;
  topic: string | null;
};

/**
 * Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then
 * the OS user database. A home that cannot be resolved is a hard error — never
 * a literal "~" path (relative to cwd) and never an "undefined"-prefixed path.
 */
/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const getHomeDir = resolveEffectiveHome;

/**
 * The resolver conversations data root: kind overrides honored,
 * `~/.hasna/conversations` on macOS, XDG data root on Linux.
 */
export function getResolverDataRoot(): string {
  return resolverDataDir({ app: "conversations", home: getHomeDir() });
}

/**
 * The pre-ruling legacy root (`~/.hasna/conversations`). On macOS this equals
 * the resolver root; elsewhere it is kept only for historical-data migration.
 */
export function getLegacyDataRoot(): string {
  return join(getHomeDir(), ".hasna", "conversations");
}

/** The exact-app override root, when set: `HASNA_CONVERSATIONS_HOME`, then `CONVERSATIONS_HOME`. */
export function getExactDataRoot(): string | undefined {
  const dir = process.env["HASNA_CONVERSATIONS_HOME"] ?? process.env["CONVERSATIONS_HOME"];
  if (dir && dir.trim()) return dir.trim();
  return undefined;
}

/**
 * The effective data root for conversations: an exact-app override
 * (`HASNA_CONVERSATIONS_HOME`, then `CONVERSATIONS_HOME`) wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform). The store path
 * (`HASNA_CONVERSATIONS_DB_PATH` / `CONVERSATIONS_DB_PATH`) is layered on top
 * of this by `getDbPath`, so an explicit store path always wins regardless.
 */
export function getDataDir(): string {
  const exact = getExactDataRoot();
  const effective = exact ? resolve(exact) : resolve(getResolverDataRoot());
  const oldDir = join(getHomeDir(), ".conversations");

  // Auto-migrate old dir to the effective data root
  if (existsSync(oldDir) && !existsSync(effective)) {
    mkdirSync(effective, { recursive: true });
    for (const file of readdirSync(oldDir)) {
      const oldPath = join(oldDir, file);
      if (statSync(oldPath).isFile()) {
        copyFileSync(oldPath, join(effective, file));
      }
    }
  }

  mkdirSync(effective, { recursive: true });
  return effective;
}

/**
 * `env` is optional and defaults to the real environment, so every existing
 * caller is unchanged. It exists because the store resolvers beside this one
 * (`isCloudStore`, `cloudApiUrl`) already take an env, and a helper that
 * threaded an env to those while this one silently read `process.env` produced a
 * test that injected a DB path and asserted against a value the injection could
 * not reach — a check that cannot fail.
 */
export function getDbPath(env: Record<string, string | undefined> = process.env): string {
  if (env.HASNA_CONVERSATIONS_DB_PATH) return env.HASNA_CONVERSATIONS_DB_PATH;
  if (env.CONVERSATIONS_DB_PATH) return env.CONVERSATIONS_DB_PATH;
  return join(getDataDir(), "messages.db");
}

function parsePresenceTimestamp(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  return new Date(`${value}Z`).getTime() || 0;
}

function normalizePresenceText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function shouldRebuildAgentPresenceTable(columns: PresenceColumnInfo[]): boolean {
  const byName = new Map(columns.map((column) => [column.name, column]));
  const agentCol = byName.get("agent");
  const projectCol = byName.get("project_id");

  if (!agentCol) return false;
  if (!projectCol) return true;

  return agentCol.pk !== 1
    || projectCol.pk !== 2
    || projectCol.notnull !== 1
    || byName.has("pid");
}

function rebuildLegacyAgentPresenceTable(db: Database): void {
  const fallbackNow = (db.prepare(
    "SELECT strftime('%Y-%m-%dT%H:%M:%f', 'now') AS now"
  ).get() as { now: string }).now;
  const legacyRows = db.prepare("SELECT rowid AS _rowid, * FROM agent_presence").all() as LegacyPresenceRow[];

  legacyRows.sort((left, right) => {
    const lastSeenDelta = parsePresenceTimestamp(right.last_seen_at) - parsePresenceTimestamp(left.last_seen_at);
    if (lastSeenDelta !== 0) return lastSeenDelta;

    const createdDelta = parsePresenceTimestamp(right.created_at) - parsePresenceTimestamp(left.created_at);
    if (createdDelta !== 0) return createdDelta;

    const projectDelta = Number(Boolean(normalizePresenceText(right.project_id))) - Number(Boolean(normalizePresenceText(left.project_id)));
    if (projectDelta !== 0) return projectDelta;

    return right._rowid - left._rowid;
  });

  const dedupedRows = new Map<string, LegacyPresenceRow>();
  for (const row of legacyRows) {
    const normalizedAgent = normalizePresenceText(row.agent)?.toLowerCase();
    if (!normalizedAgent) continue;

    const storedProjectId = normalizePresenceText(row.project_id) ?? "";
    const dedupeKey = `${normalizedAgent}\u0000${storedProjectId}`;
    if (dedupedRows.has(dedupeKey)) continue;
    dedupedRows.set(dedupeKey, row);
  }

  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE agent_presence_new (
        id TEXT NOT NULL,
        agent TEXT NOT NULL,
        session_id TEXT,
        role TEXT NOT NULL DEFAULT 'agent',
        project_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'online',
        last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
        metadata TEXT,
        PRIMARY KEY (agent, project_id)
      )
    `);

    const insertPresence = db.prepare(`
      INSERT INTO agent_presence_new (id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [dedupeKey, row] of dedupedRows) {
      const [agent, projectKey] = dedupeKey.split("\u0000");
      const id = normalizePresenceText(row.id) ?? crypto.randomUUID().slice(0, 8);
      const sessionId = normalizePresenceText(row.session_id);
      const role = normalizePresenceText(row.role) ?? "agent";
      const projectId = projectKey;
      const status = normalizePresenceText(row.status) ?? "online";
      const lastSeenAt = normalizePresenceText(row.last_seen_at) ?? fallbackNow;
      const createdAt = normalizePresenceText(row.created_at) ?? lastSeenAt;
      const metadata = typeof row.metadata === "string"
        ? row.metadata
        : row.metadata == null
          ? null
          : JSON.stringify(row.metadata);

      insertPresence.run(id, agent, sessionId, role, projectId, status, lastSeenAt, createdAt, metadata);
    }

    db.exec("DROP TABLE agent_presence");
    db.exec("ALTER TABLE agent_presence_new RENAME TO agent_presence");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function collapseDuplicateAgentPresenceRows(db: Database): void {
  const rows = db.prepare("SELECT rowid AS _rowid, * FROM agent_presence").all() as LegacyPresenceRow[];

  rows.sort((left, right) => {
    const lastSeenDelta = parsePresenceTimestamp(right.last_seen_at) - parsePresenceTimestamp(left.last_seen_at);
    if (lastSeenDelta !== 0) return lastSeenDelta;

    const createdDelta = parsePresenceTimestamp(right.created_at) - parsePresenceTimestamp(left.created_at);
    if (createdDelta !== 0) return createdDelta;

    const projectDelta = Number(Boolean(normalizePresenceText(right.project_id))) - Number(Boolean(normalizePresenceText(left.project_id)));
    if (projectDelta !== 0) return projectDelta;

    return right._rowid - left._rowid;
  });

  const rowIdsToDelete: number[] = [];
  const seenAgents = new Set<string>();
  for (const row of rows) {
    const normalizedAgent = normalizePresenceText(row.agent)?.toLowerCase();
    if (!normalizedAgent) continue;
    if (seenAgents.has(normalizedAgent)) {
      rowIdsToDelete.push(row._rowid);
      continue;
    }
    seenAgents.add(normalizedAgent);
  }

  if (rowIdsToDelete.length === 0) return;

  db.exec("BEGIN");
  try {
    const deleteRow = db.prepare("DELETE FROM agent_presence WHERE rowid = ?");
    for (const rowId of rowIdsToDelete) {
      deleteRow.run(rowId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function ensureAgentPresenceAgentUniqueIndex(db: Database): void {
  collapseDuplicateAgentPresenceRows(db);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_presence_agent_unique ON agent_presence(agent)");
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table));
}

function columnNames(db: Database, table: string): string[] {
  if (!tableExists(db, table)) return [];
  return db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all().map((row) => (row as { name: string }).name);
}

function hasColumn(db: Database, table: string, column: string): boolean {
  return columnNames(db, table).includes(column);
}

function safeExec(db: Database, sql: string): void {
  try {
    db.exec(sql);
  } catch {
    // Best effort for optional legacy indexes/triggers that may not exist.
  }
}

function nullableColumnExpr(columns: Set<string>, column: string): string {
  return columns.has(column) ? column : `NULL AS ${column}`;
}

function ensureFlatChannelsTable(db: Database): void {
  if (!tableExists(db, "channels") || !hasColumn(db, "channels", "parent_id")) return;

  const columns = new Set(columnNames(db, "channels"));
  safeExec(db, "DROP INDEX IF EXISTS idx_channels_parent");
  safeExec(db, "DROP INDEX IF EXISTS idx_channels_project");
  db.exec("DROP TABLE IF EXISTS channels_flat_import");

  db.exec(`
    CREATE TABLE channels_flat_import (
      id TEXT,
      name TEXT PRIMARY KEY,
      description TEXT,
      topic TEXT,
      project_id TEXT REFERENCES projects(id),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      archived_at TEXT,
      metadata TEXT,
      tags TEXT
    )
  `);
  db.exec(`
    INSERT OR IGNORE INTO channels_flat_import
      (id, name, description, topic, project_id, created_by, created_at, archived_at, metadata, tags)
    SELECT
      ${nullableColumnExpr(columns, "id")},
      name,
      ${nullableColumnExpr(columns, "description")},
      ${nullableColumnExpr(columns, "topic")},
      ${nullableColumnExpr(columns, "project_id")},
      COALESCE(created_by, 'migration'),
      COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      ${nullableColumnExpr(columns, "archived_at")},
      ${nullableColumnExpr(columns, "metadata")},
      ${nullableColumnExpr(columns, "tags")}
    FROM channels
  `);
  db.exec("DROP TABLE channels");
  db.exec("ALTER TABLE channels_flat_import RENAME TO channels");
  db.exec("CREATE INDEX IF NOT EXISTS idx_channels_project ON channels(project_id)");
}

function ensureChannelIds(db: Database): void {
  if (!hasColumn(db, "channels", "id")) {
    db.exec("ALTER TABLE channels ADD COLUMN id TEXT");
  }

  const missing = db.prepare(
    "SELECT name FROM channels WHERE id IS NULL OR trim(id) = '' ORDER BY name",
  ).all() as { name: string }[];
  const update = db.prepare("UPDATE channels SET id = ? WHERE name = ?");
  for (const row of missing) update.run(backfilledChannelIdForName(row.name), row.name);

  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_id ON channels(id)");
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS channels_require_id_insert
    BEFORE INSERT ON channels
    WHEN NEW.id IS NULL OR trim(NEW.id) = ''
    BEGIN
      SELECT RAISE(ABORT, 'channel id is required');
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS channels_id_immutable
    BEFORE UPDATE OF id ON channels
    WHEN NEW.id IS NOT OLD.id
    BEGIN
      SELECT RAISE(ABORT, 'channel id is immutable');
    END
  `);
}

function legacyTimestamp(db: Database): string {
  return (db.prepare(
    "SELECT strftime('%Y-%m-%dT%H:%M:%f', 'now') AS now"
  ).get() as { now: string }).now;
}

function getLegacyChannelRows(db: Database): LegacyChannelRow[] {
  if (!tableExists(db, "spaces")) return [];
  const columns = new Set(columnNames(db, "spaces"));
  const archivedExpr = columns.has("archived_at") ? "archived_at" : "NULL AS archived_at";
  const topicExpr = columns.has("topic") ? "topic" : "NULL AS topic";
  const parentExpr = columns.has("parent_id") ? "parent_id" : "NULL AS parent_id";
  const projectExpr = columns.has("project_id") ? "project_id" : "NULL AS project_id";
  return db.prepare(`
    SELECT name, description, ${parentExpr}, ${projectExpr}, created_by, created_at, ${archivedExpr}, ${topicExpr}
    FROM spaces
  `).all() as LegacyChannelRow[];
}

function addDistinctValues(values: Set<string>, rows: Array<Record<string, unknown>>, column: string): void {
  for (const row of rows) {
    const value = row[column];
    if (typeof value === "string" && value.trim()) values.add(value.trim());
  }
}

function collectLegacyChannelNames(db: Database, legacyRows: LegacyChannelRow[]): string[] {
  const values = new Set<string>();
  for (const row of legacyRows) values.add(row.name);
  if (hasColumn(db, "messages", "space")) addDistinctValues(values, db.prepare("SELECT DISTINCT space FROM messages WHERE space IS NOT NULL AND space != ''").all() as Array<Record<string, unknown>>, "space");
  if (tableExists(db, "space_members")) addDistinctValues(values, db.prepare("SELECT DISTINCT space FROM space_members WHERE space IS NOT NULL AND space != ''").all() as Array<Record<string, unknown>>, "space");
  if (tableExists(db, "space_subscriptions")) addDistinctValues(values, db.prepare("SELECT DISTINCT space FROM space_subscriptions WHERE space IS NOT NULL AND space != ''").all() as Array<Record<string, unknown>>, "space");
  if (hasColumn(db, "message_mentions", "space")) addDistinctValues(values, db.prepare("SELECT DISTINCT space FROM message_mentions WHERE space IS NOT NULL AND space != ''").all() as Array<Record<string, unknown>>, "space");
  if (hasColumn(db, "tasks", "space")) addDistinctValues(values, db.prepare("SELECT DISTINCT space FROM tasks WHERE space IS NOT NULL AND space != ''").all() as Array<Record<string, unknown>>, "space");
  if (tableExists(db, "graph_edges")) {
    addDistinctValues(values, db.prepare("SELECT DISTINCT from_id FROM graph_edges WHERE from_type = 'space'").all() as Array<Record<string, unknown>>, "from_id");
    addDistinctValues(values, db.prepare("SELECT DISTINCT to_id FROM graph_edges WHERE to_type = 'space'").all() as Array<Record<string, unknown>>, "to_id");
  }
  if (tableExists(db, "resource_locks")) addDistinctValues(values, db.prepare("SELECT DISTINCT resource_id FROM resource_locks WHERE resource_type = 'space'").all() as Array<Record<string, unknown>>, "resource_id");
  return [...values];
}

function hasRows(db: Database, sql: string): boolean {
  try {
    return Boolean(db.prepare(sql).get());
  } catch {
    return false;
  }
}

function hasLegacyChannelArtifacts(db: Database): boolean {
  return tableExists(db, "spaces") ||
    tableExists(db, "space_members") ||
    tableExists(db, "space_subscriptions") ||
    tableExists(db, "space_notification_reads") ||
    hasColumn(db, "messages", "space") ||
    hasColumn(db, "message_mentions", "space") ||
    hasColumn(db, "tasks", "space") ||
    hasRows(db, "SELECT 1 FROM graph_edges WHERE from_type = 'space' OR to_type = 'space' LIMIT 1") ||
    hasRows(db, "SELECT 1 FROM resource_locks WHERE resource_type = 'space' LIMIT 1");
}

function legacyChannelDepth(name: string, byName: Map<string, LegacyChannelRow>): number {
  let depth = 0;
  let current = byName.get(name);
  const seen = new Set<string>();
  while (current?.parent_id && !seen.has(current.parent_id)) {
    seen.add(current.parent_id);
    depth++;
    current = byName.get(current.parent_id);
  }
  return depth;
}

function firstLegacyMessageMetadata(db: Database, legacyName: string): { created_at: string; created_by: string | null } {
  const filters: string[] = [];
  const params: string[] = [];
  if (hasColumn(db, "messages", "space")) {
    filters.push("space = ?");
    params.push(legacyName);
  }
  if (hasColumn(db, "messages", "channel")) {
    filters.push("channel = ?");
    params.push(legacyName);
  }
  if (filters.length === 0) return { created_at: legacyTimestamp(db), created_by: null };
  const row = db.prepare(`
    SELECT created_at, from_agent
    FROM messages
    WHERE ${filters.join(" OR ")}
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `).get(...params) as { created_at: string; from_agent: string } | null;
  return { created_at: row?.created_at ?? legacyTimestamp(db), created_by: row?.from_agent ?? null };
}

function insertImportedChannel(
  db: Database,
  channelName: string,
  legacyName: string,
  source: "space" | "reference",
  row: LegacyChannelRow | undefined,
  parentChannel: string | null,
  depth: number,
): void {
  const firstMessage = row ? null : firstLegacyMessageMetadata(db, legacyName);
  const metadata = {
    import_source: {
      type: "legacy_space",
      source,
      name: legacyName,
      parent: row?.parent_id ?? null,
      parent_channel: parentChannel,
      depth,
      normalized_name: channelName,
    },
  };
  const tags = ["imported", "legacy-space"];
  if (row?.parent_id) tags.push(`legacy-parent:${normalizeChannelName(row.parent_id)}`);
  if (depth > 0) tags.push(`legacy-depth:${depth}`);

  db.prepare(`
    INSERT INTO channels (id, name, description, topic, project_id, created_by, created_at, archived_at, metadata, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      description = COALESCE(channels.description, excluded.description),
      topic = COALESCE(channels.topic, excluded.topic),
      project_id = COALESCE(channels.project_id, excluded.project_id),
      archived_at = COALESCE(channels.archived_at, excluded.archived_at),
      metadata = COALESCE(channels.metadata, excluded.metadata),
      tags = COALESCE(channels.tags, excluded.tags)
  `).run(
    backfilledChannelIdForName(channelName),
    channelName,
    row?.description ?? null,
    row?.topic ?? null,
    row?.project_id ?? null,
    row?.created_by ?? firstMessage?.created_by ?? "migration",
    row?.created_at ?? firstMessage?.created_at ?? legacyTimestamp(db),
    row?.archived_at ?? null,
    JSON.stringify(metadata),
    JSON.stringify(tags),
  );
}

function mapLegacyChannel(value: string | null | undefined, nameMap: Map<string, string>): string | null {
  if (!value) return null;
  return nameMap.get(value) ?? normalizeChannelName(value);
}

function migrateLegacyChannels(db: Database): void {
  if (hasColumn(db, "message_mentions", "space") && !hasColumn(db, "message_mentions", "channel")) {
    db.exec("ALTER TABLE message_mentions ADD COLUMN channel TEXT");
  }
  if (hasColumn(db, "tasks", "space") && !hasColumn(db, "tasks", "channel")) {
    db.exec("ALTER TABLE tasks ADD COLUMN channel TEXT");
  }

  const legacyRows = getLegacyChannelRows(db);
  const legacyNames = collectLegacyChannelNames(db, legacyRows);
  if (legacyNames.length === 0) return;

  const nameMap = buildLegacyChannelNameMap(legacyNames);
  const legacyByName = new Map(legacyRows.map((row) => [row.name, row]));

  db.exec("BEGIN");
  try {
    for (const legacyName of legacyNames.sort((left, right) => left.localeCompare(right))) {
      const row = legacyByName.get(legacyName);
      const channelName = mapLegacyChannel(legacyName, nameMap)!;
      const parentChannel = row?.parent_id ? mapLegacyChannel(row.parent_id, nameMap) : null;
      insertImportedChannel(db, channelName, legacyName, row ? "space" : "reference", row, parentChannel, row ? legacyChannelDepth(row.name, legacyByName) : 0);
    }

    if (tableExists(db, "space_members")) {
      const insert = db.prepare("INSERT OR IGNORE INTO channel_members (channel, agent, joined_at) VALUES (?, ?, ?)");
      const rows = db.prepare("SELECT space, agent, joined_at FROM space_members").all() as Array<{ space: string; agent: string; joined_at: string }>;
      for (const row of rows) insert.run(mapLegacyChannel(row.space, nameMap), row.agent, row.joined_at);
    }

    if (tableExists(db, "space_subscriptions")) {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO channel_subscriptions (channel, agent, created_at, preview_chars, since_message_id)
        VALUES (?, ?, ?, ?, ?)
      `);
      const hasSince = hasColumn(db, "space_subscriptions", "since_message_id");
      const rows = db.prepare(`SELECT space, agent, created_at, preview_chars, ${hasSince ? "since_message_id" : "0 AS since_message_id"} FROM space_subscriptions`).all() as Array<{ space: string; agent: string; created_at: string; preview_chars: number; since_message_id: number }>;
      for (const row of rows) insert.run(mapLegacyChannel(row.space, nameMap), row.agent, row.created_at, row.preview_chars, row.since_message_id);
    }

    if (tableExists(db, "space_notification_reads")) {
      db.exec("INSERT OR IGNORE INTO channel_notification_reads (agent, message_id, read_at) SELECT agent, message_id, read_at FROM space_notification_reads");
    }

    if (hasColumn(db, "messages", "space")) {
      const updateMessages = db.prepare("UPDATE messages SET channel = ?, to_agent = ? WHERE space = ?");
      for (const [legacyName, channelName] of nameMap) updateMessages.run(channelName, channelName, legacyName);
    }
    if (hasColumn(db, "messages", "channel")) {
      const updateMessages = db.prepare("UPDATE messages SET channel = ?, to_agent = CASE WHEN to_agent = ? THEN ? ELSE to_agent END WHERE channel = ?");
      for (const [legacyName, channelName] of nameMap) updateMessages.run(channelName, legacyName, channelName, legacyName);
    }
    const updateSessions = db.prepare("UPDATE messages SET session_id = ? WHERE session_id = ? OR session_id = ?");
    for (const [legacyName, channelName] of nameMap) {
      updateSessions.run(`channel:${channelName}`, `space:${legacyName}`, `channel:${legacyName}`);
    }

    if (hasColumn(db, "message_mentions", "space")) {
      const updateMentions = db.prepare("UPDATE message_mentions SET channel = ? WHERE space = ?");
      for (const [legacyName, channelName] of nameMap) updateMentions.run(channelName, legacyName);
    }
    if (hasColumn(db, "tasks", "space")) {
      const updateTasks = db.prepare("UPDATE tasks SET channel = ? WHERE space = ?");
      for (const [legacyName, channelName] of nameMap) updateTasks.run(channelName, legacyName);
    }
    if (tableExists(db, "graph_edges")) {
      const updateFrom = db.prepare("UPDATE graph_edges SET from_type = 'channel', from_id = ? WHERE from_type = 'space' AND from_id = ?");
      const updateTo = db.prepare("UPDATE graph_edges SET to_type = 'channel', to_id = ? WHERE to_type = 'space' AND to_id = ?");
      for (const [legacyName, channelName] of nameMap) {
        updateFrom.run(channelName, legacyName);
        updateTo.run(channelName, legacyName);
      }
    }
    if (tableExists(db, "resource_locks")) {
      const updateLocks = db.prepare("UPDATE resource_locks SET resource_type = 'channel', resource_id = ? WHERE resource_type = 'space' AND resource_id = ?");
      for (const [legacyName, channelName] of nameMap) updateLocks.run(channelName, legacyName);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function dropLegacyChannelStorage(db: Database): void {
  safeExec(db, "DROP TRIGGER IF EXISTS messages_fts_insert");
  safeExec(db, "DROP TRIGGER IF EXISTS messages_fts_delete");
  safeExec(db, "DROP TRIGGER IF EXISTS messages_fts_update");
  safeExec(db, "DROP TABLE IF EXISTS messages_fts");
  safeExec(db, "DROP INDEX IF EXISTS idx_messages_space");
  safeExec(db, "DROP INDEX IF EXISTS idx_spaces_parent");
  safeExec(db, "DROP INDEX IF EXISTS idx_spaces_project");
  safeExec(db, "DROP INDEX IF EXISTS idx_space_subscriptions_agent");
  safeExec(db, "DROP INDEX IF EXISTS idx_space_subscriptions_space");
  safeExec(db, "DROP INDEX IF EXISTS idx_space_notification_reads_agent");
  safeExec(db, "DROP INDEX IF EXISTS idx_space_notification_reads_message");
  safeExec(db, "DROP INDEX IF EXISTS idx_tasks_space");
  db.exec("DROP TABLE IF EXISTS space_members");
  db.exec("DROP TABLE IF EXISTS space_subscriptions");
  db.exec("DROP TABLE IF EXISTS space_notification_reads");
  db.exec("DROP TABLE IF EXISTS spaces");
  if (hasColumn(db, "messages", "space")) db.exec("ALTER TABLE messages DROP COLUMN space");
  if (hasColumn(db, "message_mentions", "space")) db.exec("ALTER TABLE message_mentions DROP COLUMN space");
  if (hasColumn(db, "tasks", "space")) db.exec("ALTER TABLE tasks DROP COLUMN space");
}

function dropMessagesFts(db: Database): void {
  safeExec(db, "DROP TRIGGER IF EXISTS messages_fts_insert");
  safeExec(db, "DROP TRIGGER IF EXISTS messages_fts_delete");
  safeExec(db, "DROP TRIGGER IF EXISTS messages_fts_update");
  safeExec(db, "DROP TABLE IF EXISTS messages_fts");
}

export function getDb(): Database {
  if (db) return db;

  const dbPath = getDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });

  const freshDatabase = !existsSync(dbPath);
  const openedDb = new ConversationsDatabase(dbPath);
  db = openedDb;
  db.exec("PRAGMA busy_timeout = 5000");
  const journalMode = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
  if (journalMode.journal_mode.toLowerCase() !== "wal") {
    db.exec("PRAGMA journal_mode = WAL");
  }

  // A fresh schema contains hundreds of DDL statements. Without one outer
  // transaction SQLite durably commits each statement separately; isolated
  // tests create a fresh database per case and paid that full fsync sequence
  // thousands of times. Existing databases retain the migration transaction
  // boundaries below. A fresh database has no legacy rows, so those conditional
  // migration transactions are unreachable inside this one.
  if (freshDatabase) db.exec("BEGIN IMMEDIATE");
  try {
  // Messages table (new DBs get 'channel' column; existing DBs migrate below)
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      session_id TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      channel TEXT,
      project_id TEXT,
      content TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      working_dir TEXT,
      repository TEXT,
      branch TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      read_at TEXT
    )
  `);

  const initialMsgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const initialMsgColNames = initialMsgCols.map((c) => c.name);
  if (!initialMsgColNames.includes("channel")) {
    db.exec("ALTER TABLE messages ADD COLUMN channel TEXT");
  }

  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_agent)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)");

  // Projects table
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      path TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      metadata TEXT,
      tags TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      repository TEXT,
      settings TEXT
    )
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)");

  // Channels table
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT NOT NULL UNIQUE,
      name TEXT PRIMARY KEY,
      description TEXT,
      topic TEXT,
      project_id TEXT REFERENCES projects(id),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      archived_at TEXT,
      metadata TEXT,
      tags TEXT
    )
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_channels_project ON channels(project_id)");
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_rename_aliases (
      old_channel TEXT PRIMARY KEY,
      current_channel TEXT NOT NULL,
      renamed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      CHECK (old_channel <> current_channel)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_channel_rename_aliases_current ON channel_rename_aliases(current_channel)");

  // Immutable receipts for the guarded channel-message project linkage
  // repair. Rollback creates a second receipt; it never mutates the apply
  // receipt that carries the exact pre-change row identities and hashes.
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_project_linkage_receipts (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      operation TEXT NOT NULL CHECK (operation IN ('apply', 'rollback')),
      channel TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source_receipt_id TEXT,
      request_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_channel_project_linkage_receipts_channel ON channel_project_linkage_receipts(channel, created_at)");
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS channel_project_linkage_receipts_no_update
    BEFORE UPDATE ON channel_project_linkage_receipts
    BEGIN SELECT RAISE(ABORT, 'channel project linkage receipts are immutable'); END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS channel_project_linkage_receipts_no_delete
    BEFORE DELETE ON channel_project_linkage_receipts
    BEGIN SELECT RAISE(ABORT, 'channel project linkage receipts are immutable'); END
  `);

  // Immutable receipts for the guarded atomic channel merge. Apply records the
  // exact moved row identities and prior alias/archive state; rollback creates
  // a second receipt and never mutates the apply receipt.
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_merge_receipts (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      operation TEXT NOT NULL CHECK (operation IN ('apply', 'rollback')),
      source_channel TEXT NOT NULL,
      destination_channel TEXT NOT NULL,
      source_receipt_id TEXT,
      request_hash TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_channel_merge_receipts_source ON channel_merge_receipts(source_channel, created_at)");
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS channel_merge_receipts_no_update
    BEFORE UPDATE ON channel_merge_receipts
    BEGIN SELECT RAISE(ABORT, 'channel merge receipts are immutable'); END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS channel_merge_receipts_no_delete
    BEFORE DELETE ON channel_merge_receipts
    BEGIN SELECT RAISE(ABORT, 'channel merge receipts are immutable'); END
  `);

  // Package-owned project-channel registration authority. The singleton
  // identity makes the corpus stable across process restarts, while receipts
  // remain append-only evidence for accepted, duplicate, and nonacceptance
  // outcomes.
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_channel_registration_identity (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      corpus_id TEXT NOT NULL UNIQUE
    )
  `);
  db.exec(`
    INSERT OR IGNORE INTO project_channel_registration_identity (singleton, corpus_id)
    VALUES (1, 'cor_' || lower(hex(randomblob(16))))
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_channel_registration_receipts (
      receipt_id TEXT PRIMARY KEY,
      authority TEXT NOT NULL,
      route TEXT NOT NULL,
      package_version TEXT NOT NULL,
      authority_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      corpus_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL CHECK (resource_kind = 'channel'),
      direction TEXT NOT NULL CHECK (direction IN ('forward', 'inverse')),
      idempotency_key TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      precondition_digest TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'duplicate_of_accepted', 'terminal_nonacceptance')),
      reason TEXT,
      target_id TEXT,
      result_revision TEXT,
      result_digest TEXT,
      duplicate_of_receipt_id TEXT,
      accepted_receipt_id TEXT,
      created_by_operation INTEGER NOT NULL CHECK (created_by_operation IN (0, 1)),
      prior_state TEXT,
      created_at TEXT NOT NULL
    )
  `);
  const projectChannelReceiptColumns = db.prepare(
    "PRAGMA table_info(project_channel_registration_receipts)",
  ).all() as Array<{ name: string }>;
  if (!projectChannelReceiptColumns.some((column) => column.name === "prior_state")) {
    db.exec("ALTER TABLE project_channel_registration_receipts ADD COLUMN prior_state TEXT");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_project_channel_registration_receipt_lookup
    ON project_channel_registration_receipts (
      authority, route, package_version, authority_id, tenant_id, corpus_id,
      operation_id, step_id, resource_kind, direction, idempotency_key,
      target_id, created_at
    )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_project_channel_registration_receipt_step
    ON project_channel_registration_receipts (
      authority_id, tenant_id, corpus_id, operation_id, step_id, direction,
      outcome, created_at
    )
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS project_channel_registration_receipts_no_update
    BEFORE UPDATE ON project_channel_registration_receipts
    BEGIN SELECT RAISE(ABORT, 'project channel registration receipts are immutable'); END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS project_channel_registration_receipts_no_delete
    BEFORE DELETE ON project_channel_registration_receipts
    BEGIN SELECT RAISE(ABORT, 'project channel registration receipts are immutable'); END
  `);

  // Channel members table
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_members (
      channel TEXT NOT NULL REFERENCES channels(name),
      agent TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      PRIMARY KEY (channel, agent)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_subscriptions (
      channel TEXT NOT NULL REFERENCES channels(name),
      agent TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      preview_chars INTEGER NOT NULL DEFAULT 140,
      since_message_id INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (channel, agent)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_channel_subscriptions_agent ON channel_subscriptions(agent)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_channel_subscriptions_channel ON channel_subscriptions(channel)");

  // Agent presence table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_presence (
      id TEXT NOT NULL,
      agent TEXT NOT NULL,
      session_id TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      project_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'online',
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      metadata TEXT,
      PRIMARY KEY (agent, project_id)
    )
  `);
  ensureAgentPresenceAgentUniqueIndex(db);

  // Append-only archive of rows removed by the single-touch roster reaper, so
  // the apply path preserves a recoverable original of everything it deletes.
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_presence_reap_archive (
      reaped_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      id TEXT NOT NULL,
      agent TEXT NOT NULL,
      session_id TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      project_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'online',
      last_seen_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      metadata TEXT
    )
  `);

  // Resource locks table (advisory + exclusive write coordination)
  db.exec(`
    CREATE TABLE IF NOT EXISTS resource_locks (
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      lock_type TEXT NOT NULL DEFAULT 'advisory',
      locked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      expires_at TEXT NOT NULL,
      UNIQUE(resource_type, resource_id, lock_type)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_locks_resource ON resource_locks(resource_type, resource_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_locks_agent ON resource_locks(agent_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_locks_expires ON resource_locks(expires_at)");

  // Reactions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      UNIQUE(message_id, agent, emoji)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_notification_reads (
      agent TEXT NOT NULL,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      PRIMARY KEY (agent, message_id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_channel_notification_reads_agent ON channel_notification_reads(agent)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_channel_notification_reads_message ON channel_notification_reads(message_id)");

  // ---- Migrations for existing databases ----

  const channelCols = db.prepare("PRAGMA table_info(channels)").all() as { name: string }[];
  const channelColNames = channelCols.map((c) => c.name);
  if (!channelColNames.includes("archived_at")) {
    db.exec("ALTER TABLE channels ADD COLUMN archived_at TEXT");
  }
  if (!channelColNames.includes("topic")) {
    db.exec("ALTER TABLE channels ADD COLUMN topic TEXT");
  }
  if (!channelColNames.includes("metadata")) {
    db.exec("ALTER TABLE channels ADD COLUMN metadata TEXT");
  }
  if (!channelColNames.includes("tags")) {
    db.exec("ALTER TABLE channels ADD COLUMN tags TEXT");
  }
  if (channelColNames.includes("parent_id")) {
    ensureFlatChannelsTable(db);
  }

  const channelSubscriptionCols = db.prepare("PRAGMA table_info(channel_subscriptions)").all() as { name: string }[];
  const channelSubscriptionColNames = channelSubscriptionCols.map((c) => c.name);
  if (!channelSubscriptionColNames.includes("since_message_id")) {
    db.exec("ALTER TABLE channel_subscriptions ADD COLUMN since_message_id INTEGER NOT NULL DEFAULT 0");
    db.exec(`
      UPDATE channel_subscriptions
      SET since_message_id = COALESCE(
        (SELECT MAX(m.id) FROM messages m WHERE m.channel = channel_subscriptions.channel),
        0
      )
      WHERE since_message_id = 0
    `);
  }

  const hasLegacyChannels = hasLegacyChannelArtifacts(db);
  if (hasLegacyChannels) {
    migrateLegacyChannels(db);
  }
  ensureChannelIds(db);
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel)");

  // Add edited_at and pinned_at columns if missing
  const msgCols2 = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  const colNames2 = msgCols2.map((c) => c.name);
  if (!colNames2.includes("edited_at")) {
    db.exec("ALTER TABLE messages ADD COLUMN edited_at TEXT");
  }
  if (!colNames2.includes("pinned_at")) {
    db.exec("ALTER TABLE messages ADD COLUMN pinned_at TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(pinned_at)");
  }
  if (!colNames2.includes("blocking")) {
    db.exec("ALTER TABLE messages ADD COLUMN blocking INTEGER NOT NULL DEFAULT 0");
    db.exec("CREATE INDEX IF NOT EXISTS idx_messages_blocking ON messages(blocking)");
  }
  if (!colNames2.includes("attachments")) {
    db.exec("ALTER TABLE messages ADD COLUMN attachments TEXT");
  }
  if (!colNames2.includes("reply_to")) {
    db.exec("ALTER TABLE messages ADD COLUMN reply_to INTEGER REFERENCES messages(id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to)");
  }
  // Thread collection (task bf381fad): thread_id marks every reply with its
  // chain ROOT (the message reached by walking reply_to up); thread_status
  // carries the open/closed lifecycle on the root. Existing rows are backfilled
  // by walking the reply_to chains, so pre-thread data becomes groupable.
  if (!colNames2.includes("thread_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN thread_id INTEGER REFERENCES messages(id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id)");
  }
  if (!colNames2.includes("thread_status")) {
    db.exec("ALTER TABLE messages ADD COLUMN thread_status TEXT");
  }
  // Backfill thread_id for pre-thread rows by walking the reply_to chains to
  // their ROOT. Guarded so the recursive scan runs only when work exists — on
  // a fully-backfilled store the CTE would otherwise recompute the whole graph
  // on every init.
  const unthreaded = db.prepare(
    "SELECT COUNT(*) AS n FROM messages WHERE reply_to IS NOT NULL AND thread_id IS NULL",
  ).get() as { n: number } | undefined;
  if (Number(unthreaded?.n ?? 0) > 0) {
    db.exec(`
      WITH RECURSIVE chain AS (
        SELECT id, id AS root_id FROM messages WHERE reply_to IS NULL
        UNION ALL
        SELECT m.id, c.root_id FROM messages m JOIN chain c ON m.reply_to = c.id
      )
      UPDATE messages
      SET thread_id = (SELECT chain.root_id FROM chain WHERE chain.id = messages.id)
      WHERE reply_to IS NOT NULL AND thread_id IS NULL
    `);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_scope_rewrite_guard (
      token INTEGER PRIMARY KEY CHECK (token = 1),
      old_session_id TEXT NOT NULL,
      new_session_id TEXT NOT NULL,
      old_channel TEXT,
      new_channel TEXT,
      old_to_agent TEXT NOT NULL,
      new_to_agent TEXT NOT NULL
    )
  `);
  if (!colNames2.includes("project_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN project_id TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id)");
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_reply_scope_insert
    BEFORE INSERT ON messages
    WHEN NEW.reply_to IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM messages parent
      WHERE parent.id = NEW.reply_to
        AND parent.session_id = NEW.session_id
        AND parent.channel IS NEW.channel
        AND parent.project_id IS NEW.project_id
    )
    BEGIN SELECT RAISE(ABORT, 'reply parent is missing or outside the message scope'); END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_reply_scope_update
    BEFORE UPDATE OF reply_to, session_id, channel, project_id ON messages
    WHEN NEW.reply_to IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM messages parent
      WHERE parent.id = NEW.reply_to
        AND parent.session_id = NEW.session_id
        AND parent.channel IS NEW.channel
        AND parent.project_id IS NEW.project_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM message_scope_rewrite_guard guard
      WHERE OLD.session_id = guard.old_session_id
        AND NEW.session_id = guard.new_session_id
        AND (
          (OLD.channel IS guard.old_channel AND NEW.channel IS guard.new_channel)
          OR OLD.channel IS NEW.channel
        )
        AND (
          (OLD.to_agent = guard.old_to_agent AND NEW.to_agent = guard.new_to_agent)
          OR OLD.to_agent IS NEW.to_agent
        )
        AND OLD.project_id IS NEW.project_id
    )
    BEGIN SELECT RAISE(ABORT, 'reply parent is missing or outside the message scope'); END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_reply_parent_scope_no_update
    BEFORE UPDATE OF session_id, channel, project_id ON messages
    WHEN EXISTS (SELECT 1 FROM messages child WHERE child.reply_to = OLD.id)
      AND (NEW.session_id IS NOT OLD.session_id OR NEW.channel IS NOT OLD.channel OR NEW.project_id IS NOT OLD.project_id)
      AND NOT EXISTS (
        SELECT 1 FROM message_scope_rewrite_guard guard
        WHERE OLD.session_id = guard.old_session_id
          AND NEW.session_id = guard.new_session_id
          AND (
            (OLD.channel IS guard.old_channel AND NEW.channel IS guard.new_channel)
            OR OLD.channel IS NEW.channel
          )
          AND (
            (OLD.to_agent = guard.old_to_agent AND NEW.to_agent = guard.new_to_agent)
            OR OLD.to_agent IS NEW.to_agent
          )
          AND OLD.project_id IS NEW.project_id
      )
    BEGIN SELECT RAISE(ABORT, 'reply parent scope is immutable while replies exist'); END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_reply_parent_scope_no_delete
    BEFORE DELETE ON messages
    WHEN EXISTS (SELECT 1 FROM messages child WHERE child.reply_to = OLD.id)
    BEGIN SELECT RAISE(ABORT, 'reply parent scope is immutable while replies exist'); END
  `);
  if (!colNames2.includes("uuid")) {
    db.exec("ALTER TABLE messages ADD COLUMN uuid TEXT");
    // Backfill existing rows with unique UUIDs
    db.exec("UPDATE messages SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_uuid ON messages(uuid)");
  }

  // Migrate agent_presence: add id, session_id, role, created_at columns
  let presenceCols = db.prepare("PRAGMA table_info(agent_presence)").all() as PresenceColumnInfo[];
  let presenceColNames = presenceCols.map((c) => c.name);

  // Normalize legacy presence schemas into the current composite agent+project form.
  if (shouldRebuildAgentPresenceTable(presenceCols)) {
    rebuildLegacyAgentPresenceTable(db);
    presenceCols = db.prepare("PRAGMA table_info(agent_presence)").all() as PresenceColumnInfo[];
    presenceColNames = presenceCols.map((c) => c.name);
  }

  if (!presenceColNames.includes("id")) {
    db.exec("ALTER TABLE agent_presence ADD COLUMN id TEXT NOT NULL DEFAULT ''");
    // Backfill existing rows with generated IDs
    const rows = db.prepare("SELECT agent FROM agent_presence").all() as { agent: string }[];
    for (const row of rows) {
      const id = crypto.randomUUID().slice(0, 8);
      db.prepare("UPDATE agent_presence SET id = ? WHERE agent = ?").run(id, row.agent);
    }
  }
  if (!presenceColNames.includes("session_id")) {
    db.exec("ALTER TABLE agent_presence ADD COLUMN session_id TEXT");
  }
  if (!presenceColNames.includes("role")) {
    db.exec("ALTER TABLE agent_presence ADD COLUMN role TEXT NOT NULL DEFAULT 'agent'");
  }
  if (!presenceColNames.includes("created_at")) {
    // SQLite ALTER TABLE does not support non-constant defaults — use empty string, backfill from last_seen_at
    db.exec("ALTER TABLE agent_presence ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE agent_presence SET created_at = last_seen_at WHERE created_at = ''");
  }
  if (!presenceColNames.includes("project_id")) {
    db.exec("ALTER TABLE agent_presence ADD COLUMN project_id TEXT");
    db.exec("UPDATE agent_presence SET project_id = '' WHERE project_id IS NULL");
  }

  ensureAgentPresenceAgentUniqueIndex(db);

  // Per-agent channel message read receipts
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_read_receipts (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      PRIMARY KEY (message_id, agent)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_read_receipts_message ON message_read_receipts(message_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_read_receipts_agent ON message_read_receipts(agent)");

  // Canonical incident state is append-only. Message text is display material;
  // typed indexed ledger rows remain the source of current incident state.
  db.exec(`
    CREATE TABLE IF NOT EXISTS incident_projections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL,
      projection_key TEXT NOT NULL,
      message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id),
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      source TEXT NOT NULL CHECK (source = 'todos'),
      tenant_id TEXT NOT NULL,
      authority_id TEXT NOT NULL,
      incident_id TEXT NOT NULL,
      transition_id TEXT NOT NULL,
      incident_version INTEGER NOT NULL CHECK (incident_version > 0),
      occurred_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open','investigating','contained','monitoring','resolved','superseded')),
      severity TEXT NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
      blocking INTEGER NOT NULL DEFAULT 0,
      affected_scopes TEXT NOT NULL,
      blocked_scopes TEXT NOT NULL,
      supersedes_transition_id TEXT,
      supersedes_incident_id TEXT,
      superseded_by_incident_id TEXT,
      canonical_payload TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      CHECK (NOT (status IN ('resolved','superseded') AND blocking = 1)),
      UNIQUE (tenant_id, event_id),
      UNIQUE (tenant_id, projection_key),
      UNIQUE (tenant_id, authority_id, incident_id, transition_id),
      UNIQUE (tenant_id, authority_id, incident_id, incident_version)
    )
  `);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_incident_projections_message ON incident_projections(message_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_incident_projections_active_scope ON incident_projections(tenant_id, authority_id, incident_id, incident_version DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_incident_projections_blocking_scope ON incident_projections(tenant_id, authority_id, blocking, incident_id, incident_version DESC)");
  db.exec(`
    CREATE TABLE IF NOT EXISTS incident_projection_scopes (
      projection_id INTEGER NOT NULL REFERENCES incident_projections(id),
      scope_type TEXT NOT NULL CHECK (scope_type IN ('affected','blocked')),
      scope TEXT NOT NULL,
      PRIMARY KEY (projection_id, scope_type, scope)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_incident_projection_scopes_lookup ON incident_projection_scopes(scope_type, scope, projection_id)");
  db.exec(`CREATE TRIGGER IF NOT EXISTS incident_projections_no_update BEFORE UPDATE ON incident_projections BEGIN SELECT RAISE(ABORT, 'incident projections are append-only'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS incident_projections_no_delete BEFORE DELETE ON incident_projections BEGIN SELECT RAISE(ABORT, 'incident projections are append-only'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS incident_projection_scopes_no_update BEFORE UPDATE ON incident_projection_scopes BEGIN SELECT RAISE(ABORT, 'incident projection scopes are append-only'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS incident_projection_scopes_no_delete BEFORE DELETE ON incident_projection_scopes BEGIN SELECT RAISE(ABORT, 'incident projection scopes are append-only'); END`);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS incident_projection_messages_no_mutation
    BEFORE UPDATE ON messages
    WHEN EXISTS (SELECT 1 FROM incident_projections WHERE message_id = OLD.id)
      AND (
        NEW.uuid IS NOT OLD.uuid OR NEW.session_id IS NOT OLD.session_id OR
        NEW.from_agent IS NOT OLD.from_agent OR NEW.to_agent IS NOT OLD.to_agent OR
        NEW.channel IS NOT OLD.channel OR NEW.project_id IS NOT OLD.project_id OR
        NEW.content IS NOT OLD.content OR NEW.priority IS NOT OLD.priority OR
        NEW.working_dir IS NOT OLD.working_dir OR NEW.repository IS NOT OLD.repository OR
        NEW.branch IS NOT OLD.branch OR NEW.metadata IS NOT OLD.metadata OR
        NEW.edited_at IS NOT OLD.edited_at OR NEW.blocking IS NOT OLD.blocking OR
        NEW.attachments IS NOT OLD.attachments OR NEW.reply_to IS NOT OLD.reply_to OR
        NEW.created_at IS NOT OLD.created_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM message_scope_rewrite_guard guard
        WHERE OLD.session_id = guard.old_session_id AND NEW.session_id = guard.new_session_id
          AND OLD.channel IS guard.old_channel AND NEW.channel IS guard.new_channel
          AND OLD.to_agent = guard.old_to_agent AND NEW.to_agent = guard.new_to_agent
          AND NEW.uuid IS OLD.uuid AND NEW.from_agent IS OLD.from_agent
          AND NEW.project_id IS OLD.project_id AND NEW.content IS OLD.content
          AND NEW.priority IS OLD.priority AND NEW.working_dir IS OLD.working_dir
          AND NEW.repository IS OLD.repository AND NEW.branch IS OLD.branch
          AND NEW.metadata IS OLD.metadata AND NEW.created_at IS OLD.created_at
          AND NEW.read_at IS OLD.read_at AND NEW.edited_at IS OLD.edited_at
          AND NEW.pinned_at IS OLD.pinned_at AND NEW.blocking IS OLD.blocking
          AND NEW.attachments IS OLD.attachments AND NEW.reply_to IS OLD.reply_to
      )
    BEGIN SELECT RAISE(ABORT, 'incident projection messages are append-only'); END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS incident_projection_messages_no_delete
    BEFORE DELETE ON messages
    WHEN EXISTS (SELECT 1 FROM incident_projections WHERE message_id = OLD.id)
    BEGIN SELECT RAISE(ABORT, 'incident projection messages are append-only'); END
  `);

  // Message mentions table — @agent notifications
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      mentioned_agent TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      channel TEXT,
      notified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_mentions_agent ON message_mentions(mentioned_agent)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mentions_message ON message_mentions(message_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mentions_notified ON message_mentions(notified_at)");

  if (hasLegacyChannels) {
    dropLegacyChannelStorage(db);
  } else if (tableExists(db, "messages_fts") && !hasColumn(db, "messages_fts", "channel")) {
    dropMessagesFts(db);
  }

  // FTS5 virtual table for full-text search
  const ftsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'"
  ).get();
  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        content, from_agent, to_agent, channel,
        content_rowid='id', content='messages'
      )
    `);
    // Populate from existing messages
    db.exec(`
      INSERT INTO messages_fts(rowid, content, from_agent, to_agent, channel)
      SELECT id, content, from_agent, to_agent, channel FROM messages
    `);
    // Triggers to keep FTS in sync
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content, from_agent, to_agent, channel)
        VALUES (new.id, new.content, new.from_agent, new.to_agent, new.channel);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, from_agent, to_agent, channel)
        VALUES ('delete', old.id, old.content, old.from_agent, old.to_agent, old.channel);
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, from_agent, to_agent, channel)
        VALUES ('delete', old.id, old.content, old.from_agent, old.to_agent, old.channel);
        INSERT INTO messages_fts(rowid, content, from_agent, to_agent, channel)
        VALUES (new.id, new.content, new.from_agent, new.to_agent, new.channel);
      END
    `);
  }

  // Feedback table
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      message TEXT NOT NULL,
      email TEXT,
      category TEXT DEFAULT 'general',
      version TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      subject TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      assignee TEXT,
      reporter TEXT NOT NULL,
      project_id TEXT,
      channel TEXT,
      parent_id INTEGER REFERENCES tasks(id),
      depends_on TEXT,
      tags TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      started_at TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      due_at TEXT
    )
  `);
  if (!hasColumn(db, "tasks", "channel")) {
    db.exec("ALTER TABLE tasks ADD COLUMN channel TEXT");
  }
  if (hasColumn(db, "tasks", "space")) {
    safeExec(db, "DROP INDEX IF EXISTS idx_tasks_space");
    safeExec(db, "ALTER TABLE tasks DROP COLUMN space");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_uuid ON tasks(uuid)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_reporter ON tasks(reporter)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_channel ON tasks(channel)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)");

  // Task comments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id)");

  // Task activity log
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity(task_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_task_activity_agent ON task_activity(agent)");

  // Task dependencies table (many-to-many)
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, depends_on_id)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_dependencies(depends_on_id)");

  // Conversations → Events source outbox (webhook-delivery contract). Written
  // in the SAME transaction as the message/task mutation; drained by the outbox
  // worker into the Events durable substrate.
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations_event_outbox (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      envelope_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'spooled', 'delivered', 'dead')),
      attempts INTEGER NOT NULL DEFAULT 0
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_conversations_event_outbox_pending ON conversations_event_outbox(status, created_at)");

  // FTS5 virtual table for full-text task search
  const hasTasksFts = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks_fts'"
  ).get();
  if (!hasTasksFts) {
    db.exec(`
      CREATE VIRTUAL TABLE tasks_fts USING fts5(
        subject, description, tags
      )
    `);
    // Populate from existing data — strip JSON brackets/quotes from tags
    db.exec(`
      INSERT INTO tasks_fts(rowid, subject, description, tags)
      SELECT id, COALESCE(subject, ''), COALESCE(description, ''),
             COALESCE(REPLACE(REPLACE(REPLACE(tags, '[', ''), ']', ''), '"', ''), '')
      FROM tasks
    `);
    // Triggers to keep FTS in sync using rowid = task.id
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS tasks_fts_insert AFTER INSERT ON tasks BEGIN
        INSERT INTO tasks_fts(rowid, subject, description, tags)
        VALUES (new.id, COALESCE(new.subject, ''), COALESCE(new.description, ''),
                COALESCE(REPLACE(REPLACE(REPLACE(new.tags, '[', ''), ']', ''), '"', ''), ''));
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS tasks_fts_delete AFTER DELETE ON tasks BEGIN
        DELETE FROM tasks_fts WHERE rowid = old.id;
      END
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS tasks_fts_update AFTER UPDATE ON tasks BEGIN
        INSERT OR REPLACE INTO tasks_fts(rowid, subject, description, tags)
        VALUES (new.id, COALESCE(new.subject, ''), COALESCE(new.description, ''),
                COALESCE(REPLACE(REPLACE(REPLACE(new.tags, '[', ''), ']', ''), '"', ''), ''));
      END
    `);
  }

    if (freshDatabase) db.exec("COMMIT");
    return db;
  } catch (error) {
    if (freshDatabase) {
      try { openedDb.exec("ROLLBACK"); } catch {}
    }
    openedDb.close();
    db = null;
    throw error;
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * On-box SQLite health probe for the `doctor` diagnostic. This is the ONLY place
 * outside the domain helpers that reaches for the raw handle, and it is confined
 * to the db module (never a CLI command) so the Store abstraction stays intact:
 * {@link LocalStore.health} delegates here, {@link ApiStore.health} pings the API
 * instead. Verifies the local db opens and reports WAL mode.
 */
export function localHealthChecks(): { name: string; ok: boolean; message: string }[] {
  const checks: { name: string; ok: boolean; message: string }[] = [];

  try {
    const handle = getDb();
    handle.prepare("SELECT 1").get();
    checks.push({ name: "Database", ok: true, message: `OK — ${getDbPath()}` });
  } catch (e) {
    checks.push({ name: "Database", ok: false, message: `Cannot open DB: ${(e as Error).message}` });
    return checks; // WAL check is meaningless if the db won't open
  }

  try {
    const handle = getDb();
    const mode = handle.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    const isWal = mode.journal_mode === "wal";
    checks.push({
      name: "WAL mode",
      ok: isWal,
      message: isWal ? "OK — WAL mode enabled" : `WARNING — journal_mode is ${mode.journal_mode}`,
    });
  } catch {
    checks.push({ name: "WAL mode", ok: false, message: "Could not check WAL mode" });
  }

  return checks;
}
