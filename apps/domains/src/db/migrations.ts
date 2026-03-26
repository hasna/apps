export interface MigrationEntry {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: MigrationEntry[] = [
  {
    id: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS domains (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        registrar TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'transferring', 'redemption')),
        registered_at TEXT,
        expires_at TEXT,
        auto_renew INTEGER NOT NULL DEFAULT 1,
        nameservers TEXT NOT NULL DEFAULT '[]',
        whois TEXT NOT NULL DEFAULT '{}',
        ssl_expires_at TEXT,
        ssl_issuer TEXT,
        notes TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS dns_records (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV')),
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        ttl INTEGER NOT NULL DEFAULT 3600,
        priority INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('expiry', 'ssl_expiry', 'dns_change')),
        trigger_days_before INTEGER,
        sent_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_domains_name ON domains(name);
      CREATE INDEX IF NOT EXISTS idx_domains_registrar ON domains(registrar);
      CREATE INDEX IF NOT EXISTS idx_domains_status ON domains(status);
      CREATE INDEX IF NOT EXISTS idx_domains_expires_at ON domains(expires_at);
      CREATE INDEX IF NOT EXISTS idx_dns_records_domain ON dns_records(domain_id);
      CREATE INDEX IF NOT EXISTS idx_dns_records_type ON dns_records(type);
      CREATE INDEX IF NOT EXISTS idx_alerts_domain ON alerts(domain_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);
    `,
  },
];
