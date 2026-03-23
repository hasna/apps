/**
 * PostgreSQL migrations for open-crawl cloud sync.
 *
 * Equivalent to the SQLite schema in migrations.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: crawls table
  `CREATE TABLE IF NOT EXISTS crawls (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    domain TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    depth INTEGER NOT NULL DEFAULT 1,
    max_pages INTEGER DEFAULT 100,
    pages_crawled INTEGER DEFAULT 0,
    options TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    error_message TEXT
  )`,

  // Migration 2: pages table
  `CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    status_code INTEGER,
    content_type TEXT,
    title TEXT,
    description TEXT,
    text_content TEXT,
    markdown_content TEXT,
    html_content TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    screenshot_path TEXT,
    word_count INTEGER,
    byte_size INTEGER,
    crawled_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_pages_crawl ON pages(crawl_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url)`,
  `CREATE INDEX IF NOT EXISTS idx_crawls_status ON crawls(status)`,
  `CREATE INDEX IF NOT EXISTS idx_crawls_domain ON crawls(domain)`,

  // Migration 3: page_versions table
  `CREATE TABLE IF NOT EXISTS page_versions (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    text_content TEXT,
    crawled_at TEXT NOT NULL,
    diff_summary TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_page_versions_page ON page_versions(page_id)`,

  // Migration 4: webhooks table
  `CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '["crawl.completed"]',
    secret TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL,
    last_triggered_at TEXT,
    failure_count INTEGER NOT NULL DEFAULT 0
  )`,

  // Migration 5: webhook_deliveries table
  `CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    http_status INTEGER,
    response_body TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    created_at TEXT NOT NULL,
    delivered_at TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_deliveries_webhook ON webhook_deliveries(webhook_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deliveries_status ON webhook_deliveries(status, next_retry_at)`,

  // Migration 6: api_keys table
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    name TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    expires_at TEXT
  )`,

  // Migration 7: usage_events table
  `CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY,
    api_key_id TEXT,
    event_type TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 1,
    crawl_id TEXT,
    page_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_usage_api_key ON usage_events(api_key_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_usage_type ON usage_events(event_type, created_at)`,

  // Migration 8: feedback table
  `CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
];
