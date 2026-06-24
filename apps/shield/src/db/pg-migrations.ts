/**
 * PostgreSQL migrations for open-security remote storage sync.
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
  // Migration 3: Supply-chain intelligence
  `
  CREATE TABLE IF NOT EXISTS advisories (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    package_name TEXT NOT NULL,
    ecosystem TEXT NOT NULL,
    affected_versions TEXT NOT NULL DEFAULT '[]',
    safe_versions TEXT NOT NULL DEFAULT '[]',
    attack_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'critical',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    cve_id TEXT,
    threat_actor TEXT,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    tweet_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_advisories_package ON advisories(package_name, ecosystem);
  CREATE INDEX IF NOT EXISTS idx_advisories_severity ON advisories(severity);
  CREATE INDEX IF NOT EXISTS idx_advisories_attack_type ON advisories(attack_type);
  CREATE INDEX IF NOT EXISTS idx_advisories_detected ON advisories(detected_at);

  CREATE TABLE IF NOT EXISTS advisory_iocs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    advisory_id TEXT NOT NULL REFERENCES advisories(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    context TEXT,
    platform TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_advisory_iocs_advisory ON advisory_iocs(advisory_id);
  CREATE INDEX IF NOT EXISTS idx_advisory_iocs_type ON advisory_iocs(type);
  CREATE INDEX IF NOT EXISTS idx_advisory_iocs_value ON advisory_iocs(value);

  CREATE TABLE IF NOT EXISTS monitored_packages (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    ecosystem TEXT NOT NULL,
    last_checked_at TIMESTAMPTZ,
    check_interval_ms INTEGER NOT NULL DEFAULT 300000,
    status TEXT NOT NULL DEFAULT 'active',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_monitored_packages_name ON monitored_packages(name, ecosystem);

  CREATE TABLE IF NOT EXISTS registry_events (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    package_name TEXT NOT NULL,
    version TEXT NOT NULL,
    ecosystem TEXT NOT NULL,
    event_type TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    suspicious INTEGER NOT NULL DEFAULT 0,
    analysis TEXT,
    advisory_id TEXT REFERENCES advisories(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_registry_events_package ON registry_events(package_name, ecosystem);
  CREATE INDEX IF NOT EXISTS idx_registry_events_suspicious ON registry_events(suspicious);
  CREATE INDEX IF NOT EXISTS idx_registry_events_advisory ON registry_events(advisory_id);

  INSERT INTO _migrations (id) VALUES (3) ON CONFLICT DO NOTHING;
  `,
];
