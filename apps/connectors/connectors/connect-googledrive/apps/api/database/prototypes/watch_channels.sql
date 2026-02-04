CREATE TABLE IF NOT EXISTS watch_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL UNIQUE,
    resource_id TEXT,
    resource_uri TEXT,
    expiration TIMESTAMP,
    token TEXT,
    account_id TEXT NOT NULL,
    kind TEXT DEFAULT 'changes',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
