import type { Database } from "bun:sqlite";

interface Migration {
  version: number;
  description: string;
  up: (db: Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: "Core tables",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS searches (
          id TEXT PRIMARY KEY,
          query TEXT NOT NULL,
          providers TEXT NOT NULL DEFAULT '[]',
          profile_id TEXT,
          result_count INTEGER NOT NULL DEFAULT 0,
          duration INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_searches_query ON searches(query);
        CREATE INDEX IF NOT EXISTS idx_searches_created ON searches(created_at);

        CREATE TABLE IF NOT EXISTS search_results (
          id TEXT PRIMARY KEY,
          search_id TEXT NOT NULL,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          snippet TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL,
          provider TEXT NOT NULL,
          rank INTEGER NOT NULL,
          score REAL,
          published_at TEXT,
          thumbnail TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (search_id) REFERENCES searches(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_results_search ON search_results(search_id);
        CREATE INDEX IF NOT EXISTS idx_results_url ON search_results(url);
        CREATE INDEX IF NOT EXISTS idx_results_source ON search_results(source);

        CREATE TABLE IF NOT EXISTS saved_searches (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          query TEXT NOT NULL,
          providers TEXT NOT NULL DEFAULT '[]',
          profile_id TEXT,
          options TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_run_at TEXT
        );

        CREATE TABLE IF NOT EXISTS providers (
          name TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 1,
          api_key_env TEXT NOT NULL,
          rate_limit INTEGER NOT NULL DEFAULT 60,
          last_used_at TEXT,
          metadata TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS search_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          providers TEXT NOT NULL DEFAULT '[]',
          options TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 2,
    description: "FTS5 on search results",
    up: (db) => {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS search_results_fts USING fts5(
          title, url, snippet,
          content=search_results,
          content_rowid=rowid
        );

        CREATE TRIGGER IF NOT EXISTS search_results_ai AFTER INSERT ON search_results BEGIN
          INSERT INTO search_results_fts(rowid, title, url, snippet)
          VALUES (NEW.rowid, NEW.title, NEW.url, NEW.snippet);
        END;

        CREATE TRIGGER IF NOT EXISTS search_results_ad AFTER DELETE ON search_results BEGIN
          INSERT INTO search_results_fts(search_results_fts, rowid, title, url, snippet)
          VALUES ('delete', OLD.rowid, OLD.title, OLD.url, OLD.snippet);
        END;

        CREATE TRIGGER IF NOT EXISTS search_results_au AFTER UPDATE ON search_results BEGIN
          INSERT INTO search_results_fts(search_results_fts, rowid, title, url, snippet)
          VALUES ('delete', OLD.rowid, OLD.title, OLD.url, OLD.snippet);
          INSERT INTO search_results_fts(rowid, title, url, snippet)
          VALUES (NEW.rowid, NEW.title, NEW.url, NEW.snippet);
        END;
      `);
    },
  },
  {
    version: 3,
    description: "Seed default providers and profiles",
    up: (db) => {
      db.exec(`
        INSERT OR IGNORE INTO providers (name, enabled, api_key_env, rate_limit, metadata) VALUES
          ('google',      1, 'SERP_API_KEY',         100, '{}'),
          ('serpapi',      1, 'SERP_API_KEY',         100, '{}'),
          ('exa',          1, 'EXA_API_KEY',           60, '{}'),
          ('perplexity',   1, 'PERPLEXITY_API_KEY',    20, '{}'),
          ('brave',        1, 'BRAVE_API_KEY',         60, '{}'),
          ('bing',         1, 'BING_API_KEY',          60, '{}'),
          ('twitter',      0, 'X_BEARER_TOKEN',        30, '{}'),
          ('reddit',       0, 'REDDIT_CLIENT_ID',      60, '{}'),
          ('youtube',      0, 'YOUTUBE_API_KEY',       100, '{}'),
          ('hackernews',   1, '',                      60, '{}'),
          ('github',       0, 'GITHUB_TOKEN',          30, '{}'),
          ('arxiv',        1, '',                      60, '{}');

        INSERT OR IGNORE INTO search_profiles (id, name, description, providers, options, created_at) VALUES
          ('prof-research',  'research',  'Deep research: Google + Exa + Perplexity',        '["google","exa","perplexity"]',                   '{}', datetime('now')),
          ('prof-social',    'social',    'Social media: Twitter + Reddit + Hacker News',     '["twitter","reddit","hackernews"]',                '{}', datetime('now')),
          ('prof-video',     'video',     'Video search: YouTube',                            '["youtube"]',                                     '{}', datetime('now')),
          ('prof-code',      'code',      'Code search: GitHub + Exa',                        '["github","exa"]',                                '{}', datetime('now')),
          ('prof-academic',  'academic',  'Academic papers: arXiv + Exa + Perplexity',        '["arxiv","exa","perplexity"]',                    '{}', datetime('now')),
          ('prof-all',       'all',       'All enabled providers',                            '["google","serpapi","exa","perplexity","brave","bing","twitter","reddit","youtube","hackernews","github","arxiv"]', '{}', datetime('now'));
      `);
    },
  },
];

export function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db
      .query("SELECT version FROM _migrations")
      .all()
      .map((row) => (row as { version: number }).version),
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;

    db.exec("BEGIN");
    try {
      migration.up(db);
      db.prepare("INSERT INTO _migrations (version, description) VALUES (?, ?)").run(
        migration.version,
        migration.description,
      );
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
