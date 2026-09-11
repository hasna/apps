// Hasna Notes server — PostgreSQL schema (personalnotes/v1 dialect).
//
// Translation of the SQLite schema in server/db.mjs for the PostgreSQL
// backend, selected by HASNA_NOTES_DATABASE_URL. Deliberate differences from
// the SQLite schema, each stated so nobody re-introduces the old shape:
//
//   - sync_batches is DROPPED in the new backend. Multi-machine sync is being
//     removed fleet-wide (owner directive 2026-08-17); the table exists in
//     SQLite only until the sync-removal lane lands. note_events is kept.
//   - api_keys comes from @hasna/contracts/auth (apiKeyMigrations) — the
//     canonical ApiKeyStore table (kid/token_hash/app/scopes/tid), backed by
//     the signing secret HASNA_NOTES_API_SIGNING_KEY with the documented
//     fallbacks (API_KEY_SIGNING_SECRET, HASNA_API_SIGNING_KEY). The SQLite
//     backend keeps its own pn_ api_keys table until it too converges.
//   - Timestamp columns are TEXT, exactly like SQLite, so the dialect's
//     ISO-string comparisons (e.g. expires_at < nowIso()) behave identically
//     on both backends. The ledger's own applied_at stays TIMESTAMPTZ.
//   - Flag and counter columns stay INTEGER (pinned/archived/is_active/
//     is_platform_admin/revision/seq) so values round-trip as numbers.
//   - JSON-shaped payload columns stay TEXT (frontmatter_json, labels,
//     metadata, agent_provenance_json) because the server serializes and
//     parses them itself; only the contracts api_keys.scopes is JSONB.
//
// Migrations are applied through the vendored storage kit's MigrationLedger
// (sha256 checksum ledger, drift and downgrade guards) — see
// scripts/apply-postgres-migrations.mjs.

import { apiKeyMigrations } from '@hasna/contracts/auth';
import { defineMigration } from '../src/generated/storage-kit/index.js';

export const NOTES_PG_EXTENSION_MIGRATIONS = [
  defineMigration('notes_pg_000_extensions', 'CREATE EXTENSION IF NOT EXISTS pgcrypto'),
];

export const NOTES_PG_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS tenants (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     slug TEXT NOT NULL,
     plan TEXT NOT NULL DEFAULT 'self-hosted',
     created_at TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     tenant_id TEXT NOT NULL,
     email TEXT NOT NULL,
     name TEXT,
     role TEXT NOT NULL DEFAULT 'owner',
     is_active INTEGER NOT NULL DEFAULT 1,
     is_platform_admin INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));`,

  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     tenant_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     revoked_at TEXT,
     created_at TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS otp_login_requests (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL,
     code_hash TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     expires_at TEXT NOT NULL,
     consumed_at TEXT,
     created_at TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS device_auth_requests (
     id TEXT PRIMARY KEY,
     device_code_hash TEXT NOT NULL UNIQUE,
     user_code TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     tenant_id TEXT,
     user_id TEXT,
     exchange_token_hash TEXT,
     api_key_id TEXT,
     approved_at TEXT,
     consumed_at TEXT,
     expires_at TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS notes (
     id TEXT PRIMARY KEY,
     tenant_id TEXT NOT NULL,
     client_id TEXT,
     slug TEXT,
     title TEXT NOT NULL DEFAULT 'Untitled',
     body_markdown TEXT NOT NULL DEFAULT '',
     frontmatter_json TEXT NOT NULL DEFAULT '{}',
     folder TEXT,
     labels TEXT NOT NULL DEFAULT '[]',
     pinned INTEGER NOT NULL DEFAULT 0,
     archived INTEGER NOT NULL DEFAULT 0,
     revision INTEGER NOT NULL DEFAULT 1,
     seq INTEGER NOT NULL,
     content_hash TEXT NOT NULL,
     source TEXT NOT NULL DEFAULT 'local',
     agent_provenance_json TEXT NOT NULL DEFAULT '{}',
     deleted_at TEXT,
     purged_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS notes_tenant_client_id_uq
     ON notes (tenant_id, client_id) WHERE client_id IS NOT NULL;
   CREATE INDEX IF NOT EXISTS notes_tenant_seq_idx ON notes (tenant_id, seq);
   CREATE INDEX IF NOT EXISTS notes_tenant_updated_idx ON notes (tenant_id, updated_at);`,

  `CREATE TABLE IF NOT EXISTS note_events (
     id TEXT PRIMARY KEY,
     tenant_id TEXT NOT NULL,
     note_id TEXT,
     actor_type TEXT NOT NULL,
     actor_id TEXT NOT NULL,
     action TEXT NOT NULL,
     metadata TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS seq_counters (
     tenant_id TEXT PRIMARY KEY,
     value INTEGER NOT NULL DEFAULT 0
   )`,

  // Appended (the ledger checksums every earlier entry, so the otp table above
  // is never edited in place). Failed verification attempts are counted per
  // login REQUEST — its nonce — and burn that request at OTP_MAX_FAILED_ATTEMPTS
  // (server/auth.mjs), never anything keyed on the address (#1770 review).
  // The SQLite schema in server/db.mjs carries the column inline.
  `ALTER TABLE otp_login_requests ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0`,
];

/**
 * Full migration list for the notes PostgreSQL backend: extensions, the
 * translated dialect schema, then the contracts api-keys ledger (additive,
 * ids namespaced hasna_auth_* so they never clash with notes_pg_*).
 */
export function notesPgMigrations() {
  return [
    ...NOTES_PG_EXTENSION_MIGRATIONS,
    ...NOTES_PG_MIGRATIONS.map((sql, index) =>
      defineMigration(`notes_pg_${String(index + 1).padStart(3, '0')}`, sql),
    ),
    ...apiKeyMigrations().map((m) => defineMigration(m.id, m.sql)),
  ];
}
