CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'human',
  registered_at TEXT NOT NULL,
  last_seen TEXT
);
