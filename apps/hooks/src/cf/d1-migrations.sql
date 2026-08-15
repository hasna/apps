-- D1 schema for the hooks registry worker.
-- Mirrors the SQLite migration 004_hooks_table (D1-compatible subset).

CREATE TABLE IF NOT EXISTS hooks (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  version          TEXT NOT NULL,
  sha256           TEXT NOT NULL,
  source_type      TEXT NOT NULL,
  source_ref       TEXT,
  installed_at     TEXT NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1,
  last_verified_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_hooks_name ON hooks (name);

-- Versioned artifact retention (P1-4, bug d3b4025c).
-- hook_versions holds ONE row per published (name, version) — the immutable
-- history. The hooks table above stays the LATEST pointer. Pinned installs
-- fetch the exact version from hook_versions; the latest pointer keeps
-- catalog/lock reads fast and unchanged in shape.
CREATE TABLE IF NOT EXISTS hook_versions (
  name          TEXT NOT NULL,
  version       TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  script_sha256 TEXT NOT NULL,
  artifact_key  TEXT NOT NULL,
  published_at  TEXT NOT NULL,
  PRIMARY KEY (name, version)
);

CREATE INDEX IF NOT EXISTS idx_hook_versions_name ON hook_versions (name);
