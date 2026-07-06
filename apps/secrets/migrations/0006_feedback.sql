CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  email TEXT,
  category TEXT DEFAULT 'general',
  version TEXT,
  machine_id TEXT,
  created_at TEXT NOT NULL
);
