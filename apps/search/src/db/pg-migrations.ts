/**
 * PostgreSQL migrations for open-search cloud sync.
 *
 * Equivalent to the SQLite schema in migrations.ts, translated for PostgreSQL.
 * FTS5 virtual tables and triggers are omitted (use pg_trgm / tsvector instead).
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: _migrations tracking
  `CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 2: searches
  `CREATE TABLE IF NOT EXISTS searches (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    providers TEXT NOT NULL DEFAULT '[]',
    profile_id TEXT,
    result_count INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_searches_query ON searches(query)`,
  `CREATE INDEX IF NOT EXISTS idx_searches_created ON searches(created_at)`,

  // Migration 3: search_results
  `CREATE TABLE IF NOT EXISTS search_results (
    id TEXT PRIMARY KEY,
    search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
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
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_results_search ON search_results(search_id)`,
  `CREATE INDEX IF NOT EXISTS idx_results_url ON search_results(url)`,
  `CREATE INDEX IF NOT EXISTS idx_results_source ON search_results(source)`,

  // Migration 4: saved_searches
  `CREATE TABLE IF NOT EXISTS saved_searches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    providers TEXT NOT NULL DEFAULT '[]',
    profile_id TEXT,
    options TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    last_run_at TEXT
  )`,

  // Migration 5: providers
  `CREATE TABLE IF NOT EXISTS providers (
    name TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    api_key_env TEXT NOT NULL,
    rate_limit INTEGER NOT NULL DEFAULT 60,
    last_used_at TEXT,
    metadata TEXT NOT NULL DEFAULT '{}'
  )`,

  // Migration 6: search_profiles
  `CREATE TABLE IF NOT EXISTS search_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    providers TEXT NOT NULL DEFAULT '[]',
    options TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 7: seed default providers
  `INSERT INTO providers (name, enabled, api_key_env, rate_limit, metadata) VALUES
    ('google',      TRUE,  'SERP_API_KEY',         100, '{}'),
    ('serpapi',      TRUE,  'SERP_API_KEY',         100, '{}'),
    ('exa',          TRUE,  'EXA_API_KEY',           60, '{}'),
    ('perplexity',   TRUE,  'PERPLEXITY_API_KEY',    20, '{}'),
    ('brave',        TRUE,  'BRAVE_API_KEY',         60, '{}'),
    ('bing',         TRUE,  'BING_API_KEY',          60, '{}'),
    ('twitter',      FALSE, 'X_BEARER_TOKEN',        30, '{}'),
    ('reddit',       FALSE, 'REDDIT_CLIENT_ID',      60, '{}'),
    ('youtube',      FALSE, 'YOUTUBE_API_KEY',       100, '{}'),
    ('hackernews',   TRUE,  '',                      60, '{}'),
    ('github',       FALSE, 'GITHUB_TOKEN',          30, '{}'),
    ('arxiv',        TRUE,  '',                      60, '{}')
  ON CONFLICT (name) DO NOTHING`,

  // Migration 8: seed default profiles
  `INSERT INTO search_profiles (id, name, description, providers, options, created_at) VALUES
    ('prof-research',  'research',  'Deep research: Google + Exa + Perplexity',        '["google","exa","perplexity"]',                   '{}', NOW()::text),
    ('prof-social',    'social',    'Social media: Twitter + Reddit + Hacker News',     '["twitter","reddit","hackernews"]',                '{}', NOW()::text),
    ('prof-video',     'video',     'Video search: YouTube',                            '["youtube"]',                                     '{}', NOW()::text),
    ('prof-code',      'code',      'Code search: GitHub + Exa',                        '["github","exa"]',                                '{}', NOW()::text),
    ('prof-academic',  'academic',  'Academic papers: arXiv + Exa + Perplexity',        '["arxiv","exa","perplexity"]',                    '{}', NOW()::text),
    ('prof-all',       'all',       'All enabled providers',                            '["google","serpapi","exa","perplexity","brave","bing","twitter","reddit","youtube","hackernews","github","arxiv"]', '{}', NOW()::text)
  ON CONFLICT (id) DO NOTHING`,

  // Migration 9: feedback table
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
