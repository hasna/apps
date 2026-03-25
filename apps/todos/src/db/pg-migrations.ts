/**
 * PostgreSQL migrations for open-todos cloud sync.
 *
 * Equivalent of the SQLite migrations in database.ts, translated for PostgreSQL.
 * Each element is a standalone SQL string that must be executed in order.
 */
export const PG_MIGRATIONS: string[] = [
  // Migration 1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
    agent_id TEXT,
    assigned_to TEXT,
    session_id TEXT,
    working_dir TEXT,
    tags TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    locked_by TEXT,
    locked_at TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on),
    CHECK (task_id != depends_on)
  );

  CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id TEXT,
    session_id TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    working_dir TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata TEXT DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
  CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
  CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);

  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO _migrations (id) VALUES (1) ON CONFLICT DO NOTHING;
  `,
  // Migration 2: Add task_list_id to projects
  `
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS task_list_id TEXT;
  INSERT INTO _migrations (id) VALUES (2) ON CONFLICT DO NOTHING;
  `,
  // Migration 3: Task tags join table for exact tag filtering
  `
  CREATE TABLE IF NOT EXISTS task_tags (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (task_id, tag)
  );
  CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag);
  CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id);

  INSERT INTO _migrations (id) VALUES (3) ON CONFLICT DO NOTHING;
  `,
  // Migration 4: Plans table and plan_id on tasks
  `
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_id);
  CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);
  INSERT INTO _migrations (id) VALUES (4) ON CONFLICT DO NOTHING;
  `,
  // Migration 5: Agents and task lists
  `
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

  CREATE TABLE IF NOT EXISTS task_lists (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, slug)
  );
  CREATE INDEX IF NOT EXISTS idx_task_lists_project ON task_lists(project_id);
  CREATE INDEX IF NOT EXISTS idx_task_lists_slug ON task_lists(slug);

  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_list_id TEXT REFERENCES task_lists(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_task_list ON tasks(task_list_id);

  INSERT INTO _migrations (id) VALUES (5) ON CONFLICT DO NOTHING;
  `,
  // Migration 6: Task prefixes and short IDs
  `
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS task_prefix TEXT;
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS task_counter INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS short_id TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_short_id ON tasks(short_id) WHERE short_id IS NOT NULL;

  INSERT INTO _migrations (id) VALUES (6) ON CONFLICT DO NOTHING;
  `,
  // Migration 7: Add due_at column to tasks
  `
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_at TEXT;
  CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
  INSERT INTO _migrations (id) VALUES (7) ON CONFLICT DO NOTHING;
  `,
  // Migration 8: Add role column to agents
  `
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'agent';
  INSERT INTO _migrations (id) VALUES (8) ON CONFLICT DO NOTHING;
  `,
  // Migration 9: Add task_list_id and agent_id to plans
  `
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS task_list_id TEXT REFERENCES task_lists(id) ON DELETE SET NULL;
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS agent_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_plans_task_list ON plans(task_list_id);
  CREATE INDEX IF NOT EXISTS idx_plans_agent ON plans(agent_id);
  INSERT INTO _migrations (id) VALUES (9) ON CONFLICT DO NOTHING;
  `,
  // Migration 10: Audit log, webhooks, task templates, estimated time, approval workflow, agent permissions
  `
  CREATE TABLE IF NOT EXISTS task_history (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    agent_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_history_agent ON task_history(agent_id);

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    secret TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS task_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    title_pattern TEXT NOT NULL,
    description TEXT,
    priority TEXT DEFAULT 'medium',
    tags TEXT DEFAULT '[]',
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approved_by TEXT;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approved_at TEXT;

  ALTER TABLE agents ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT '["*"]';

  INSERT INTO _migrations (id) VALUES (10) ON CONFLICT DO NOTHING;
  `,
  // Migration 11: Org chart — agent hierarchy
  `
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS reports_to TEXT;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS title TEXT;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS level TEXT;
  INSERT INTO _migrations (id) VALUES (11) ON CONFLICT DO NOTHING;
  `,
  // Migration 12: Orgs
  `
  CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL;
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL;
  INSERT INTO _migrations (id) VALUES (12) ON CONFLICT DO NOTHING;
  `,
  // Migration 13: Recurrence fields
  `
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule TEXT;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_parent ON tasks(recurrence_parent_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_rule ON tasks(recurrence_rule) WHERE recurrence_rule IS NOT NULL;
  INSERT INTO _migrations (id) VALUES (13) ON CONFLICT DO NOTHING;
  `,
  // Migration 14: Progress tracking on comments
  `
  ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'comment' CHECK(type IN ('comment', 'progress', 'note'));
  ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS progress_pct INTEGER CHECK(progress_pct IS NULL OR (progress_pct >= 0 AND progress_pct <= 100));
  INSERT INTO _migrations (id) VALUES (14) ON CONFLICT DO NOTHING;
  `,
  // Migration 15: Full-text search (PostgreSQL tsvector approach, skip FTS5 virtual table)
  `
  -- PostgreSQL uses tsvector/tsquery instead of FTS5
  -- Full-text search can be done with to_tsvector/to_tsquery on tasks table directly
  -- No virtual table needed; add a generated tsvector column instead
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS search_vector tsvector;

  CREATE INDEX IF NOT EXISTS idx_tasks_search ON tasks USING GIN(search_vector);

  -- Function to update search vector
  CREATE OR REPLACE FUNCTION tasks_search_vector_update() RETURNS trigger AS $$
  BEGIN
    NEW.search_vector :=
      setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
      setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
      setweight(to_tsvector('english', COALESCE(NEW.tags, '')), 'C');
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS tasks_search_vector_trigger ON tasks;
  CREATE TRIGGER tasks_search_vector_trigger
    BEFORE INSERT OR UPDATE OF title, description, tags ON tasks
    FOR EACH ROW EXECUTE FUNCTION tasks_search_vector_update();

  -- Backfill existing rows
  UPDATE tasks SET search_vector =
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(description, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(tags, '')), 'C')
  WHERE search_vector IS NULL;

  INSERT INTO _migrations (id) VALUES (15) ON CONFLICT DO NOTHING;
  `,
  // Migration 16: Task spawning — completing a task auto-creates next task from a template
  `
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS spawns_template_id TEXT REFERENCES task_templates(id) ON DELETE SET NULL;
  INSERT INTO _migrations (id) VALUES (16) ON CONFLICT DO NOTHING;
  `,
  // Migration 17: Agent session binding
  `
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS session_id TEXT;
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS working_dir TEXT;
  INSERT INTO _migrations (id) VALUES (17) ON CONFLICT DO NOTHING;
  `,
  // Migration 18: Confidence scores on task completion
  `
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION;
  INSERT INTO _migrations (id) VALUES (18) ON CONFLICT DO NOTHING;
  `,
  // Migration 19: Task provenance — reason and spawned_from_session
  `
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reason TEXT;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS spawned_from_session TEXT;
  INSERT INTO _migrations (id) VALUES (19) ON CONFLICT DO NOTHING;
  `,
  // Migration 20: Handoffs table for agent session handoffs
  `
  CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    summary TEXT NOT NULL,
    completed TEXT,
    in_progress TEXT,
    blockers TEXT,
    next_steps TEXT,
    created_at TIMESTAMPTZ NOT NULL
  );
  INSERT INTO _migrations (id) VALUES (20) ON CONFLICT DO NOTHING;
  `,
  // Migration 21: Task checklists — ordered sub-steps per task
  `
  CREATE TABLE IF NOT EXISTS task_checklists (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    checked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_task_checklists_task ON task_checklists(task_id);
  INSERT INTO _migrations (id) VALUES (21) ON CONFLICT DO NOTHING;
  `,
  // Migration 22: Project sources
  `
  CREATE TABLE IF NOT EXISTS project_sources (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    uri TEXT NOT NULL,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_project_sources_project ON project_sources(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_sources_type ON project_sources(type);
  INSERT INTO _migrations (id) VALUES (22) ON CONFLICT DO NOTHING;
  `,
  // Migration 23: Agent project session locking
  `
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS active_project_id TEXT;
  INSERT INTO _migrations (id) VALUES (23) ON CONFLICT DO NOTHING;
  `,
  // Migration 24: Resource locks table for multi-agent coordination
  `
  CREATE TABLE IF NOT EXISTS resource_locks (
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    lock_type TEXT NOT NULL DEFAULT 'advisory',
    locked_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE(resource_type, resource_id, lock_type)
  );
  CREATE INDEX IF NOT EXISTS idx_resource_locks_type_id ON resource_locks(resource_type, resource_id);
  CREATE INDEX IF NOT EXISTS idx_resource_locks_agent ON resource_locks(agent_id);
  INSERT INTO _migrations (id) VALUES (24) ON CONFLICT DO NOTHING;
  `,
  // Migration 25: Task files — track which files are associated with each task
  `
  CREATE TABLE IF NOT EXISTS task_files (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    agent_id TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_task_files_task ON task_files(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_files_path ON task_files(path);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_files_task_path ON task_files(task_id, path);
  INSERT INTO _migrations (id) VALUES (25) ON CONFLICT DO NOTHING;
  `,
  // Migration 26: Task provenance — who assigned this task and from which project
  `
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_by TEXT;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_from_project TEXT;
  CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by);
  INSERT INTO _migrations (id) VALUES (26) ON CONFLICT DO NOTHING;
  `,
  // Migration 27: Semantic task relationships
  `
  CREATE TABLE IF NOT EXISTS task_relationships (
    id TEXT PRIMARY KEY,
    source_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    target_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL CHECK(relationship_type IN ('related_to', 'conflicts_with', 'similar_to', 'duplicates', 'supersedes', 'modifies_same_file')),
    metadata TEXT DEFAULT '{}',
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (source_task_id != target_task_id)
  );
  CREATE INDEX IF NOT EXISTS idx_task_rel_source ON task_relationships(source_task_id);
  CREATE INDEX IF NOT EXISTS idx_task_rel_target ON task_relationships(target_task_id);
  CREATE INDEX IF NOT EXISTS idx_task_rel_type ON task_relationships(relationship_type);
  INSERT INTO _migrations (id) VALUES (27) ON CONFLICT DO NOTHING;
  `,
  // Migration 28: Knowledge graph edges table
  `
  CREATE TABLE IF NOT EXISTS kg_edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_id, source_type, target_id, target_type, relation_type)
  );
  CREATE INDEX IF NOT EXISTS idx_kg_source ON kg_edges(source_id, source_type);
  CREATE INDEX IF NOT EXISTS idx_kg_target ON kg_edges(target_id, target_type);
  CREATE INDEX IF NOT EXISTS idx_kg_relation ON kg_edges(relation_type);
  INSERT INTO _migrations (id) VALUES (28) ON CONFLICT DO NOTHING;
  `,
  // Migration 29: Agent capabilities for capability-based task routing
  `
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS capabilities TEXT DEFAULT '[]';
  INSERT INTO _migrations (id) VALUES (29) ON CONFLICT DO NOTHING;
  `,
  // Migration 30: Agent soft delete — status column (active/archived)
  `
  ALTER TABLE agents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived'));
  CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
  INSERT INTO _migrations (id) VALUES (30) ON CONFLICT DO NOTHING;
  `,
  // Migration 31: Per-project agent roles
  `
  CREATE TABLE IF NOT EXISTS project_agent_roles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    is_lead BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, agent_id, role)
  );
  CREATE INDEX IF NOT EXISTS idx_project_agent_roles_project ON project_agent_roles(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_agent_roles_agent ON project_agent_roles(agent_id);
  INSERT INTO _migrations (id) VALUES (31) ON CONFLICT DO NOTHING;
  `,
  // Migration 32: Task commits — link git commit SHAs to tasks
  `
  CREATE TABLE IF NOT EXISTS task_commits (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    sha TEXT NOT NULL,
    message TEXT,
    author TEXT,
    files_changed TEXT,
    committed_at TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(task_id, sha)
  );
  CREATE INDEX IF NOT EXISTS idx_task_commits_task ON task_commits(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_commits_sha ON task_commits(sha);
  INSERT INTO _migrations (id) VALUES (32) ON CONFLICT DO NOTHING;
  `,
  // Migration 33: File locks — first-class exclusive locks on file paths
  `
  CREATE TABLE IF NOT EXISTS file_locks (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_file_locks_path ON file_locks(path);
  CREATE INDEX IF NOT EXISTS idx_file_locks_agent ON file_locks(agent_id);
  CREATE INDEX IF NOT EXISTS idx_file_locks_expires ON file_locks(expires_at);
  INSERT INTO _migrations (id) VALUES (33) ON CONFLICT DO NOTHING;
  `,
  // Migration 34: Add started_at to tasks for duration tracking
  `
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS started_at TEXT;
  INSERT INTO _migrations (id) VALUES (34) ON CONFLICT DO NOTHING;
  `,
  // Migration 35: task_type + cost tracking + delegation + retry + SLA + context snapshots + traces + budgets
  `
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type TEXT;
  CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type);
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cost_tokens INTEGER DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS cost_usd DOUBLE PRECISION DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS delegated_from TEXT;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS delegation_depth INTEGER DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 3;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS retry_after TEXT;
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sla_minutes INTEGER;

  CREATE TABLE IF NOT EXISTS task_traces (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id TEXT,
    trace_type TEXT NOT NULL CHECK(trace_type IN ('tool_call','llm_call','error','handoff','custom')),
    name TEXT,
    input_summary TEXT,
    output_summary TEXT,
    duration_ms INTEGER,
    tokens INTEGER,
    cost_usd DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_task_traces_task ON task_traces(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_traces_agent ON task_traces(agent_id);

  CREATE TABLE IF NOT EXISTS context_snapshots (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    snapshot_type TEXT NOT NULL CHECK(snapshot_type IN ('interrupt','complete','handoff','checkpoint')),
    plan_summary TEXT,
    files_open TEXT DEFAULT '[]',
    attempts TEXT DEFAULT '[]',
    blockers TEXT DEFAULT '[]',
    next_steps TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_agent ON context_snapshots(agent_id);
  CREATE INDEX IF NOT EXISTS idx_snapshots_task ON context_snapshots(task_id);

  CREATE TABLE IF NOT EXISTS agent_budgets (
    agent_id TEXT PRIMARY KEY,
    max_concurrent INTEGER DEFAULT 5,
    max_cost_usd DOUBLE PRECISION,
    max_task_minutes INTEGER,
    period_hours INTEGER DEFAULT 24,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO _migrations (id) VALUES (35) ON CONFLICT DO NOTHING;
  `,
  // Migration 36: Feedback table
  `
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  INSERT INTO _migrations (id) VALUES (36) ON CONFLICT DO NOTHING;
  `,
  // Migration 37: Multi-task templates — ordered steps with dependencies per template
  `
  CREATE TABLE IF NOT EXISTS template_tasks (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    template_id TEXT NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    title_pattern TEXT NOT NULL,
    description TEXT,
    priority TEXT DEFAULT 'medium',
    tags TEXT DEFAULT '[]',
    task_type TEXT,
    depends_on_positions TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_template_tasks_template ON template_tasks(template_id);

  INSERT INTO _migrations (id) VALUES (37) ON CONFLICT DO NOTHING;
  `,
  // Migration 38: Template variables — typed variable definitions with defaults
  `
  ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS variables TEXT DEFAULT '[]';
  INSERT INTO _migrations (id) VALUES (38) ON CONFLICT DO NOTHING;
  `,
  // Migration 39: Template features — conditional tasks, composition, versioning
  `
  ALTER TABLE template_tasks ADD COLUMN IF NOT EXISTS condition TEXT;
  ALTER TABLE template_tasks ADD COLUMN IF NOT EXISTS include_template_id TEXT;
  ALTER TABLE task_templates ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

  CREATE TABLE IF NOT EXISTS template_versions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    template_id TEXT NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_template_versions_template ON template_versions(template_id);

  INSERT INTO _migrations (id) VALUES (39) ON CONFLICT DO NOTHING;
  `,
];
