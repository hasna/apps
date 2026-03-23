/**
 * PostgreSQL migrations for open-security cloud sync.
 *
 * Equivalent of the SQLite migrations in database.ts, translated for PostgreSQL.
 * Each element is a standalone SQL string that must be executed in order.
 */
export const PG_MIGRATIONS: string[] = [
  // Migration 1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    scanner_types TEXT NOT NULL DEFAULT '[]',
    findings_count INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_scans_project ON scans(project_id);
  CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);

  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scanner_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    pattern TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    builtin INTEGER NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_rules_scanner ON rules(scanner_type);
  CREATE INDEX IF NOT EXISTS idx_rules_severity ON rules(severity);

  CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    rule_id TEXT NOT NULL,
    scanner_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    file TEXT NOT NULL,
    line INTEGER NOT NULL,
    "column" INTEGER,
    end_line INTEGER,
    message TEXT NOT NULL,
    code_snippet TEXT,
    fingerprint TEXT NOT NULL,
    suppressed INTEGER NOT NULL DEFAULT 0,
    suppressed_reason TEXT,
    llm_explanation TEXT,
    llm_fix TEXT,
    llm_exploitability DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_findings_scan ON findings(scan_id);
  CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
  CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_findings_file ON findings(file);

  CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    block_on_severity TEXT,
    auto_fix INTEGER NOT NULL DEFAULT 0,
    notify INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS baselines (
    id TEXT PRIMARY KEY,
    finding_fingerprint TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_baselines_fingerprint ON baselines(finding_fingerprint);

  CREATE TABLE IF NOT EXISTS llm_cache (
    id TEXT PRIMARY KEY,
    finding_fingerprint TEXT NOT NULL,
    analysis_type TEXT NOT NULL,
    result TEXT NOT NULL,
    model TEXT NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_llm_cache_fingerprint ON llm_cache(finding_fingerprint);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_cache_lookup ON llm_cache(finding_fingerprint, analysis_type);

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO _migrations (id) VALUES (1) ON CONFLICT DO NOTHING;
  `,
  // Migration 2: Feedback table
  `
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO _migrations (id) VALUES (2) ON CONFLICT DO NOTHING;
  `,
];
