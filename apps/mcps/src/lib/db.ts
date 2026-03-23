import { Database } from "bun:sqlite";
import { SqliteAdapter } from "@hasna/cloud";
import { mkdirSync } from "fs";
import { MCPS_DIR, DB_PATH } from "./config.js";

let db: Database | null = null;
let _adapter: SqliteAdapter | null = null;

export function getDb(): Database {
  if (db) return db;

  mkdirSync(MCPS_DIR, { recursive: true });

  _adapter = new SqliteAdapter(DB_PATH);
  db = _adapter.raw;
  // SqliteAdapter already sets WAL and foreign_keys; add busy_timeout
  db.exec("PRAGMA busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      command TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '[]',
      env TEXT NOT NULL DEFAULT '{}',
      transport TEXT NOT NULL DEFAULT 'stdio',
      url TEXT,
      source TEXT NOT NULL DEFAULT 'local',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_cache (
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      input_schema TEXT NOT NULL DEFAULT '{}',
      cached_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (server_id, name),
      FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
    )
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_tool_cache_server ON tool_cache(server_id)");

  // Add health columns if they don't exist (safe migration)
  try { db.exec("ALTER TABLE servers ADD COLUMN last_connected_at TEXT"); } catch {}
  try { db.exec("ALTER TABLE servers ADD COLUMN last_error TEXT"); } catch {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Seed default sources if table is empty
  const count = (db.query("SELECT COUNT(*) as c FROM sources").get() as { c: number }).c;
  if (count === 0) {
    db.exec(`
      INSERT OR IGNORE INTO sources (id, name, type, url, description) VALUES
        ('official-registry', 'Official MCP Registry', 'mcp-registry', 'https://registry.modelcontextprotocol.io/v0/servers', 'The official Model Context Protocol server registry'),
        ('awesome-mcp-servers', 'Awesome MCP Servers', 'awesome-list', 'https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md', 'Curated list of MCP servers by punkpeye'),
        ('npm-mcp', 'npm MCP Packages', 'npm-search', 'https://registry.npmjs.org/-/v1/search', 'Search npm packages for MCP servers'),
        ('github-mcp-topic', 'GitHub MCP Topic', 'github-topic', 'https://api.github.com/search/repositories', 'GitHub repositories tagged with mcp-server topic')
    `);
  }

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

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    _adapter = null;
  }
}

/** Get the SqliteAdapter for direct SQL queries (e.g. feedback). */
export function getAdapter(): SqliteAdapter {
  if (!_adapter) {
    getDb(); // force initialization
  }
  return _adapter!;
}
