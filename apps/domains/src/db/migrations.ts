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
  {
    id: 2,
    name: "domain_purchase_tracking",
    sql: `
      PRAGMA foreign_keys=OFF;

      ALTER TABLE dns_records RENAME TO dns_records_old;
      ALTER TABLE alerts RENAME TO alerts_old;
      ALTER TABLE domains RENAME TO domains_old;

      CREATE TABLE domains (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        registrar TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (
          status IN (
            'discovered',
            'researching',
            'offered',
            'negotiating',
            'purchased',
            'active',
            'not_available',
            'premium_only',
            'declined',
            'expired',
            'transferring',
            'redemption'
          )
        ),
        registered_at TEXT,
        expires_at TEXT,
        auto_renew INTEGER NOT NULL DEFAULT 1,
        is_premium INTEGER NOT NULL DEFAULT 0,
        premium_price REAL,
        standard_price REAL,
        purchase_price REAL,
        purchase_date TEXT,
        nameservers TEXT NOT NULL DEFAULT '[]',
        whois TEXT NOT NULL DEFAULT '{}',
        ssl_expires_at TEXT,
        ssl_issuer TEXT,
        notes TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE dns_records (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV')),
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        ttl INTEGER NOT NULL DEFAULT 3600,
        priority INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE alerts (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('expiry', 'ssl_expiry', 'dns_change')),
        trigger_days_before INTEGER,
        sent_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO domains (
        id, name, registrar, status, registered_at, expires_at, auto_renew,
        is_premium, premium_price, standard_price, purchase_price, purchase_date,
        nameservers, whois, ssl_expires_at, ssl_issuer, notes, metadata, created_at, updated_at
      )
      SELECT
        id, name, registrar, status, registered_at, expires_at, auto_renew,
        0, NULL, NULL, NULL, NULL,
        nameservers, whois, ssl_expires_at, ssl_issuer, notes, metadata, created_at, updated_at
      FROM domains_old;

      INSERT INTO dns_records (id, domain_id, type, name, value, ttl, priority, created_at)
      SELECT id, domain_id, type, name, value, ttl, priority, created_at
      FROM dns_records_old;

      INSERT INTO alerts (id, domain_id, type, trigger_days_before, sent_at, created_at)
      SELECT id, domain_id, type, trigger_days_before, sent_at, created_at
      FROM alerts_old;

      DROP TABLE domains_old;
      DROP TABLE dns_records_old;
      DROP TABLE alerts_old;

      CREATE TABLE domain_offers (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        our_offer REAL,
        their_ask REAL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'countered')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE domain_emails (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        email_id TEXT NOT NULL,
        thread_id TEXT,
        type TEXT NOT NULL CHECK (type IN ('inquiry', 'offer', 'counter_offer', 'confirmation', 'renewal_notice', 'transfer')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_domains_name ON domains(name);
      CREATE INDEX idx_domains_registrar ON domains(registrar);
      CREATE INDEX idx_domains_status ON domains(status);
      CREATE INDEX idx_domains_expires_at ON domains(expires_at);
      CREATE INDEX idx_domains_is_premium ON domains(is_premium);
      CREATE INDEX idx_dns_records_domain ON dns_records(domain_id);
      CREATE INDEX idx_dns_records_type ON dns_records(type);
      CREATE INDEX idx_alerts_domain ON alerts(domain_id);
      CREATE INDEX idx_alerts_type ON alerts(type);
      CREATE INDEX idx_domain_offers_domain ON domain_offers(domain_id);
      CREATE INDEX idx_domain_emails_domain ON domain_emails(domain_id);
      CREATE UNIQUE INDEX idx_domain_emails_unique ON domain_emails(domain_id, email_id);

      PRAGMA foreign_keys=ON;
    `,
  },
  {
    id: 3,
    name: "domain_owner_tracking",
    sql: `
      CREATE TABLE IF NOT EXISTS domain_owners (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        contact_id TEXT,
        owner_name TEXT,
        owner_email TEXT,
        owner_phone TEXT,
        owner_organization TEXT,
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('whois', 'manual', 'brandsight', 'import')),
        verified INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      ALTER TABLE domain_offers ADD COLUMN owner_contact_id TEXT REFERENCES domain_owners(id);

      CREATE INDEX idx_domain_owners_domain ON domain_owners(domain_id);
      CREATE INDEX idx_domain_owners_contact ON domain_owners(contact_id);
      CREATE INDEX idx_domain_owners_email ON domain_owners(owner_email);
      CREATE INDEX idx_domain_offers_owner ON domain_offers(owner_contact_id);
    `,
  },
  {
    id: 4,
    name: "domain_history_tracking",
    sql: `
      CREATE TABLE IF NOT EXISTS domain_history (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('whois', 'rdap', 'dns', 'ssl', 'reputation', 'exa_research')),
        raw_data TEXT NOT NULL DEFAULT '{}',
        registrant_name TEXT,
        registrant_email TEXT,
        registrant_org TEXT,
        nameservers TEXT NOT NULL DEFAULT '[]',
        registrar TEXT,
        status TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_domain_history_domain ON domain_history(domain_id);
      CREATE INDEX idx_domain_history_type ON domain_history(snapshot_type);
      CREATE INDEX idx_domain_history_created ON domain_history(created_at);
      CREATE INDEX idx_domain_history_email ON domain_history(registrant_email);
    `,
  },
  {
    id: 5,
    name: "domain_reputation_tracking",
    sql: `
      CREATE TABLE IF NOT EXISTS domain_reputation (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        is_blacklisted INTEGER NOT NULL DEFAULT 0,
        blacklist_sources TEXT NOT NULL DEFAULT '[]',
        threat_score INTEGER,
        spam_score INTEGER,
        malware_detected INTEGER NOT NULL DEFAULT 0,
        phishing_detected INTEGER NOT NULL DEFAULT 0,
        reputation_sources TEXT NOT NULL DEFAULT '[]',
        last_checked_at TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_domain_reputation_domain ON domain_reputation(domain_id);
      CREATE INDEX idx_domain_reputation_blacklisted ON domain_reputation(is_blacklisted);
    `,
  },
];
