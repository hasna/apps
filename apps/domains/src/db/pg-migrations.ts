/**
 * PostgreSQL migrations for open-domains remote storage sync.
 */

export const PG_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    registrar TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('discovered', 'researching', 'offered', 'negotiating', 'purchased', 'active', 'not_available', 'premium_only', 'declined', 'expired', 'transferring', 'redemption')),
    registered_at TEXT,
    expires_at TEXT,
    auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
    is_premium BOOLEAN NOT NULL DEFAULT FALSE,
    premium_price DOUBLE PRECISION,
    standard_price DOUBLE PRECISION,
    purchase_price DOUBLE PRECISION,
    purchase_date TEXT,
    nameservers TEXT NOT NULL DEFAULT '[]',
    whois TEXT NOT NULL DEFAULT '{}',
    ssl_expires_at TEXT,
    ssl_issuer TEXT,
    notes TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS dns_records (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV')),
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    ttl INTEGER NOT NULL DEFAULT 3600,
    priority INTEGER,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('expiry', 'ssl_expiry', 'dns_change')),
    trigger_days_before INTEGER,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS domain_offers (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    our_offer DOUBLE PRECISION,
    their_ask DOUBLE PRECISION,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'countered')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    owner_contact_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS domain_emails (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    email_id TEXT NOT NULL,
    thread_id TEXT,
    type TEXT NOT NULL CHECK (type IN ('inquiry', 'offer', 'counter_offer', 'confirmation', 'renewal_notice', 'transfer')),
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(domain_id, email_id)
  )`,
  `CREATE TABLE IF NOT EXISTS domain_owners (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    contact_id TEXT,
    owner_name TEXT,
    owner_email TEXT,
    owner_phone TEXT,
    owner_organization TEXT,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('whois', 'manual', 'brandsight', 'import')),
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS domain_history (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('whois', 'rdap', 'dns', 'ssl', 'reputation', 'exa_research', 'purchase', 'renewal')),
    raw_data TEXT NOT NULL DEFAULT '{}',
    registrant_name TEXT,
    registrant_email TEXT,
    registrant_org TEXT,
    nameservers TEXT NOT NULL DEFAULT '[]',
    registrar TEXT,
    status TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE TABLE IF NOT EXISTS domain_reputation (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    is_blacklisted BOOLEAN NOT NULL DEFAULT FALSE,
    blacklist_sources TEXT NOT NULL DEFAULT '[]',
    threat_score INTEGER,
    spam_score INTEGER,
    malware_detected BOOLEAN NOT NULL DEFAULT FALSE,
    phishing_detected BOOLEAN NOT NULL DEFAULT FALSE,
    reputation_sources TEXT NOT NULL DEFAULT '[]',
    last_checked_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_domains_name ON domains(name)`,
  `CREATE INDEX IF NOT EXISTS idx_domains_registrar ON domains(registrar)`,
  `CREATE INDEX IF NOT EXISTS idx_domains_status ON domains(status)`,
  `CREATE INDEX IF NOT EXISTS idx_domains_expires_at ON domains(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_domains_is_premium ON domains(is_premium)`,
  `CREATE INDEX IF NOT EXISTS idx_dns_records_domain ON dns_records(domain_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dns_records_type ON dns_records(type)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_domain ON alerts(domain_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_offers_domain ON domain_offers(domain_id)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_offers_owner ON domain_offers(owner_contact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_emails_domain ON domain_emails(domain_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_emails_unique ON domain_emails(domain_id, email_id)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_owners_domain ON domain_owners(domain_id)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_owners_contact ON domain_owners(contact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_owners_email ON domain_owners(owner_email)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_history_domain ON domain_history(domain_id)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_history_type ON domain_history(snapshot_type)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_history_created ON domain_history(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_history_email ON domain_history(registrant_email)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_reputation_domain ON domain_reputation(domain_id)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_reputation_blacklisted ON domain_reputation(is_blacklisted)`,
  `ALTER TABLE domains ADD COLUMN IF NOT EXISTS expiry_synced_at TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_domains_expiry_synced_at ON domains(expiry_synced_at)`,
  `CREATE TABLE IF NOT EXISTS domain_provisioning_jobs (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    domain_name TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('requested','quoted','registration_submitting','registration_submitted','registered','zone_ready','nameservers_submitted','delegated','worker_bound','ready','manual_review','failed')),
    max_price_usd DOUBLE PRECISION NOT NULL CHECK (max_price_usd > 0),
    years INTEGER NOT NULL CHECK (years BETWEEN 1 AND 10),
    auto_renew BOOLEAN NOT NULL,
    registrar TEXT NOT NULL CHECK (registrar = 'route53'),
    dns_provider TEXT NOT NULL CHECK (dns_provider = 'cloudflare'),
    target TEXT NOT NULL CHECK (target = 'shortlinks'),
    worker_name TEXT NOT NULL,
    provider_state TEXT NOT NULL DEFAULT '{}',
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    lease_token TEXT,
    lease_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_domain_provisioning_status ON domain_provisioning_jobs(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_domain_provisioning_lease ON domain_provisioning_jobs(lease_until)`,
  `ALTER TABLE domain_provisioning_jobs
    DROP CONSTRAINT IF EXISTS domain_provisioning_jobs_target_check,
    DROP CONSTRAINT IF EXISTS domain_provisioning_jobs_target_shape_check,
    ALTER COLUMN worker_name DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS origin_hostname TEXT,
    ADD CONSTRAINT domain_provisioning_jobs_target_check
      CHECK (target IN ('shortlinks', 'website_origin')),
    ADD CONSTRAINT domain_provisioning_jobs_target_shape_check
      CHECK (
        (target = 'shortlinks' AND worker_name IS NOT NULL AND origin_hostname IS NULL)
        OR
        (target = 'website_origin' AND worker_name IS NULL AND origin_hostname IS NOT NULL)
      )`,
  `CREATE TABLE IF NOT EXISTS domain_dns_reconciliations (
    id TEXT PRIMARY KEY,
    provisioning_job_id TEXT NOT NULL REFERENCES domain_provisioning_jobs(id) ON DELETE CASCADE,
    domain_name TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('requested','applying','ready','manual_review')),
    records TEXT NOT NULL,
    result TEXT,
    error TEXT,
    lease_token TEXT,
    lease_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_domain_dns_reconciliation_job
    ON domain_dns_reconciliations(provisioning_job_id, updated_at)`,
  `ALTER TABLE domain_provisioning_jobs
    DROP CONSTRAINT IF EXISTS domain_provisioning_jobs_max_price_usd_check,
    ADD COLUMN IF NOT EXISTS acquisition_mode TEXT NOT NULL DEFAULT 'purchase',
    ADD CONSTRAINT domain_provisioning_jobs_acquisition_mode_check
      CHECK (acquisition_mode IN ('purchase', 'adopt')),
    ADD CONSTRAINT domain_provisioning_jobs_price_mode_check
      CHECK (
        (acquisition_mode = 'purchase' AND max_price_usd > 0)
        OR (acquisition_mode = 'adopt' AND max_price_usd = 0)
      )`,
];
