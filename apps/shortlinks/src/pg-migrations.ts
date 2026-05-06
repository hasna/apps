export const PG_MIGRATIONS: string[] = [
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
    synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS links (
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
  );

  CREATE TABLE IF NOT EXISTS clicks (
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

  CREATE TABLE IF NOT EXISTS _pg_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO _pg_migrations (id) VALUES (1) ON CONFLICT DO NOTHING;
  `,
];
