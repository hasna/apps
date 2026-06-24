/**
 * PostgreSQL migrations for open-conversations remote storage sync.
 *
 * Equivalent of the SQLite schema in db.ts, translated for PostgreSQL.
 * Each element is a standalone SQL string that must be executed in order.
 */
export const PG_MIGRATIONS: string[] = [
  // Migration 1: Full schema (consolidated from SQLite incremental migrations)
  `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    path TEXT,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata TEXT,
    tags TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    repository TEXT,
    settings TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
  CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

  CREATE TABLE IF NOT EXISTS spaces (
    name TEXT PRIMARY KEY,
    description TEXT,
    parent_id TEXT REFERENCES spaces(name),
    project_id TEXT REFERENCES projects(id),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TEXT,
    topic TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_spaces_parent ON spaces(parent_id);
  CREATE INDEX IF NOT EXISTS idx_spaces_project ON spaces(project_id);

  CREATE TABLE IF NOT EXISTS space_members (
    space TEXT NOT NULL REFERENCES spaces(name),
    agent TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (space, agent)
  );

  CREATE TABLE IF NOT EXISTS space_subscriptions (
    space TEXT NOT NULL REFERENCES spaces(name),
    agent TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    preview_chars INTEGER NOT NULL DEFAULT 140,
    since_message_id BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (space, agent)
  );
  CREATE INDEX IF NOT EXISTS idx_space_subscriptions_agent ON space_subscriptions(agent);
  CREATE INDEX IF NOT EXISTS idx_space_subscriptions_space ON space_subscriptions(space);
  ALTER TABLE space_subscriptions ADD COLUMN IF NOT EXISTS since_message_id BIGINT NOT NULL DEFAULT 0;
  UPDATE space_subscriptions ss
  SET since_message_id = COALESCE(
    (SELECT MAX(m.id) FROM messages m WHERE m.space = ss.space),
    0
  )
  WHERE ss.since_message_id = 0;

  CREATE TABLE IF NOT EXISTS messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid TEXT NOT NULL DEFAULT gen_random_uuid()::text UNIQUE,
    session_id TEXT NOT NULL,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    space TEXT,
    project_id TEXT,
    content TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    working_dir TEXT,
    repository TEXT,
    branch TEXT,
    metadata TEXT,
    edited_at TEXT,
    pinned_at TEXT,
    blocking BOOLEAN NOT NULL DEFAULT FALSE,
    attachments TEXT,
    reply_to BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_agent);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_space ON messages(space);
  CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(pinned_at);
  CREATE INDEX IF NOT EXISTS idx_messages_blocking ON messages(blocking);
  CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to);
  CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id);

  CREATE TABLE IF NOT EXISTS agent_presence (
    id TEXT NOT NULL DEFAULT '',
    agent TEXT NOT NULL,
    session_id TEXT,
    role TEXT NOT NULL DEFAULT 'agent',
    project_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'online',
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata TEXT,
    PRIMARY KEY (agent, project_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_presence_agent_unique ON agent_presence(agent);

  CREATE TABLE IF NOT EXISTS resource_locks (
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    lock_type TEXT NOT NULL DEFAULT 'advisory',
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE(resource_type, resource_id, lock_type)
  );
  CREATE INDEX IF NOT EXISTS idx_locks_resource ON resource_locks(resource_type, resource_id);
  CREATE INDEX IF NOT EXISTS idx_locks_agent ON resource_locks(agent_id);
  CREATE INDEX IF NOT EXISTS idx_locks_expires ON resource_locks(expires_at);

  CREATE TABLE IF NOT EXISTS reactions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    agent TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, agent, emoji)
  );
  CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);

  CREATE TABLE IF NOT EXISTS message_read_receipts (
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    agent TEXT NOT NULL,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, agent)
  );
  CREATE INDEX IF NOT EXISTS idx_read_receipts_message ON message_read_receipts(message_id);
  CREATE INDEX IF NOT EXISTS idx_read_receipts_agent ON message_read_receipts(agent);

  CREATE TABLE IF NOT EXISTS space_notification_reads (
    agent TEXT NOT NULL,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_space_notification_reads_agent ON space_notification_reads(agent);
  CREATE INDEX IF NOT EXISTS idx_space_notification_reads_message ON space_notification_reads(message_id);

  CREATE TABLE IF NOT EXISTS message_mentions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    mentioned_agent TEXT NOT NULL,
    from_agent TEXT NOT NULL,
    space TEXT,
    notified_at TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_mentions_agent ON message_mentions(mentioned_agent);
  CREATE INDEX IF NOT EXISTS idx_mentions_message ON message_mentions(message_id);
  CREATE INDEX IF NOT EXISTS idx_mentions_notified ON message_mentions(notified_at);

  -- Full-text search using PostgreSQL tsvector
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_vector tsvector;
  CREATE INDEX IF NOT EXISTS idx_messages_search ON messages USING GIN(search_vector);

  CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'A') ||
      setweight(to_tsvector('english', COALESCE(NEW.from_agent, '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(NEW.to_agent, '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(NEW.space, '')), 'C');
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS messages_search_vector_trigger ON messages;
  CREATE TRIGGER messages_search_vector_trigger
    BEFORE INSERT OR UPDATE OF content, from_agent, to_agent, space ON messages
    FOR EACH ROW EXECUTE FUNCTION messages_search_vector_update();

  -- Backfill existing rows
  UPDATE messages SET search_vector =
    setweight(to_tsvector('english', COALESCE(content, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(from_agent, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(to_agent, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(space, '')), 'C')
  WHERE search_vector IS NULL;

  -- Feedback table
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS graph_edges (
    from_type TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_type TEXT NOT NULL,
    to_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    weight DOUBLE PRECISION NOT NULL DEFAULT 1,
    metadata TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(from_type, from_id, to_type, to_id, relation)
  );
  CREATE INDEX IF NOT EXISTS idx_graph_from ON graph_edges(from_type, from_id);
  CREATE INDEX IF NOT EXISTS idx_graph_to ON graph_edges(to_type, to_id);
  CREATE INDEX IF NOT EXISTS idx_graph_relation ON graph_edges(relation);

  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  INSERT INTO _migrations (id) VALUES (1) ON CONFLICT DO NOTHING;
  `,
];
