CREATE TABLE IF NOT EXISTS download_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    file_name TEXT,
    mime_type TEXT,
    bytes_downloaded INTEGER DEFAULT 0,
    checksum TEXT,
    status TEXT NOT NULL DEFAULT 'started',
    error TEXT,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
