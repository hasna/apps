import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getDatabasePath } from "./config.js";

export function now(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex}`;
}

export const SQLITE_MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    hostname TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL DEFAULT 'manual',
    default_domain INTEGER NOT NULL DEFAULT 0,
    cloudflare_zone_id TEXT,
    cloudflare_account_id TEXT,
    cloudflare_worker_name TEXT,
    origin_url TEXT,
    notes TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    machine_id TEXT,
    synced_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    destination_url TEXT NOT NULL,
    title TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    expires_at TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    machine_id TEXT,
    synced_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(domain_id, slug)
  );

  CREATE TABLE IF NOT EXISTS clicks (
    id TEXT PRIMARY KEY,
    link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    clicked_at TEXT NOT NULL,
    ip_hash TEXT,
    user_agent TEXT,
    referer TEXT,
    country TEXT,
    city TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    machine_id TEXT,
    synced_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_domains_hostname ON domains(hostname);
  CREATE INDEX IF NOT EXISTS idx_domains_default ON domains(default_domain);
  CREATE INDEX IF NOT EXISTS idx_links_domain_slug ON links(domain_id, slug);
  CREATE INDEX IF NOT EXISTS idx_links_active ON links(active);
  CREATE INDEX IF NOT EXISTS idx_links_updated ON links(updated_at);
  CREATE INDEX IF NOT EXISTS idx_clicks_link ON clicks(link_id);
  CREATE INDEX IF NOT EXISTS idx_clicks_domain ON clicks(domain_id);
  CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at);
  CREATE INDEX IF NOT EXISTS idx_clicks_updated ON clicks(updated_at);
  `,
];

export class ShortlinksDatabase {
  readonly db: Database;
  readonly path: string;

  constructor(path?: string) {
    this.path = getDatabasePath(path);
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new Database(this.path);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.applyMigrations();
  }

  close(): void {
    this.db.close();
  }

  private applyMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    for (let i = 0; i < SQLITE_MIGRATIONS.length; i += 1) {
      const id = i + 1;
      const applied = this.db.query("SELECT id FROM _migrations WHERE id = ?").get(id);
      if (applied) continue;
      const migration = SQLITE_MIGRATIONS[i]!;
      const apply = this.db.transaction(() => {
        this.db.exec(migration);
        this.db.query("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(id, now());
      });
      apply();
    }
  }
}
