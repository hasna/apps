import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const LOCK_EXPIRY_MINUTES = 30;

function isInMemoryDb(path: string): boolean {
  return path === ":memory:" || path.startsWith("file::memory:");
}

function findNearestTicketsDb(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".tickets", "tickets.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function getDbPath(): string {
  if (process.env["TICKETS_DB_PATH"]) {
    return process.env["TICKETS_DB_PATH"];
  }
  const cwd = process.cwd();
  const nearest = findNearestTicketsDb(cwd);
  if (nearest) return nearest;
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  return join(home, ".tickets", "tickets.db");
}

function ensureDir(filePath: string): void {
  if (isInMemoryDb(filePath)) return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

const MIGRATIONS = [
  // Migration 1: Core schema
  `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'human' CHECK(type IN ('human', 'ai_agent')),
    email TEXT,
    api_key_hash TEXT,
    permissions TEXT NOT NULL DEFAULT '["read","write"]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
  CREATE INDEX IF NOT EXISTS idx_agents_email ON agents(email);

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    ticket_prefix TEXT NOT NULL,
    ticket_counter INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    icon TEXT,
    is_public INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workspace_id, slug)
  );
  CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);

  CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6b7280',
    description TEXT,
    UNIQUE(project_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_labels_project ON labels(project_id);

  CREATE TABLE IF NOT EXISTS milestones (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);

  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    short_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'bug' CHECK(type IN ('bug', 'feature', 'question', 'incident', 'improvement', 'task')),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'in_review', 'resolved', 'closed')),
    resolution TEXT CHECK(resolution IS NULL OR resolution IN ('fixed', 'wont_fix', 'duplicate', 'invalid', 'by_design')),
    priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('none', 'low', 'medium', 'high', 'critical')),
    severity TEXT CHECK(severity IS NULL OR severity IN ('minor', 'moderate', 'major', 'critical', 'blocker')),
    reporter_id TEXT,
    assignee_id TEXT,
    milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
    labels TEXT NOT NULL DEFAULT '[]',
    custom_fields TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL DEFAULT 'api' CHECK(source IN ('web', 'api', 'mcp', 'cli', 'email', 'webhook')),
    external_id TEXT,
    external_url TEXT,
    is_ai_opened INTEGER NOT NULL DEFAULT 0,
    ai_confidence REAL,
    ai_reasoning TEXT,
    due_date TEXT,
    sla_minutes INTEGER,
    sla_breached INTEGER NOT NULL DEFAULT 0,
    duplicate_of TEXT REFERENCES tickets(id) ON DELETE SET NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    closed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_workspace ON tickets(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
  CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
  CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_reporter ON tickets(reporter_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_milestone ON tickets(milestone_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_source ON tickets(source);
  CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
  CREATE INDEX IF NOT EXISTS idx_tickets_sla ON tickets(sla_breached, sla_minutes);

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    is_internal INTEGER NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'comment' CHECK(type IN ('comment', 'status_change', 'assignment', 'ai_suggestion')),
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_comments_ticket ON comments(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);

  CREATE TABLE IF NOT EXISTS ticket_relations (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    related_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK(relation_type IN ('blocks', 'blocked_by', 'duplicates', 'relates_to', 'caused_by')),
    created_by TEXT REFERENCES agents(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK(ticket_id != related_ticket_id),
    UNIQUE(ticket_id, related_ticket_id, relation_type)
  );
  CREATE INDEX IF NOT EXISTS idx_relations_ticket ON ticket_relations(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_relations_related ON ticket_relations(related_ticket_id);

  CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    from_value TEXT,
    to_value TEXT,
    is_ai_action INTEGER NOT NULL DEFAULT 0,
    ai_confidence REAL,
    ai_reasoning TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_activity_ticket ON activity(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity(agent_id);
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    last_triggered_at TEXT,
    failure_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_webhooks_workspace ON webhooks(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_webhooks_project ON webhooks(project_id);

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '["read","write"]',
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_api_keys_agent ON api_keys(agent_id);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    last_activity TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);

  CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    domain TEXT NOT NULL UNIQUE,
    verified INTEGER NOT NULL DEFAULT 0,
    verified_at TEXT,
    tls_cert TEXT,
    tls_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain);
  CREATE INDEX IF NOT EXISTS idx_domains_project ON domains(project_id);

  CREATE TABLE IF NOT EXISTS email_config (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'console' CHECK(provider IN ('ses', 'resend', 'smtp', 'console')),
    config_json TEXT NOT NULL DEFAULT '{}',
    from_email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_queue (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    to_addresses TEXT NOT NULL,
    from_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    html TEXT,
    text TEXT,
    headers TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    send_at TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status);
  CREATE INDEX IF NOT EXISTS idx_email_queue_send_at ON email_queue(send_at);

  CREATE VIRTUAL TABLE IF NOT EXISTS tickets_fts USING fts5(
    ticket_id UNINDEXED,
    title,
    description,
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER IF NOT EXISTS tickets_fts_ai AFTER INSERT ON tickets BEGIN
    INSERT INTO tickets_fts(rowid, ticket_id, title, description)
    VALUES (new.rowid, new.id, new.title, COALESCE(new.description, ''));
  END;

  CREATE TRIGGER IF NOT EXISTS tickets_fts_ad AFTER DELETE ON tickets BEGIN
    DELETE FROM tickets_fts WHERE rowid = old.rowid;
  END;

  CREATE TRIGGER IF NOT EXISTS tickets_fts_au AFTER UPDATE OF title, description ON tickets BEGIN
    DELETE FROM tickets_fts WHERE rowid = old.rowid;
    INSERT INTO tickets_fts(rowid, ticket_id, title, description)
    VALUES (new.rowid, new.id, new.title, COALESCE(new.description, ''));
  END;

  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO _migrations (id) VALUES (1);
  `,
];

let _db: Database | null = null;

export function getDatabase(dbPath?: string): Database {
  if (_db) return _db;

  const path = dbPath || getDbPath();
  ensureDir(path);

  _db = new Database(path, { create: true });

  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA busy_timeout = 5000");
  _db.run("PRAGMA foreign_keys = ON");

  runMigrations(_db);

  return _db;
}

function runMigrations(db: Database): void {
  try {
    const result = db.query("SELECT MAX(id) as max_id FROM _migrations").get() as { max_id: number | null } | null;
    const currentLevel = result?.max_id ?? 0;
    for (let i = currentLevel; i < MIGRATIONS.length; i++) {
      try { db.exec(MIGRATIONS[i]!); } catch { /* partial failure — ensureSchema fills gaps */ }
    }
  } catch {
    for (const migration of MIGRATIONS) {
      try { db.exec(migration); } catch {}
    }
  }
}

export function closeDatabase(): void {
  if (_db) { _db.close(); _db = null; }
}

export function resetDatabase(): void {
  _db = null;
}

export function now(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function resolveTicketId(db: Database, idOrShortId: string): string | null {
  // Full UUID
  if (idOrShortId.length === 36) {
    const row = db.query("SELECT id FROM tickets WHERE id = ?").get(idOrShortId) as { id: string } | null;
    return row?.id ?? null;
  }
  // Short ID (e.g. API-0042) — case-insensitive
  const shortRow = db.query("SELECT id FROM tickets WHERE upper(short_id) = upper(?)").get(idOrShortId) as { id: string } | null;
  if (shortRow) return shortRow.id;
  // UUID prefix match
  const rows = db.query("SELECT id FROM tickets WHERE id LIKE ?").all(`${idOrShortId}%`) as { id: string }[];
  if (rows.length === 1) return rows[0]!.id;
  return null;
}
