/**
 * PostgreSQL migrations for open-conversations remote storage sync.
 *
 * Equivalent of the SQLite schema in db.ts, translated for PostgreSQL.
 * Each element is a standalone SQL string that must be executed in order.
 */
export const PG_MIGRATIONS: string[] = [
  // Migration 1: Full schema (consolidated from SQLite incremental migrations)
  `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

  CREATE TABLE IF NOT EXISTS channels (
    name TEXT PRIMARY KEY,
    description TEXT,
    topic TEXT,
    project_id TEXT REFERENCES projects(id),
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TEXT,
    metadata TEXT,
    tags TEXT
  );
  DROP INDEX IF EXISTS idx_channels_parent;
  ALTER TABLE channels DROP COLUMN IF EXISTS parent_id;
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS topic TEXT;
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS archived_at TEXT;
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS metadata TEXT;
  ALTER TABLE channels ADD COLUMN IF NOT EXISTS tags TEXT;
  CREATE INDEX IF NOT EXISTS idx_channels_project ON channels(project_id);

  CREATE TABLE IF NOT EXISTS channel_members (
    channel TEXT NOT NULL REFERENCES channels(name),
    agent TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel, agent)
  );

  CREATE TABLE IF NOT EXISTS channel_rename_aliases (
    old_channel TEXT PRIMARY KEY,
    current_channel TEXT NOT NULL,
    renamed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (old_channel <> current_channel)
  );
  CREATE INDEX IF NOT EXISTS idx_channel_rename_aliases_current
    ON channel_rename_aliases(current_channel);

  CREATE TABLE IF NOT EXISTS channel_subscriptions (
    channel TEXT NOT NULL REFERENCES channels(name),
    agent TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    preview_chars INTEGER NOT NULL DEFAULT 140,
    since_message_id BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (channel, agent)
  );
  CREATE INDEX IF NOT EXISTS idx_channel_subscriptions_agent ON channel_subscriptions(agent);
  CREATE INDEX IF NOT EXISTS idx_channel_subscriptions_channel ON channel_subscriptions(channel);
  ALTER TABLE channel_subscriptions ADD COLUMN IF NOT EXISTS since_message_id BIGINT NOT NULL DEFAULT 0;

  CREATE TABLE IF NOT EXISTS messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid TEXT NOT NULL DEFAULT gen_random_uuid()::text UNIQUE,
    session_id TEXT NOT NULL,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    channel TEXT,
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
    reply_to BIGINT REFERENCES messages(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TEXT
  );
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS uuid TEXT DEFAULT gen_random_uuid()::text;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel TEXT;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS project_id TEXT;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TEXT;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_at TEXT;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS blocking BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments TEXT;
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to BIGINT;
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'messages'::regclass AND conname = 'messages_reply_to_fkey'
    ) THEN
      ALTER TABLE messages
        ADD CONSTRAINT messages_reply_to_fkey FOREIGN KEY (reply_to)
        REFERENCES messages(id) ON DELETE RESTRICT NOT VALID;
    END IF;
  END $$;
  -- Preserve historical reply values exactly. A NOT VALID FK protects all new
  -- writes while an operator can audit legacy orphans before a later explicit
  -- VALIDATE. Migration must never rewrite correlation history silently.
  DO $$
  DECLARE legacy_reply_orphans BIGINT;
  BEGIN
    SELECT COUNT(*) INTO legacy_reply_orphans
    FROM messages child
    WHERE child.reply_to IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM messages parent WHERE parent.id = child.reply_to);
    IF legacy_reply_orphans > 0 THEN
      RAISE NOTICE 'messages_reply_to_fkey remains NOT VALID; % legacy orphan reply values require audit', legacy_reply_orphans;
    END IF;
  END $$;
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_agent);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
  CREATE INDEX IF NOT EXISTS idx_messages_pinned ON messages(pinned_at);
  CREATE INDEX IF NOT EXISTS idx_messages_blocking ON messages(blocking);
  CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to);
  CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id);
  -- Idempotent conflict target for bulk backfill (ON CONFLICT (uuid) DO NOTHING).
  -- The CREATE TABLE above declares uuid UNIQUE, but older tables may have had
  -- uuid added via ALTER without the constraint; this guarantees it either way.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_uuid ON messages(uuid);

  CREATE OR REPLACE FUNCTION message_channel_scope_rewrite_allowed(
    old_session TEXT, new_session TEXT,
    old_channel TEXT, new_channel TEXT,
    old_to_agent TEXT, new_to_agent TEXT,
    old_project TEXT, new_project TEXT,
    old_reply_to BIGINT, new_reply_to BIGINT
  ) RETURNS BOOLEAN AS $$
  DECLARE
    guard_text TEXT := current_setting('hasna.conversations.channel_scope_rewrite', TRUE);
    guard JSONB;
  BEGIN
    IF guard_text IS NULL OR guard_text = '' THEN RETURN FALSE; END IF;
    guard := guard_text::jsonb;
    RETURN old_session = guard->>'old_session_id'
       AND new_session = guard->>'new_session_id'
       AND (
         (old_channel IS NOT DISTINCT FROM guard->>'old_channel'
          AND new_channel IS NOT DISTINCT FROM guard->>'new_channel')
         OR old_channel IS NOT DISTINCT FROM new_channel
       )
       AND (
         (old_to_agent = guard->>'old_to_agent' AND new_to_agent = guard->>'new_to_agent')
         OR old_to_agent IS NOT DISTINCT FROM new_to_agent
       )
       AND old_project IS NOT DISTINCT FROM new_project
       AND old_reply_to IS NOT DISTINCT FROM new_reply_to;
  END;
  $$ LANGUAGE plpgsql STABLE;

  CREATE OR REPLACE FUNCTION enforce_message_reply_scope() RETURNS trigger AS $$
  BEGIN
    IF NEW.reply_to IS NOT NULL THEN
      IF TG_OP = 'UPDATE' AND message_channel_scope_rewrite_allowed(
        OLD.session_id, NEW.session_id, OLD.channel, NEW.channel,
        OLD.to_agent, NEW.to_agent, OLD.project_id, NEW.project_id,
        OLD.reply_to, NEW.reply_to
      ) THEN
        RETURN NEW;
      END IF;
      PERFORM 1 FROM messages parent
      WHERE parent.id = NEW.reply_to
        AND parent.session_id = NEW.session_id
        AND parent.channel IS NOT DISTINCT FROM NEW.channel
        AND parent.project_id IS NOT DISTINCT FROM NEW.project_id
      FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'reply parent is missing or outside the message scope';
      END IF;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS messages_reply_scope_insert ON messages;
  CREATE TRIGGER messages_reply_scope_insert
    BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION enforce_message_reply_scope();
  DROP TRIGGER IF EXISTS messages_reply_scope_update ON messages;
  CREATE TRIGGER messages_reply_scope_update
    BEFORE UPDATE OF reply_to, session_id, channel, project_id ON messages
    FOR EACH ROW EXECUTE FUNCTION enforce_message_reply_scope();
  CREATE OR REPLACE FUNCTION reject_reply_parent_scope_mutation() RETURNS trigger AS $$
  BEGIN
    IF (NEW.session_id IS DISTINCT FROM OLD.session_id
        OR NEW.channel IS DISTINCT FROM OLD.channel
        OR NEW.project_id IS DISTINCT FROM OLD.project_id)
       AND EXISTS (SELECT 1 FROM messages child WHERE child.reply_to = OLD.id)
       AND NOT message_channel_scope_rewrite_allowed(
         OLD.session_id, NEW.session_id, OLD.channel, NEW.channel,
         OLD.to_agent, NEW.to_agent, OLD.project_id, NEW.project_id,
         OLD.reply_to, NEW.reply_to
       ) THEN
      RAISE EXCEPTION 'reply parent scope is immutable while replies exist';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS messages_reply_parent_scope_no_update ON messages;
  CREATE TRIGGER messages_reply_parent_scope_no_update
    BEFORE UPDATE OF session_id, channel, project_id ON messages
    FOR EACH ROW EXECUTE FUNCTION reject_reply_parent_scope_mutation();

  -- Append-only canonical incident projection ledger. The message is a display
  -- projection; current incident state comes from these typed indexed columns.
  CREATE TABLE IF NOT EXISTS incident_projections (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id TEXT NOT NULL,
    projection_key TEXT NOT NULL,
    message_id BIGINT NOT NULL UNIQUE REFERENCES messages(id),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    source TEXT NOT NULL CHECK (source = 'todos'),
    tenant_id TEXT NOT NULL,
    authority_id TEXT NOT NULL,
    incident_id TEXT NOT NULL,
    transition_id TEXT NOT NULL,
    incident_version INTEGER NOT NULL CHECK (incident_version > 0),
    occurred_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open','investigating','contained','monitoring','resolved','superseded')),
    severity TEXT NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
    blocking BOOLEAN NOT NULL DEFAULT FALSE,
    affected_scopes TEXT NOT NULL,
    blocked_scopes TEXT NOT NULL,
    supersedes_transition_id TEXT,
    supersedes_incident_id TEXT,
    superseded_by_incident_id TEXT,
    canonical_payload TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (NOT (status IN ('resolved','superseded') AND blocking)),
    UNIQUE (tenant_id, event_id),
    UNIQUE (tenant_id, projection_key),
    UNIQUE (tenant_id, authority_id, incident_id, transition_id),
    UNIQUE (tenant_id, authority_id, incident_id, incident_version)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_incident_projections_message ON incident_projections(message_id);
  CREATE INDEX IF NOT EXISTS idx_incident_projections_active_scope
    ON incident_projections(tenant_id, authority_id, incident_id, incident_version DESC);
  CREATE INDEX IF NOT EXISTS idx_incident_projections_blocking_scope
    ON incident_projections(tenant_id, authority_id, blocking, incident_id, incident_version DESC);
  CREATE TABLE IF NOT EXISTS incident_projection_scopes (
    projection_id BIGINT NOT NULL REFERENCES incident_projections(id),
    scope_type TEXT NOT NULL CHECK (scope_type IN ('affected','blocked')),
    scope TEXT NOT NULL,
    PRIMARY KEY (projection_id, scope_type, scope)
  );
  CREATE INDEX IF NOT EXISTS idx_incident_projection_scopes_lookup
    ON incident_projection_scopes(scope_type, scope, projection_id);
  CREATE OR REPLACE FUNCTION reject_incident_projection_mutation() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'incident projections are append-only';
  END;
  $$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS incident_projections_no_update ON incident_projections;
  CREATE TRIGGER incident_projections_no_update
    BEFORE UPDATE ON incident_projections FOR EACH ROW EXECUTE FUNCTION reject_incident_projection_mutation();
  DROP TRIGGER IF EXISTS incident_projections_no_delete ON incident_projections;
  CREATE TRIGGER incident_projections_no_delete
    BEFORE DELETE ON incident_projections FOR EACH ROW EXECUTE FUNCTION reject_incident_projection_mutation();
  DROP TRIGGER IF EXISTS incident_projection_scopes_no_update ON incident_projection_scopes;
  CREATE TRIGGER incident_projection_scopes_no_update
    BEFORE UPDATE ON incident_projection_scopes FOR EACH ROW EXECUTE FUNCTION reject_incident_projection_mutation();
  DROP TRIGGER IF EXISTS incident_projection_scopes_no_delete ON incident_projection_scopes;
  CREATE TRIGGER incident_projection_scopes_no_delete
    BEFORE DELETE ON incident_projection_scopes FOR EACH ROW EXECUTE FUNCTION reject_incident_projection_mutation();
  CREATE OR REPLACE FUNCTION reject_incident_projection_message_mutation() RETURNS trigger AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM incident_projections WHERE message_id = OLD.id) THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'incident projection messages are append-only';
    END IF;
    IF message_channel_scope_rewrite_allowed(
         OLD.session_id, NEW.session_id, OLD.channel, NEW.channel,
         OLD.to_agent, NEW.to_agent, OLD.project_id, NEW.project_id,
         OLD.reply_to, NEW.reply_to
       )
       AND NEW.uuid IS NOT DISTINCT FROM OLD.uuid
       AND NEW.from_agent IS NOT DISTINCT FROM OLD.from_agent
       AND NEW.content IS NOT DISTINCT FROM OLD.content
       AND NEW.priority IS NOT DISTINCT FROM OLD.priority
       AND NEW.working_dir IS NOT DISTINCT FROM OLD.working_dir
       AND NEW.repository IS NOT DISTINCT FROM OLD.repository
       AND NEW.branch IS NOT DISTINCT FROM OLD.branch
       AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
       AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
       AND NEW.read_at IS NOT DISTINCT FROM OLD.read_at
       AND NEW.edited_at IS NOT DISTINCT FROM OLD.edited_at
       AND NEW.pinned_at IS NOT DISTINCT FROM OLD.pinned_at
       AND NEW.blocking IS NOT DISTINCT FROM OLD.blocking
       AND NEW.attachments IS NOT DISTINCT FROM OLD.attachments THEN
      RETURN NEW;
    END IF;
    IF NEW.uuid IS DISTINCT FROM OLD.uuid
       OR NEW.session_id IS DISTINCT FROM OLD.session_id
       OR NEW.from_agent IS DISTINCT FROM OLD.from_agent
       OR NEW.to_agent IS DISTINCT FROM OLD.to_agent
       OR NEW.channel IS DISTINCT FROM OLD.channel
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.content IS DISTINCT FROM OLD.content
       OR NEW.priority IS DISTINCT FROM OLD.priority
       OR NEW.working_dir IS DISTINCT FROM OLD.working_dir
       OR NEW.repository IS DISTINCT FROM OLD.repository
       OR NEW.branch IS DISTINCT FROM OLD.branch
       OR NEW.metadata IS DISTINCT FROM OLD.metadata
       OR NEW.edited_at IS DISTINCT FROM OLD.edited_at
       OR NEW.blocking IS DISTINCT FROM OLD.blocking
       OR NEW.attachments IS DISTINCT FROM OLD.attachments
       OR NEW.reply_to IS DISTINCT FROM OLD.reply_to
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'incident projection messages are append-only';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS incident_projection_messages_no_mutation ON messages;
  CREATE TRIGGER incident_projection_messages_no_mutation
    BEFORE UPDATE ON messages FOR EACH ROW
    EXECUTE FUNCTION reject_incident_projection_message_mutation();
  DROP TRIGGER IF EXISTS incident_projection_messages_no_delete ON messages;
  CREATE TRIGGER incident_projection_messages_no_delete
    BEFORE DELETE ON messages FOR EACH ROW
    EXECUTE FUNCTION reject_incident_projection_message_mutation();

  UPDATE channel_subscriptions ss
  SET since_message_id = COALESCE(
    (SELECT MAX(m.id) FROM messages m WHERE m.channel = ss.channel),
    0
  )
  WHERE ss.since_message_id = 0;

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

  CREATE TABLE IF NOT EXISTS channel_notification_reads (
    agent TEXT NOT NULL,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agent, message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_channel_notification_reads_agent ON channel_notification_reads(agent);
  CREATE INDEX IF NOT EXISTS idx_channel_notification_reads_message ON channel_notification_reads(message_id);

  CREATE TABLE IF NOT EXISTS message_mentions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    mentioned_agent TEXT NOT NULL,
    from_agent TEXT NOT NULL,
    channel TEXT,
    notified_at TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_mentions_agent ON message_mentions(mentioned_agent);
  CREATE INDEX IF NOT EXISTS idx_mentions_message ON message_mentions(message_id);
  CREATE INDEX IF NOT EXISTS idx_mentions_notified ON message_mentions(notified_at);

  CREATE OR REPLACE FUNCTION __open_conversations_normalize_channel_name(input TEXT)
  RETURNS TEXT AS $$
  DECLARE
    value TEXT := lower(btrim(regexp_replace(COALESCE(input, ''), '^#+', '')));
  BEGIN
    value := regexp_replace(value, '[^a-z0-9._-]+', '-', 'g');
    value := regexp_replace(value, '-+', '-', 'g');
    value := regexp_replace(value, '^[._-]+|[._-]+$', '', 'g');
    IF value = '' THEN
      RETURN 'channel';
    END IF;
    RETURN value;
  END;
  $$ LANGUAGE plpgsql IMMUTABLE;

  CREATE OR REPLACE FUNCTION __open_conversations_stable_suffix(value TEXT)
  RETURNS TEXT AS $$
  DECLARE
    hash BIGINT := 2166136261;
    code INTEGER;
    index INTEGER;
    digits TEXT := '0123456789abcdefghijklmnopqrstuvwxyz';
    encoded TEXT := '';
    remainder INTEGER;
  BEGIN
    FOR index IN 1..char_length(COALESCE(value, '')) LOOP
      code := ascii(substr(value, index, 1));
      hash := mod((hash # code::BIGINT) * 16777619, 4294967296::BIGINT);
    END LOOP;

    IF hash = 0 THEN
      encoded := '0';
    ELSE
      WHILE hash > 0 LOOP
        remainder := mod(hash, 36);
        encoded := substr(digits, remainder + 1, 1) || encoded;
        hash := hash / 36;
      END LOOP;
    END IF;

    RETURN substr(lpad(encoded, 6, '0'), 1, 6);
  END;
  $$ LANGUAGE plpgsql IMMUTABLE;

  DO $$
  DECLARE
    has_spaces BOOLEAN := to_regclass('public.spaces') IS NOT NULL;
    has_space_members BOOLEAN := to_regclass('public.space_members') IS NOT NULL;
    has_space_subscriptions BOOLEAN := to_regclass('public.space_subscriptions') IS NOT NULL;
    has_space_notification_reads BOOLEAN := to_regclass('public.space_notification_reads') IS NOT NULL;
    has_tasks BOOLEAN := to_regclass('public.tasks') IS NOT NULL;
    has_graph_edges BOOLEAN := to_regclass('public.graph_edges') IS NOT NULL;
    has_resource_locks BOOLEAN := to_regclass('public.resource_locks') IS NOT NULL;
    has_messages_space BOOLEAN := EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'space'
    );
    has_message_mentions_space BOOLEAN := EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'message_mentions' AND column_name = 'space'
    );
    has_tasks_space BOOLEAN := EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'space'
    );
    rec RECORD;
    candidate TEXT;
    resolved TEXT;
    suffix_index INTEGER;
  BEGIN
    CREATE TEMP TABLE IF NOT EXISTS __legacy_spaces (
      name TEXT PRIMARY KEY,
      description TEXT,
      parent_id TEXT,
      project_id TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ,
      archived_at TEXT,
      topic TEXT
    ) ON COMMIT DROP;
    TRUNCATE __legacy_spaces;

    CREATE TEMP TABLE IF NOT EXISTS __legacy_channel_names (
      legacy_name TEXT PRIMARY KEY
    ) ON COMMIT DROP;
    TRUNCATE __legacy_channel_names;

    CREATE TEMP TABLE IF NOT EXISTS __legacy_channel_map (
      legacy_name TEXT PRIMARY KEY,
      channel_name TEXT NOT NULL UNIQUE
    ) ON COMMIT DROP;
    TRUNCATE __legacy_channel_map;

    CREATE TEMP TABLE IF NOT EXISTS __legacy_first_messages (
      legacy_name TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ,
      created_by TEXT
    ) ON COMMIT DROP;
    TRUNCATE __legacy_first_messages;

    IF has_spaces THEN
      EXECUTE format(
        'INSERT INTO __legacy_spaces (name, description, parent_id, project_id, created_by, created_at, archived_at, topic)
         SELECT name, %s, %s, %s, COALESCE(%s, ''migration''), COALESCE(%s, NOW()), %s, %s
         FROM spaces
         WHERE name IS NOT NULL AND btrim(name) <> ''''
         ON CONFLICT (name) DO NOTHING',
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spaces' AND column_name = 'description') THEN 'description' ELSE 'NULL::TEXT' END,
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spaces' AND column_name = 'parent_id') THEN 'parent_id' ELSE 'NULL::TEXT' END,
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spaces' AND column_name = 'project_id') THEN 'project_id' ELSE 'NULL::TEXT' END,
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spaces' AND column_name = 'created_by') THEN 'created_by' ELSE 'NULL::TEXT' END,
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spaces' AND column_name = 'created_at') THEN 'created_at' ELSE 'NULL::TIMESTAMPTZ' END,
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spaces' AND column_name = 'archived_at') THEN 'archived_at' ELSE 'NULL::TEXT' END,
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'spaces' AND column_name = 'topic') THEN 'topic' ELSE 'NULL::TEXT' END
      );

      INSERT INTO __legacy_channel_names (legacy_name)
      SELECT btrim(name) FROM __legacy_spaces
      ON CONFLICT DO NOTHING;
    END IF;

    IF has_messages_space THEN
      EXECUTE 'INSERT INTO __legacy_channel_names (legacy_name)
               SELECT DISTINCT btrim(space) FROM messages WHERE space IS NOT NULL AND btrim(space) <> ''''
               ON CONFLICT DO NOTHING';
      EXECUTE 'INSERT INTO __legacy_first_messages (legacy_name, created_at, created_by)
               SELECT legacy_name, created_at, from_agent
               FROM (
                 SELECT
                   btrim(space) AS legacy_name,
                   created_at,
                   from_agent,
                   row_number() OVER (PARTITION BY btrim(space) ORDER BY created_at ASC, id ASC) AS rn
                 FROM messages
                 WHERE space IS NOT NULL AND btrim(space) <> ''''
               ) ranked
               WHERE rn = 1
               ON CONFLICT DO NOTHING';
    END IF;
    IF has_space_members THEN
      EXECUTE 'INSERT INTO __legacy_channel_names (legacy_name)
               SELECT DISTINCT btrim(space) FROM space_members WHERE space IS NOT NULL AND btrim(space) <> ''''
               ON CONFLICT DO NOTHING';
    END IF;
    IF has_space_subscriptions THEN
      EXECUTE 'INSERT INTO __legacy_channel_names (legacy_name)
               SELECT DISTINCT btrim(space) FROM space_subscriptions WHERE space IS NOT NULL AND btrim(space) <> ''''
               ON CONFLICT DO NOTHING';
    END IF;
    IF has_message_mentions_space THEN
      EXECUTE 'INSERT INTO __legacy_channel_names (legacy_name)
               SELECT DISTINCT btrim(space) FROM message_mentions WHERE space IS NOT NULL AND btrim(space) <> ''''
               ON CONFLICT DO NOTHING';
    END IF;
    IF has_tasks_space THEN
      EXECUTE 'INSERT INTO __legacy_channel_names (legacy_name)
               SELECT DISTINCT btrim(space) FROM tasks WHERE space IS NOT NULL AND btrim(space) <> ''''
               ON CONFLICT DO NOTHING';
    END IF;
    IF has_graph_edges THEN
      EXECUTE 'INSERT INTO __legacy_channel_names (legacy_name)
               SELECT DISTINCT btrim(from_id) FROM graph_edges WHERE from_type = ''space'' AND from_id IS NOT NULL AND btrim(from_id) <> ''''
               ON CONFLICT DO NOTHING';
      EXECUTE 'INSERT INTO __legacy_channel_names (legacy_name)
               SELECT DISTINCT btrim(to_id) FROM graph_edges WHERE to_type = ''space'' AND to_id IS NOT NULL AND btrim(to_id) <> ''''
               ON CONFLICT DO NOTHING';
    END IF;
    IF has_resource_locks THEN
      EXECUTE 'INSERT INTO __legacy_channel_names (legacy_name)
               SELECT DISTINCT btrim(resource_id) FROM resource_locks WHERE resource_type = ''space'' AND resource_id IS NOT NULL AND btrim(resource_id) <> ''''
               ON CONFLICT DO NOTHING';
    END IF;

    FOR rec IN
      WITH normalized AS (
        SELECT legacy_name, __open_conversations_normalize_channel_name(legacy_name) AS base
        FROM __legacy_channel_names
      ),
      canonical AS (
        SELECT
          base,
          COALESCE(
            MIN(legacy_name) FILTER (WHERE legacy_name = base),
            MIN(legacy_name) FILTER (WHERE legacy_name !~ '^#'),
            MIN(legacy_name)
          ) AS canonical
        FROM normalized
        GROUP BY base
      )
      SELECT
        n.legacy_name,
        n.base,
        CASE
          WHEN n.legacy_name = c.canonical THEN n.base
          ELSE n.base || '--' || __open_conversations_stable_suffix(n.legacy_name)
        END AS candidate
      FROM normalized n
      JOIN canonical c ON c.base = n.base
      ORDER BY n.base, n.legacy_name
    LOOP
      candidate := rec.candidate;
      resolved := candidate;
      suffix_index := 2;
      WHILE EXISTS (SELECT 1 FROM __legacy_channel_map WHERE channel_name = resolved) LOOP
        resolved := candidate || '-' || suffix_index::TEXT;
        suffix_index := suffix_index + 1;
      END LOOP;
      INSERT INTO __legacy_channel_map (legacy_name, channel_name) VALUES (rec.legacy_name, resolved);
    END LOOP;

    IF EXISTS (SELECT 1 FROM __legacy_channel_map) THEN
      WITH RECURSIVE lineage AS (
        SELECT name, parent_id, 0 AS depth, ARRAY[name] AS path
        FROM __legacy_spaces
        UNION ALL
        SELECT lineage.name, parent.parent_id, lineage.depth + 1, lineage.path || parent.name
        FROM lineage
        JOIN __legacy_spaces parent ON parent.name = lineage.parent_id
        WHERE lineage.depth < 32 AND NOT parent.name = ANY(lineage.path)
      ),
      depths AS (
        SELECT name, max(depth) AS depth FROM lineage GROUP BY name
      )
      INSERT INTO channels (name, description, topic, project_id, created_by, created_at, archived_at, metadata, tags)
      SELECT
        channel_map.channel_name,
        legacy_spaces.description,
        legacy_spaces.topic,
        legacy_spaces.project_id,
        COALESCE(legacy_spaces.created_by, first_message.created_by, 'migration'),
        COALESCE(legacy_spaces.created_at, first_message.created_at, NOW()),
        legacy_spaces.archived_at,
        json_build_object(
          'import_source',
          json_build_object(
            'type', 'legacy_space',
            'source', CASE WHEN legacy_spaces.name IS NULL THEN 'reference' ELSE 'space' END,
            'name', channel_map.legacy_name,
            'parent', legacy_spaces.parent_id,
            'parent_channel', parent_map.channel_name,
            'depth', COALESCE(depths.depth, 0),
            'normalized_name', channel_map.channel_name
          )
        )::TEXT,
        to_json(array_remove(ARRAY[
          'imported',
          'legacy-space',
          CASE WHEN legacy_spaces.parent_id IS NOT NULL THEN 'legacy-parent:' || COALESCE(parent_map.channel_name, __open_conversations_normalize_channel_name(legacy_spaces.parent_id)) END,
          CASE WHEN COALESCE(depths.depth, 0) > 0 THEN 'legacy-depth:' || depths.depth::TEXT END
        ], NULL))::TEXT
      FROM __legacy_channel_map channel_map
      LEFT JOIN __legacy_spaces legacy_spaces ON legacy_spaces.name = channel_map.legacy_name
      LEFT JOIN __legacy_channel_map parent_map ON parent_map.legacy_name = legacy_spaces.parent_id
      LEFT JOIN depths ON depths.name = legacy_spaces.name
      LEFT JOIN __legacy_first_messages first_message ON first_message.legacy_name = channel_map.legacy_name
      ON CONFLICT (name) DO UPDATE SET
        description = COALESCE(channels.description, excluded.description),
        topic = COALESCE(channels.topic, excluded.topic),
        project_id = COALESCE(channels.project_id, excluded.project_id),
        archived_at = COALESCE(channels.archived_at, excluded.archived_at),
        metadata = COALESCE(channels.metadata, excluded.metadata),
        tags = COALESCE(channels.tags, excluded.tags);

      IF has_space_members THEN
        EXECUTE 'INSERT INTO channel_members (channel, agent, joined_at)
                 SELECT channel_map.channel_name, space_members.agent, space_members.joined_at
                 FROM space_members
                 JOIN __legacy_channel_map channel_map ON channel_map.legacy_name = space_members.space
                 ON CONFLICT DO NOTHING';
      END IF;

      IF has_space_subscriptions THEN
        EXECUTE format(
          'INSERT INTO channel_subscriptions (channel, agent, created_at, preview_chars, since_message_id)
           SELECT channel_map.channel_name, space_subscriptions.agent, space_subscriptions.created_at, space_subscriptions.preview_chars, %s
           FROM space_subscriptions
           JOIN __legacy_channel_map channel_map ON channel_map.legacy_name = space_subscriptions.space
           ON CONFLICT DO NOTHING',
          CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'space_subscriptions' AND column_name = 'since_message_id') THEN 'space_subscriptions.since_message_id' ELSE '0' END
        );
      END IF;

      IF has_space_notification_reads THEN
        EXECUTE 'INSERT INTO channel_notification_reads (agent, message_id, read_at)
                 SELECT agent, message_id, read_at FROM space_notification_reads
                 ON CONFLICT DO NOTHING';
      END IF;

      IF has_messages_space THEN
        EXECUTE 'UPDATE messages
                 SET channel = channel_map.channel_name,
                     to_agent = channel_map.channel_name
                 FROM __legacy_channel_map channel_map
                 WHERE messages.space = channel_map.legacy_name';
      END IF;
      EXECUTE 'UPDATE messages
               SET channel = channel_map.channel_name,
                   to_agent = CASE WHEN messages.to_agent = channel_map.legacy_name THEN channel_map.channel_name ELSE messages.to_agent END
               FROM __legacy_channel_map channel_map
               WHERE messages.channel = channel_map.legacy_name';
      EXECUTE 'UPDATE messages
               SET session_id = ''channel:'' || channel_map.channel_name
               FROM __legacy_channel_map channel_map
               WHERE messages.session_id = ''space:'' || channel_map.legacy_name
                  OR messages.session_id = ''channel:'' || channel_map.legacy_name';

      IF has_message_mentions_space THEN
        ALTER TABLE message_mentions ADD COLUMN IF NOT EXISTS channel TEXT;
        EXECUTE 'UPDATE message_mentions
                 SET channel = channel_map.channel_name
                 FROM __legacy_channel_map channel_map
                 WHERE message_mentions.space = channel_map.legacy_name';
      END IF;

      IF has_tasks THEN
        IF has_tasks_space THEN
          ALTER TABLE tasks ADD COLUMN IF NOT EXISTS channel TEXT;
          EXECUTE 'UPDATE tasks
                   SET channel = channel_map.channel_name
                   FROM __legacy_channel_map channel_map
                   WHERE tasks.space = channel_map.legacy_name';
        END IF;
      END IF;

      IF has_graph_edges THEN
        EXECUTE 'UPDATE graph_edges
                 SET from_type = ''channel'', from_id = channel_map.channel_name
                 FROM __legacy_channel_map channel_map
                 WHERE graph_edges.from_type = ''space'' AND graph_edges.from_id = channel_map.legacy_name';
        EXECUTE 'UPDATE graph_edges
                 SET to_type = ''channel'', to_id = channel_map.channel_name
                 FROM __legacy_channel_map channel_map
                 WHERE graph_edges.to_type = ''space'' AND graph_edges.to_id = channel_map.legacy_name';
      END IF;

      IF has_resource_locks THEN
        EXECUTE 'UPDATE resource_locks
                 SET resource_type = ''channel'', resource_id = channel_map.channel_name
                 FROM __legacy_channel_map channel_map
                 WHERE resource_locks.resource_type = ''space'' AND resource_locks.resource_id = channel_map.legacy_name';
      END IF;
    END IF;

    DROP INDEX IF EXISTS idx_messages_space;
    DROP INDEX IF EXISTS idx_spaces_parent;
    DROP INDEX IF EXISTS idx_spaces_project;
    DROP INDEX IF EXISTS idx_space_subscriptions_agent;
    DROP INDEX IF EXISTS idx_space_subscriptions_space;
    DROP INDEX IF EXISTS idx_space_notification_reads_agent;
    DROP INDEX IF EXISTS idx_space_notification_reads_message;
    DROP INDEX IF EXISTS idx_tasks_space;
    DROP TABLE IF EXISTS space_members;
    DROP TABLE IF EXISTS space_subscriptions;
    DROP TABLE IF EXISTS space_notification_reads;
    DROP TABLE IF EXISTS spaces;
    IF has_messages_space THEN
      ALTER TABLE messages DROP COLUMN IF EXISTS space;
    END IF;
    IF has_message_mentions_space THEN
      ALTER TABLE message_mentions DROP COLUMN IF EXISTS space;
    END IF;
    IF has_tasks_space THEN
      ALTER TABLE tasks DROP COLUMN IF EXISTS space;
    END IF;
  END $$;

  UPDATE channel_subscriptions ss
  SET since_message_id = COALESCE(
    (SELECT MAX(m.id) FROM messages m WHERE m.channel = ss.channel),
    0
  )
  WHERE ss.since_message_id = 0;

  DROP FUNCTION IF EXISTS __open_conversations_normalize_channel_name(TEXT);
  DROP FUNCTION IF EXISTS __open_conversations_stable_suffix(TEXT);

  -- Full-text search using PostgreSQL tsvector
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS search_vector tsvector;
  CREATE INDEX IF NOT EXISTS idx_messages_search ON messages USING GIN(search_vector);

  CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'A') ||
      setweight(to_tsvector('english', COALESCE(NEW.from_agent, '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(NEW.to_agent, '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(NEW.channel, '')), 'C');
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS messages_search_vector_trigger ON messages;
  CREATE TRIGGER messages_search_vector_trigger
    BEFORE INSERT OR UPDATE OF content, from_agent, to_agent, channel ON messages
    FOR EACH ROW EXECUTE FUNCTION messages_search_vector_update();

  -- Backfill existing rows
  UPDATE messages SET search_vector =
    setweight(to_tsvector('english', COALESCE(content, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(from_agent, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(to_agent, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(channel, '')), 'C')
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
  // Migration 2: hot-path indexes for the high-volume messages table.
  // messages is the dominant read/write table; these two composite/partial
  // indexes target the two hottest query shapes that migration 1 left on
  // single-column indexes:
  //   - channel history read + pagination: WHERE channel = ? ORDER BY created_at, id
  //   - unread inbox fan-in:               WHERE to_agent = ? AND read_at IS NULL
  `
  CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(channel, created_at, id);
  CREATE INDEX IF NOT EXISTS idx_messages_to_agent_unread ON messages(to_agent) WHERE read_at IS NULL;
  INSERT INTO _migrations (id) VALUES (2) ON CONFLICT DO NOTHING;
  `,
  // Migration 3: tasks + task_comments + task_activity + task_dependencies.
  // The SQLite schema (db.ts) carries a full task tracker; migration 1 only
  // referenced `tasks` conditionally (for legacy-space rewrites) but never
  // created it. This mirrors the SQLite tables so the self_hosted/cloud API can
  // serve the ApiStore's /tasks/* routes at parity with the local store.
  `
  CREATE TABLE IF NOT EXISTS tasks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '') UNIQUE,
    subject TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    priority TEXT NOT NULL DEFAULT 'medium',
    assignee TEXT,
    reporter TEXT NOT NULL,
    project_id TEXT,
    channel TEXT,
    parent_id BIGINT REFERENCES tasks(id),
    depends_on TEXT,
    tags TEXT,
    metadata TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    due_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_uuid ON tasks(uuid);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
  CREATE INDEX IF NOT EXISTS idx_tasks_reporter ON tasks(reporter);
  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_channel ON tasks(channel);
  CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);

  CREATE TABLE IF NOT EXISTS task_comments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);

  CREATE TABLE IF NOT EXISTS task_activity (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_activity_agent ON task_activity(agent);

  CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on_id)
  );
  CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_dependencies(depends_on_id);

  INSERT INTO _migrations (id) VALUES (3) ON CONFLICT DO NOTHING;
  `,
];
