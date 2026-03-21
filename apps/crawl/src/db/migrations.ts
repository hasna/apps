import type { Database } from "bun:sqlite";

export const migrations: string[] = [
  // Migration 1 — Initial schema
  `CREATE TABLE crawls (
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
);

CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  crawl_id TEXT NOT NULL,
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
  crawled_at TEXT NOT NULL,
  FOREIGN KEY (crawl_id) REFERENCES crawls(id) ON DELETE CASCADE
);

CREATE INDEX idx_pages_crawl ON pages(crawl_id);
CREATE INDEX idx_pages_url ON pages(url);
CREATE INDEX idx_crawls_status ON crawls(status);
CREATE INDEX idx_crawls_domain ON crawls(domain);`,

  // Migration 2 — Full-text search
  `CREATE VIRTUAL TABLE pages_fts USING fts5(
  url, title, text_content,
  content=pages, content_rowid=rowid
);

CREATE TRIGGER pages_ai AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(rowid, url, title, text_content)
  VALUES (new.rowid, new.url, new.title, new.text_content);
END;

CREATE TRIGGER pages_au AFTER UPDATE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, url, title, text_content)
  VALUES ('delete', old.rowid, old.url, old.title, old.text_content);
  INSERT INTO pages_fts(rowid, url, title, text_content)
  VALUES (new.rowid, new.url, new.title, new.text_content);
END;

CREATE TRIGGER pages_ad AFTER DELETE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, url, title, text_content)
  VALUES ('delete', old.rowid, old.url, old.title, old.text_content);
END;`,

  // Migration 3 — Page version history
  `CREATE TABLE page_versions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  text_content TEXT,
  crawled_at TEXT NOT NULL,
  diff_summary TEXT,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE INDEX idx_page_versions_page ON page_versions(page_id);`,

  // Migration 4 — Webhooks
  `CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '["crawl.completed"]',
  secret TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_triggered_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  http_status INTEGER,
  response_body TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
);

CREATE INDEX idx_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX idx_deliveries_status ON webhook_deliveries(status, next_retry_at);`,

  // Migration 5 — API keys and usage tracking
  `CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT
);

CREATE TABLE usage_events (
  id TEXT PRIMARY KEY,
  api_key_id TEXT,
  event_type TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 1,
  crawl_id TEXT,
  page_id TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_usage_api_key ON usage_events(api_key_id, created_at);
CREATE INDEX idx_usage_type ON usage_events(event_type, created_at);`,
];

export function runMigrations(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    index_num INTEGER NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  )`);

  const getApplied = db.prepare<{ index_num: number }, []>(
    "SELECT index_num FROM _migrations ORDER BY index_num"
  );
  const applied = new Set(getApplied.all().map((r) => r.index_num));

  const insert = db.prepare(
    "INSERT INTO _migrations (index_num, applied_at) VALUES (?, ?)"
  );

  for (let i = 0; i < migrations.length; i++) {
    if (applied.has(i)) continue;
    db.exec(migrations[i] as string);
    insert.run(i, new Date().toISOString());
  }
}
