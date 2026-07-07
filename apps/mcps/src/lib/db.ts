import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { MCPS_DIR, DB_PATH, resolveStorageMode } from "./config.js";
import { DEFAULT_PROVIDER_PROFILE_SEEDS } from "./provider-profile-seeds.js";

export interface McpsDbAdapter {
  raw: Database;
  run(sql: string, ...params: any[]): unknown;
}

class LocalDbAdapter implements McpsDbAdapter {
  raw: Database;

  constructor(path: string) {
    this.raw = new Database(path);
    this.raw.exec("PRAGMA journal_mode = WAL");
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.raw.exec("PRAGMA busy_timeout = 5000");
  }

  run(sql: string, ...params: any[]): unknown {
    return this.raw.prepare(sql).run(...params);
  }
}

let db: Database | null = null;
let _adapter: McpsDbAdapter | null = null;

export function getDb(): Database {
  if (db) return db;

  resolveStorageMode();
  mkdirSync(MCPS_DIR, { recursive: true });

  _adapter = new LocalDbAdapter(DB_PATH);
  db = _adapter.raw;

  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      command TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '[]',
      env TEXT NOT NULL DEFAULT '{}',
      credential_refs TEXT NOT NULL DEFAULT '{}',
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
  try { db.exec("ALTER TABLE servers ADD COLUMN credential_refs TEXT NOT NULL DEFAULT '{}'"); } catch {}

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      port INTEGER NOT NULL DEFAULT 22,
      platform TEXT NOT NULL DEFAULT 'unknown',
      arch TEXT NOT NULL DEFAULT 'unknown',
      bun_path TEXT,
      npm_path TEXT,
      installer TEXT NOT NULL DEFAULT 'auto',
      ssh_key_path TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT,
      last_error TEXT
    )
  `);

  db.exec("CREATE INDEX IF NOT EXISTS idx_machines_enabled ON machines(enabled)");

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
    CREATE TABLE IF NOT EXISTS provider_profiles (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      description TEXT,
      endpoint TEXT,
      transport TEXT NOT NULL,
      fallback_endpoints TEXT NOT NULL DEFAULT '[]',
      auth_type TEXT NOT NULL,
      auth_metadata TEXT NOT NULL DEFAULT '{}',
      scopes TEXT NOT NULL DEFAULT '[]',
      token_mode TEXT NOT NULL DEFAULT 'none',
      install_fallback TEXT NOT NULL DEFAULT '{}',
      docs_url TEXT,
      safety TEXT NOT NULL DEFAULT '{}',
      provenance TEXT NOT NULL DEFAULT '{"source":"manual"}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Safe migrations for provider profile databases created before auth/fallback metadata.
  try { db.exec("ALTER TABLE provider_profiles ADD COLUMN fallback_endpoints TEXT NOT NULL DEFAULT '[]'"); } catch {}
  try { db.exec("ALTER TABLE provider_profiles ADD COLUMN auth_metadata TEXT NOT NULL DEFAULT '{}'"); } catch {}

  db.exec("CREATE INDEX IF NOT EXISTS idx_provider_profiles_enabled ON provider_profiles(enabled)");

  const insertProviderProfile = db.prepare(`
    INSERT OR IGNORE INTO provider_profiles (
      id, display_name, description, endpoint, transport, fallback_endpoints,
      auth_type, auth_metadata, scopes, token_mode, install_fallback,
      docs_url, safety, provenance, enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedProviderProfiles = db.transaction(() => {
    for (const profile of DEFAULT_PROVIDER_PROFILE_SEEDS) {
      insertProviderProfile.run(
        profile.id,
        profile.displayName,
        profile.description ?? null,
        profile.endpoint ?? null,
        profile.transport,
        JSON.stringify(profile.fallbackEndpoints ?? []),
        profile.authType,
        JSON.stringify(profile.authMetadata ?? {}),
        JSON.stringify(profile.scopes ?? []),
        profile.tokenMode ?? "none",
        JSON.stringify(profile.installFallback ?? null),
        profile.docsUrl ?? null,
        JSON.stringify(profile.safety ?? {}),
        JSON.stringify(profile.provenance),
        profile.enabled === false ? 0 : 1
      );
    }
  });
  seedProviderProfiles();

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

/** Get the local SQLite adapter for direct SQL queries (e.g. feedback). */
export function getAdapter(): McpsDbAdapter {
  if (!_adapter) {
    getDb(); // force initialization
  }
  return _adapter!;
}
