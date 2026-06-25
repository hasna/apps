/**
 * PostgreSQL migrations for open-calendar remote storage.
 */
export const PG_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    role TEXT,
    title TEXT,
    level TEXT,
    capabilities TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    last_seen_at TEXT NOT NULL DEFAULT NOW()::text,
    session_id TEXT,
    working_dir TEXT,
    active_org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS org_memberships (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member', 'service')),
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(org_id, agent_id)
  )`,

  `CREATE TABLE IF NOT EXISTS calendars (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    owner_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    visibility TEXT NOT NULL DEFAULT 'org' CHECK(visibility IN ('public', 'org', 'private')),
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(org_id, slug)
  )`,

  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    all_day BOOLEAN NOT NULL DEFAULT FALSE,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('tentative', 'confirmed', 'cancelled')),
    busy_type TEXT NOT NULL DEFAULT 'busy' CHECK(busy_type IN ('busy', 'free', 'out_of_office')),
    visibility TEXT NOT NULL DEFAULT 'default' CHECK(visibility IN ('default', 'private', 'confidential')),
    recurrence_rule TEXT,
    recurrence_exception_dates TEXT,
    source_task_id TEXT,
    created_by TEXT REFERENCES agents(id) ON DELETE SET NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS event_attendees (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
    display_name TEXT,
    email TEXT,
    status TEXT NOT NULL DEFAULT 'needsAction' CHECK(status IN ('needsAction', 'accepted', 'declined', 'tentative')),
    required BOOLEAN NOT NULL DEFAULT TRUE,
    response_comment TEXT,
    responded_at TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS availability (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    exceptions TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT NOW()::text
  )`,
];
