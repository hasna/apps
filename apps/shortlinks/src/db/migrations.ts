/**
 * Cloud Postgres migrations for the shortlinks serve service.
 *
 * PURE REMOTE (Amendment A1): these run against the shared RDS Postgres via the
 * vendored storage kit's MigrationLedger. The service reads and writes the same
 * cloud database — there is no local mirror, cache, or sync engine here.
 *
 * The domains/links/clicks schema uses SQLite-parity TEXT/INTEGER shapes so the
 * existing SaaS-remnant tables are matched exactly
 * (every statement is `IF NOT EXISTS` — applying the ledger never clobbers data).
 * The api_keys table migrations come from @hasna/contracts/auth so the API-key
 * middleware and the `contracts issue-key` issuer share one schema.
 */

import { apiKeyMigrations } from "@hasna/contracts/auth";
import { defineMigration, type Migration } from "../generated/storage-kit/migrations.js";

const CORE_MIGRATIONS: Migration[] = [
  defineMigration(
    "shortlinks_0001_domains",
    `CREATE TABLE IF NOT EXISTS domains (
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
       synced_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL
     )`,
  ),
  defineMigration(
    "shortlinks_0002_links",
    `CREATE TABLE IF NOT EXISTS links (
       id TEXT PRIMARY KEY,
       domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
       slug TEXT NOT NULL,
       destination_url TEXT NOT NULL,
       title TEXT,
       active INTEGER NOT NULL DEFAULT 1,
       expires_at TIMESTAMPTZ,
       metadata TEXT NOT NULL DEFAULT '{}',
       machine_id TEXT,
       synced_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL,
       UNIQUE(domain_id, slug)
     )`,
  ),
  defineMigration(
    "shortlinks_0003_clicks",
    `CREATE TABLE IF NOT EXISTS clicks (
       id TEXT PRIMARY KEY,
       link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
       domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
       slug TEXT NOT NULL,
       clicked_at TIMESTAMPTZ NOT NULL,
       ip_hash TEXT,
       user_agent TEXT,
       referer TEXT,
       country TEXT,
       city TEXT,
       metadata TEXT NOT NULL DEFAULT '{}',
       machine_id TEXT,
       synced_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL,
       updated_at TIMESTAMPTZ NOT NULL
     )`,
  ),
  defineMigration(
    "shortlinks_0004_indexes",
    `CREATE INDEX IF NOT EXISTS idx_domains_hostname ON domains(hostname);
     CREATE INDEX IF NOT EXISTS idx_domains_default ON domains(default_domain);
     CREATE INDEX IF NOT EXISTS idx_links_domain_slug ON links(domain_id, slug);
     CREATE INDEX IF NOT EXISTS idx_links_active ON links(active);
     CREATE INDEX IF NOT EXISTS idx_links_updated ON links(updated_at);
     CREATE INDEX IF NOT EXISTS idx_clicks_link ON clicks(link_id);
     CREATE INDEX IF NOT EXISTS idx_clicks_domain ON clicks(domain_id);
     CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at);
     CREATE INDEX IF NOT EXISTS idx_clicks_updated ON clicks(updated_at)`,
  ),
];

/**
 * Ordered migrations for the shortlinks cloud schema, including the shared
 * api_keys table from @hasna/contracts. Feed straight into the kit's
 * MigrationLedger.
 */
export const SHORTLINKS_MIGRATIONS: readonly Migration[] = [
  ...CORE_MIGRATIONS,
  ...apiKeyMigrations().map((m) => defineMigration(m.id, m.sql)),
];
