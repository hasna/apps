-- @hasna/contacts cloud schema (A1 pure-remote) — generated from src/db/pg-migrations.ts
-- Idempotent: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT.

CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT,
    logo_url TEXT,
    description TEXT,
    industry TEXT,
    size TEXT,
    founded_year INTEGER,
    notes TEXT,
    custom_fields TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL,
    nickname TEXT,
    avatar_url TEXT,
    notes TEXT,
    birthday TEXT,
    company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
    job_title TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    custom_fields TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#6366f1',
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS contact_tags (
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (contact_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS company_tags (
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (company_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'work' CHECK(type IN ('work','personal','other')),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS phones (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    country_code TEXT,
    type TEXT NOT NULL DEFAULT 'mobile' CHECK(type IN ('mobile','work','home','fax','whatsapp','other')),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS addresses (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'physical' CHECK(type IN ('physical','mailing','billing','virtual','other')),
    street TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    country TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS social_profiles (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK(platform IN ('twitter','linkedin','github','instagram','telegram','discord','youtube','tiktok','bluesky','facebook','whatsapp','snapchat','reddit','other')),
    handle TEXT,
    url TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS contact_relationships (
    id TEXT PRIMARY KEY,
    contact_a_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    contact_b_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL CHECK(relationship_type IN ('colleague','friend','family','reports_to','mentor','investor','partner','client','vendor','other')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
    company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '["*"]',
    secret TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Full-text search using PostgreSQL tsvector instead of FTS5
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS search_vector tsvector;
  CREATE INDEX IF NOT EXISTS idx_contacts_search ON contacts USING GIN(search_vector);

  CREATE OR REPLACE FUNCTION contacts_search_vector_update() RETURNS trigger AS $$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('simple', COALESCE(NEW.display_name, '')), 'A') ||
      setweight(to_tsvector('simple', COALESCE(NEW.first_name, '')), 'A') ||
      setweight(to_tsvector('simple', COALESCE(NEW.last_name, '')), 'A') ||
      setweight(to_tsvector('simple', COALESCE(NEW.nickname, '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(NEW.notes, '')), 'C') ||
      setweight(to_tsvector('simple', COALESCE(NEW.job_title, '')), 'B');
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS contacts_search_vector_trigger ON contacts;
  CREATE TRIGGER contacts_search_vector_trigger
    BEFORE INSERT OR UPDATE OF display_name, first_name, last_name, nickname, notes, job_title ON contacts
    FOR EACH ROW EXECUTE FUNCTION contacts_search_vector_update();

  -- Backfill
  UPDATE contacts SET search_vector =
    setweight(to_tsvector('simple', COALESCE(display_name, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(first_name, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(last_name, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(nickname, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(notes, '')), 'C') ||
    setweight(to_tsvector('simple', COALESCE(job_title, '')), 'B')
  WHERE search_vector IS NULL;

  CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY);
  INSERT INTO _migrations (version) VALUES (0) ON CONFLICT DO NOTHING;
