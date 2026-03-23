/**
 * PostgreSQL migrations for open-tickets cloud sync.
 *
 * Equivalent to the SQLite schema in database.ts, translated for PostgreSQL.
 */

export const PG_MIGRATIONS: string[] = [
  // Migration 1: workspaces table
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 2: agents table
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'human' CHECK(type IN ('human', 'ai_agent')),
    email TEXT,
    api_key_hash TEXT,
    permissions TEXT NOT NULL DEFAULT '["read","write"]',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    last_seen_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)`,
  `CREATE INDEX IF NOT EXISTS idx_agents_email ON agents(email)`,

  // Migration 3: projects table
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    ticket_prefix TEXT NOT NULL,
    ticket_counter INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    icon TEXT,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    UNIQUE(workspace_id, slug)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)`,

  // Migration 4: labels table
  `CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6b7280',
    description TEXT,
    UNIQUE(project_id, name)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_labels_project ON labels(project_id)`,

  // Migration 5: milestones table
  `CREATE TABLE IF NOT EXISTS milestones (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id)`,

  // Migration 6: tickets table
  `CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    short_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'bug' CHECK(type IN ('bug', 'feature', 'question', 'incident', 'improvement', 'task')),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'in_review', 'resolved', 'closed')),
    resolution TEXT CHECK(resolution IS NULL OR resolution IN ('fixed', 'wont_fix', 'duplicate', 'invalid', 'by_design')),
    priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('none', 'low', 'medium', 'high', 'critical')),
    severity TEXT CHECK(severity IS NULL OR severity IN ('minor', 'moderate', 'major', 'critical', 'blocker')),
    reporter_id TEXT,
    assignee_id TEXT,
    milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
    labels TEXT NOT NULL DEFAULT '[]',
    custom_fields TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL DEFAULT 'api' CHECK(source IN ('web', 'api', 'mcp', 'cli', 'email', 'webhook')),
    external_id TEXT,
    external_url TEXT,
    is_ai_opened BOOLEAN NOT NULL DEFAULT FALSE,
    ai_confidence REAL,
    ai_reasoning TEXT,
    due_date TEXT,
    sla_minutes INTEGER,
    sla_breached BOOLEAN NOT NULL DEFAULT FALSE,
    duplicate_of TEXT REFERENCES tickets(id) ON DELETE SET NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text,
    resolved_at TEXT,
    closed_at TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_workspace ON tickets(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_reporter ON tickets(reporter_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_milestone ON tickets(milestone_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_source ON tickets(source)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_sla ON tickets(sla_breached, sla_minutes)`,

  // Migration 7: comments table
  `CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    is_internal BOOLEAN NOT NULL DEFAULT FALSE,
    type TEXT NOT NULL DEFAULT 'comment' CHECK(type IN ('comment', 'status_change', 'assignment', 'ai_suggestion')),
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_comments_ticket ON comments(ticket_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id)`,

  // Migration 8: ticket_relations table
  `CREATE TABLE IF NOT EXISTS ticket_relations (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    related_ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL CHECK(relation_type IN ('blocks', 'blocked_by', 'duplicates', 'relates_to', 'caused_by')),
    created_by TEXT REFERENCES agents(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    CHECK(ticket_id != related_ticket_id),
    UNIQUE(ticket_id, related_ticket_id, relation_type)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_relations_ticket ON ticket_relations(ticket_id)`,
  `CREATE INDEX IF NOT EXISTS idx_relations_related ON ticket_relations(related_ticket_id)`,

  // Migration 9: activity table
  `CREATE TABLE IF NOT EXISTS activity (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    from_value TEXT,
    to_value TEXT,
    is_ai_action BOOLEAN NOT NULL DEFAULT FALSE,
    ai_confidence REAL,
    ai_reasoning TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_activity_ticket ON activity(ticket_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity(agent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at)`,

  // Migration 10: webhooks table
  `CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_triggered_at TEXT,
    failure_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_webhooks_workspace ON webhooks(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_webhooks_project ON webhooks(project_id)`,

  // Migration 11: api_keys table
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '["read","write"]',
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_agent ON api_keys(agent_id)`,

  // Migration 12: sessions table
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    last_activity TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id)`,

  // Migration 13: domains table
  `CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    domain TEXT NOT NULL UNIQUE,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TEXT,
    tls_cert TEXT,
    tls_key TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain)`,
  `CREATE INDEX IF NOT EXISTS idx_domains_project ON domains(project_id)`,

  // Migration 14: email_config table
  `CREATE TABLE IF NOT EXISTS email_config (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'console' CHECK(provider IN ('ses', 'resend', 'smtp', 'console')),
    config_json TEXT NOT NULL DEFAULT '{}',
    from_email TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text,
    updated_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 15: email_queue table
  `CREATE TABLE IF NOT EXISTS email_queue (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    to_addresses TEXT NOT NULL,
    from_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    html TEXT,
    text TEXT,
    headers TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    send_at TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  `CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status)`,
  `CREATE INDEX IF NOT EXISTS idx_email_queue_send_at ON email_queue(send_at)`,

  // Migration 16: _migrations tracking
  `CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT NOW()::text
  )`,

  // Migration 17: feedback table
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
