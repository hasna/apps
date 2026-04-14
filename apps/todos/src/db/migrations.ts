export const MIGRATIONS = [
  // Migration 1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    working_dir TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_activity TEXT NOT NULL DEFAULT (datetime('now')),
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
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO _migrations (id) VALUES (1);
  `,
  // Migration 2: Add task_list_id to projects
  `
  ALTER TABLE projects ADD COLUMN task_list_id TEXT;
  INSERT OR IGNORE INTO _migrations (id) VALUES (2);
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

  INSERT OR IGNORE INTO _migrations (id) VALUES (3);
  `,
  // Migration 4: Plans table and plan_id on tasks
  `
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_id);
  CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
  ALTER TABLE tasks ADD COLUMN plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);
  INSERT OR IGNORE INTO _migrations (id) VALUES (4);
  `,
  // Migration 5: Agents and task lists
  `
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

  CREATE TABLE IF NOT EXISTS task_lists (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, slug)
  );
  CREATE INDEX IF NOT EXISTS idx_task_lists_project ON task_lists(project_id);
  CREATE INDEX IF NOT EXISTS idx_task_lists_slug ON task_lists(slug);

  ALTER TABLE tasks ADD COLUMN task_list_id TEXT REFERENCES task_lists(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_task_list ON tasks(task_list_id);

  INSERT OR IGNORE INTO _migrations (id) VALUES (5);
  `,
  // Migration 6: Task prefixes and short IDs
  `
  ALTER TABLE projects ADD COLUMN task_prefix TEXT;
  ALTER TABLE projects ADD COLUMN task_counter INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE tasks ADD COLUMN short_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_tasks_short_id ON tasks(short_id) WHERE short_id IS NOT NULL;

  INSERT OR IGNORE INTO _migrations (id) VALUES (6);
  `,
  // Migration 7: Add due_at column to tasks
  `
  ALTER TABLE tasks ADD COLUMN due_at TEXT;
  CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at);
  INSERT OR IGNORE INTO _migrations (id) VALUES (7);
  `,
  // Migration 8: Add role column to agents
  `
  ALTER TABLE agents ADD COLUMN role TEXT DEFAULT 'agent';
  INSERT OR IGNORE INTO _migrations (id) VALUES (8);
  `,
  // Migration 9: Add task_list_id and agent_id to plans
  `
  ALTER TABLE plans ADD COLUMN task_list_id TEXT REFERENCES task_lists(id) ON DELETE SET NULL;
  ALTER TABLE plans ADD COLUMN agent_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_plans_task_list ON plans(task_list_id);
  CREATE INDEX IF NOT EXISTS idx_plans_agent ON plans(agent_id);
  INSERT OR IGNORE INTO _migrations (id) VALUES (9);
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_history_agent ON task_history(agent_id);

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    secret TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  ALTER TABLE tasks ADD COLUMN estimated_minutes INTEGER;
  ALTER TABLE tasks ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN approved_by TEXT;
  ALTER TABLE tasks ADD COLUMN approved_at TEXT;

  ALTER TABLE agents ADD COLUMN permissions TEXT DEFAULT '["*"]';

  INSERT OR IGNORE INTO _migrations (id) VALUES (10);
  `,
  // Migration 11: Org chart — agent hierarchy
  `
  ALTER TABLE agents ADD COLUMN reports_to TEXT;
  ALTER TABLE agents ADD COLUMN title TEXT;
  ALTER TABLE agents ADD COLUMN level TEXT;
  INSERT OR IGNORE INTO _migrations (id) VALUES (11);
  `,
  // Migration 12: Orgs
  `
  CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE agents ADD COLUMN org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL;
  ALTER TABLE projects ADD COLUMN org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL;
  INSERT OR IGNORE INTO _migrations (id) VALUES (12);
  `,
  // Migration 13: Recurrence fields
  `
  ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT;
  ALTER TABLE tasks ADD COLUMN recurrence_parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_parent ON tasks(recurrence_parent_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_rule ON tasks(recurrence_rule) WHERE recurrence_rule IS NOT NULL;
  INSERT OR IGNORE INTO _migrations (id) VALUES (13);
  `,
  // Migration 14: Progress tracking on comments
  `
  ALTER TABLE task_comments ADD COLUMN type TEXT DEFAULT 'comment' CHECK(type IN ('comment', 'progress', 'note'));
  ALTER TABLE task_comments ADD COLUMN progress_pct INTEGER CHECK(progress_pct IS NULL OR (progress_pct >= 0 AND progress_pct <= 100));
  INSERT OR IGNORE INTO _migrations (id) VALUES (14);
  `,
  // Migration 15: FTS5 full-text search index
  `
  CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
    task_id UNINDEXED,
    title,
    description,
    tags,
    tokenize='unicode61 remove_diacritics 2'
  );

  INSERT INTO tasks_fts(rowid, task_id, title, description, tags)
  SELECT t.rowid, t.id, t.title, COALESCE(t.description, ''),
    COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM task_tags WHERE task_id = t.id), '')
  FROM tasks t;

  CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON tasks BEGIN
    INSERT INTO tasks_fts(rowid, task_id, title, description, tags)
    VALUES (new.rowid, new.id, new.title, COALESCE(new.description, ''), '');
  END;

  CREATE TRIGGER IF NOT EXISTS tasks_fts_ad AFTER DELETE ON tasks BEGIN
    DELETE FROM tasks_fts WHERE rowid = old.rowid;
  END;

  CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE OF title, description ON tasks BEGIN
    DELETE FROM tasks_fts WHERE rowid = old.rowid;
    INSERT INTO tasks_fts(rowid, task_id, title, description, tags)
    SELECT new.rowid, new.id, new.title, COALESCE(new.description, ''),
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM task_tags WHERE task_id = new.id), '');
  END;

  CREATE TRIGGER IF NOT EXISTS task_tags_fts_ai AFTER INSERT ON task_tags BEGIN
    DELETE FROM tasks_fts WHERE rowid = (SELECT rowid FROM tasks WHERE id = new.task_id);
    INSERT INTO tasks_fts(rowid, task_id, title, description, tags)
    SELECT t.rowid, t.id, t.title, COALESCE(t.description, ''),
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM task_tags WHERE task_id = t.id), '')
    FROM tasks t WHERE t.id = new.task_id;
  END;

  CREATE TRIGGER IF NOT EXISTS task_tags_fts_ad AFTER DELETE ON task_tags BEGIN
    DELETE FROM tasks_fts WHERE rowid = (SELECT rowid FROM tasks WHERE id = old.task_id);
    INSERT INTO tasks_fts(rowid, task_id, title, description, tags)
    SELECT t.rowid, t.id, t.title, COALESCE(t.description, ''),
      COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM task_tags WHERE task_id = t.id), '')
    FROM tasks t WHERE t.id = old.task_id;
  END;

  INSERT OR IGNORE INTO _migrations (id) VALUES (15);
  `,
  // Migration 16: Task spawning — completing a task auto-creates next task from a template
  `
  ALTER TABLE tasks ADD COLUMN spawns_template_id TEXT REFERENCES task_templates(id) ON DELETE SET NULL;
  INSERT OR IGNORE INTO _migrations (id) VALUES (16);
  `,
  // Migration 17: Agent session binding — prevents name squatting across sessions
  `
  ALTER TABLE agents ADD COLUMN session_id TEXT;
  ALTER TABLE agents ADD COLUMN working_dir TEXT;
  INSERT OR IGNORE INTO _migrations (id) VALUES (17);
  `,
  // Migration 18: Confidence scores on task completion
  `
  ALTER TABLE tasks ADD COLUMN confidence REAL;
  INSERT OR IGNORE INTO _migrations (id) VALUES (18);
  `,
  // Migration 19: Task provenance — reason and spawned_from_session
  `
  ALTER TABLE tasks ADD COLUMN reason TEXT;
  ALTER TABLE tasks ADD COLUMN spawned_from_session TEXT;
  INSERT OR IGNORE INTO _migrations (id) VALUES (19);
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
    created_at TEXT NOT NULL
  );
  INSERT OR IGNORE INTO _migrations (id) VALUES (20);
  `,
  // Migration 21: Task checklists — ordered sub-steps per task
  `
  CREATE TABLE IF NOT EXISTS task_checklists (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    checked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_task_checklists_task ON task_checklists(task_id);
  INSERT OR IGNORE INTO _migrations (id) VALUES (21);
  `,
  // Migration 22: Project sources — named data sources (S3, GDrive, local, etc.) per project
  `
  CREATE TABLE IF NOT EXISTS project_sources (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    uri TEXT NOT NULL,
    description TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_project_sources_project ON project_sources(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_sources_type ON project_sources(type);
  INSERT OR IGNORE INTO _migrations (id) VALUES (22);
  `,
  // Migration 23: Agent project session locking
  `
  ALTER TABLE agents ADD COLUMN active_project_id TEXT;
  INSERT OR IGNORE INTO _migrations (id) VALUES (23);
  `,
  // Migration 24: Resource locks table for multi-agent coordination
  `
  CREATE TABLE IF NOT EXISTS resource_locks (
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    lock_type TEXT NOT NULL DEFAULT 'advisory',
    locked_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    UNIQUE(resource_type, resource_id, lock_type)
  );
  CREATE INDEX IF NOT EXISTS idx_resource_locks_type_id ON resource_locks(resource_type, resource_id);
  CREATE INDEX IF NOT EXISTS idx_resource_locks_agent ON resource_locks(agent_id);
  INSERT OR IGNORE INTO _migrations (id) VALUES (24);
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_task_files_task ON task_files(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_files_path ON task_files(path);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_files_task_path ON task_files(task_id, path);
  INSERT OR IGNORE INTO _migrations (id) VALUES (25);
  `,
  // Migration 26: Task provenance — who assigned this task and from which project
  `
  ALTER TABLE tasks ADD COLUMN assigned_by TEXT;
  ALTER TABLE tasks ADD COLUMN assigned_from_project TEXT;
  CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by);
  INSERT OR IGNORE INTO _migrations (id) VALUES (26);
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (source_task_id != target_task_id)
  );
  CREATE INDEX IF NOT EXISTS idx_task_rel_source ON task_relationships(source_task_id);
  CREATE INDEX IF NOT EXISTS idx_task_rel_target ON task_relationships(target_task_id);
  CREATE INDEX IF NOT EXISTS idx_task_rel_type ON task_relationships(relationship_type);
  INSERT OR IGNORE INTO _migrations (id) VALUES (27);
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
    weight REAL NOT NULL DEFAULT 1.0,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_id, source_type, target_id, target_type, relation_type)
  );
  CREATE INDEX IF NOT EXISTS idx_kg_source ON kg_edges(source_id, source_type);
  CREATE INDEX IF NOT EXISTS idx_kg_target ON kg_edges(target_id, target_type);
  CREATE INDEX IF NOT EXISTS idx_kg_relation ON kg_edges(relation_type);
  INSERT OR IGNORE INTO _migrations (id) VALUES (28);
  `,
  // Migration 29: Agent capabilities for capability-based task routing
  `
  ALTER TABLE agents ADD COLUMN capabilities TEXT DEFAULT '[]';
  INSERT OR IGNORE INTO _migrations (id) VALUES (29);
  `,
  // Migration 30: Agent soft delete — status column (active/archived)
  `
  ALTER TABLE agents ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived'));
  CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
  INSERT OR IGNORE INTO _migrations (id) VALUES (30);
  `,
  // Migration 31: Per-project agent roles — override/extend global agent roles per project
  `
  CREATE TABLE IF NOT EXISTS project_agent_roles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    is_lead INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, agent_id, role)
  );
  CREATE INDEX IF NOT EXISTS idx_project_agent_roles_project ON project_agent_roles(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_agent_roles_agent ON project_agent_roles(agent_id);
  INSERT OR IGNORE INTO _migrations (id) VALUES (31);
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(task_id, sha)
  );
  CREATE INDEX IF NOT EXISTS idx_task_commits_task ON task_commits(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_commits_sha ON task_commits(sha);
  INSERT OR IGNORE INTO _migrations (id) VALUES (32);
  `,
  // Migration 33: File locks — first-class exclusive locks on file paths
  `
  CREATE TABLE IF NOT EXISTS file_locks (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_file_locks_path ON file_locks(path);
  CREATE INDEX IF NOT EXISTS idx_file_locks_agent ON file_locks(agent_id);
  CREATE INDEX IF NOT EXISTS idx_file_locks_expires ON file_locks(expires_at);
  INSERT OR IGNORE INTO _migrations (id) VALUES (33);
  `,
  // Migration 34: Add started_at to tasks for duration tracking
  `
  ALTER TABLE tasks ADD COLUMN started_at TEXT;
  INSERT OR IGNORE INTO _migrations (id) VALUES (34);
  `,
  // Migration 35: task_type + cost tracking + delegation + retry + SLA + context snapshots + traces + budgets
  `
  ALTER TABLE tasks ADD COLUMN task_type TEXT;
  CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type);
  ALTER TABLE tasks ADD COLUMN cost_tokens INTEGER DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN cost_usd REAL DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN delegated_from TEXT;
  ALTER TABLE tasks ADD COLUMN delegation_depth INTEGER DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN retry_count INTEGER DEFAULT 0;
  ALTER TABLE tasks ADD COLUMN max_retries INTEGER DEFAULT 3;
  ALTER TABLE tasks ADD COLUMN retry_after TEXT;
  ALTER TABLE tasks ADD COLUMN sla_minutes INTEGER;

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
    cost_usd REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_agent ON context_snapshots(agent_id);
  CREATE INDEX IF NOT EXISTS idx_snapshots_task ON context_snapshots(task_id);

  CREATE TABLE IF NOT EXISTS agent_budgets (
    agent_id TEXT PRIMARY KEY,
    max_concurrent INTEGER DEFAULT 5,
    max_cost_usd REAL,
    max_task_minutes INTEGER,
    period_hours INTEGER DEFAULT 24,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO _migrations (id) VALUES (35);
  `,
  // Migration 36: feedback table
  `
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO _migrations (id) VALUES (36);
  `,
  // Migration 37: Multi-task templates — ordered steps with dependencies per template
  `
  CREATE TABLE IF NOT EXISTS template_tasks (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    template_id TEXT NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    title_pattern TEXT NOT NULL,
    description TEXT,
    priority TEXT DEFAULT 'medium',
    tags TEXT DEFAULT '[]',
    task_type TEXT,
    depends_on_positions TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_template_tasks_template ON template_tasks(template_id);

  INSERT OR IGNORE INTO _migrations (id) VALUES (37);
  `,
  // Migration 38: Template variables — typed variable definitions with defaults
  `
  ALTER TABLE task_templates ADD COLUMN variables TEXT DEFAULT '[]';
  INSERT OR IGNORE INTO _migrations (id) VALUES (38);
  `,
  // Migration 39: Template features — conditional tasks, composition, versioning
  `
  ALTER TABLE template_tasks ADD COLUMN condition TEXT;
  ALTER TABLE template_tasks ADD COLUMN include_template_id TEXT;
  ALTER TABLE task_templates ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

  CREATE TABLE IF NOT EXISTS template_versions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    template_id TEXT NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_template_versions_template ON template_versions(template_id);

  INSERT OR IGNORE INTO _migrations (id) VALUES (39);
  `,
  // Migration 40: Dispatch — send tasks/task-lists to tmux windows
  `
  CREATE TABLE IF NOT EXISTS dispatches (
    id TEXT PRIMARY KEY,
    title TEXT,
    target_window TEXT NOT NULL,
    task_ids TEXT NOT NULL DEFAULT '[]',
    task_list_id TEXT REFERENCES task_lists(id) ON DELETE SET NULL,
    message TEXT,
    delay_ms INTEGER,
    scheduled_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'cancelled')),
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_dispatches_status ON dispatches(status);
  CREATE INDEX IF NOT EXISTS idx_dispatches_scheduled ON dispatches(scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_dispatches_task_list ON dispatches(task_list_id);

  CREATE TABLE IF NOT EXISTS dispatch_logs (
    id TEXT PRIMARY KEY,
    dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
    target_window TEXT NOT NULL,
    message TEXT NOT NULL,
    delay_ms INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('sent', 'failed')),
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_dispatch_logs_dispatch ON dispatch_logs(dispatch_id);

  INSERT OR IGNORE INTO _migrations (id) VALUES (40);
  `,
  // Migration 41: Machine registry + machine_id/synced_at on all entity tables
  `
  CREATE TABLE IF NOT EXISTS machines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    hostname TEXT,
    platform TEXT,
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  ALTER TABLE projects ADD COLUMN machine_id TEXT;
  ALTER TABLE projects ADD COLUMN synced_at TEXT;
  ALTER TABLE tasks ADD COLUMN machine_id TEXT;
  ALTER TABLE tasks ADD COLUMN synced_at TEXT;
  ALTER TABLE agents ADD COLUMN machine_id TEXT;
  ALTER TABLE agents ADD COLUMN synced_at TEXT;
  ALTER TABLE task_lists ADD COLUMN machine_id TEXT;
  ALTER TABLE task_lists ADD COLUMN synced_at TEXT;
  ALTER TABLE plans ADD COLUMN machine_id TEXT;
  ALTER TABLE plans ADD COLUMN synced_at TEXT;
  ALTER TABLE task_comments ADD COLUMN machine_id TEXT;
  ALTER TABLE task_comments ADD COLUMN synced_at TEXT;
  ALTER TABLE sessions ADD COLUMN machine_id TEXT;
  ALTER TABLE sessions ADD COLUMN synced_at TEXT;
  ALTER TABLE task_history ADD COLUMN machine_id TEXT;
  ALTER TABLE webhooks ADD COLUMN machine_id TEXT;
  ALTER TABLE webhooks ADD COLUMN synced_at TEXT;
  ALTER TABLE task_templates ADD COLUMN machine_id TEXT;
  ALTER TABLE task_templates ADD COLUMN synced_at TEXT;
  ALTER TABLE orgs ADD COLUMN machine_id TEXT;
  ALTER TABLE orgs ADD COLUMN synced_at TEXT;
  ALTER TABLE handoffs ADD COLUMN machine_id TEXT;
  ALTER TABLE handoffs ADD COLUMN synced_at TEXT;
  ALTER TABLE task_checklists ADD COLUMN machine_id TEXT;
  ALTER TABLE project_sources ADD COLUMN machine_id TEXT;
  ALTER TABLE project_sources ADD COLUMN synced_at TEXT;
  ALTER TABLE task_files ADD COLUMN machine_id TEXT;
  ALTER TABLE task_relationships ADD COLUMN machine_id TEXT;
  ALTER TABLE kg_edges ADD COLUMN machine_id TEXT;
  ALTER TABLE project_agent_roles ADD COLUMN machine_id TEXT;
  ALTER TABLE dispatches ADD COLUMN machine_id TEXT;
  ALTER TABLE dispatches ADD COLUMN synced_at TEXT;

  CREATE INDEX IF NOT EXISTS idx_tasks_machine ON tasks(machine_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_synced ON tasks(synced_at);
  CREATE INDEX IF NOT EXISTS idx_projects_machine ON projects(machine_id);
  CREATE INDEX IF NOT EXISTS idx_agents_machine ON agents(machine_id);

  INSERT OR IGNORE INTO _migrations (id) VALUES (41);
  `,
  // Migration 42: Machine-local project paths
  `
  CREATE TABLE IF NOT EXISTS project_machine_paths (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    machine_id TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, machine_id)
  );
  CREATE INDEX IF NOT EXISTS idx_project_machine_paths_project ON project_machine_paths(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_machine_paths_machine ON project_machine_paths(machine_id);
  INSERT OR IGNORE INTO _migrations (id) VALUES (42);
  `,
  // Migration 43: Task archiving — soft-archive completed/failed tasks
  `
  ALTER TABLE tasks ADD COLUMN archived_at TEXT;
  CREATE INDEX IF NOT EXISTS idx_tasks_archived ON tasks(archived_at) WHERE archived_at IS NOT NULL;
  INSERT OR IGNORE INTO _migrations (id) VALUES (43);
  `,
  // Migration 44: Per-machine short_id uniqueness — short_ids are human-readable local labels,
  // not global identifiers. Canonical task identity is the nanoid UUID. Drop the global unique
  // constraint and replace with per-machine uniqueness so tasks synced from different machines
  // don't collide. New tasks no longer receive short_ids (createTask sets short_id = null).
  `
  DROP INDEX IF EXISTS idx_tasks_short_id;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_short_id ON tasks(short_id, machine_id) WHERE short_id IS NOT NULL AND machine_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_tasks_short_id_lookup ON tasks(short_id) WHERE short_id IS NOT NULL;
  INSERT OR IGNORE INTO _migrations (id) VALUES (44);
  `,
  // Migration 45: Time tracking — log time spent on tasks and actual vs estimated reporting
  `
  CREATE TABLE IF NOT EXISTS task_time_logs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id TEXT,
    started_at TEXT,
    ended_at TEXT,
    minutes INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_task_time_logs_task ON task_time_logs(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_time_logs_agent ON task_time_logs(agent_id);
  ALTER TABLE tasks ADD COLUMN actual_minutes INTEGER;
  INSERT OR IGNORE INTO _migrations (id) VALUES (45);
  `,
  // Migration 46: Task watchers — per-task agent subscriptions
  `
  CREATE TABLE IF NOT EXISTS task_watchers (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(task_id, agent_id)
  );
  CREATE INDEX IF NOT EXISTS idx_task_watchers_task ON task_watchers(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_watchers_agent ON task_watchers(agent_id);
  INSERT OR IGNORE INTO _migrations (id) VALUES (46);
  `,
  // Migration 47: Cross-project task references — depends_on supports external task IDs
  `
  ALTER TABLE task_dependencies ADD COLUMN external_project_id TEXT;
  ALTER TABLE task_dependencies ADD COLUMN external_task_id TEXT;
  INSERT OR IGNORE INTO _migrations (id) VALUES (47);
  `,
  // Migration 48: Task runner checkpoints and heartbeats
  `
  CREATE TABLE IF NOT EXISTS task_checkpoints (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id TEXT,
    step TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
    data TEXT DEFAULT '{}',
    error TEXT,
    attempt INTEGER NOT NULL DEFAULT 1,
    max_attempts INTEGER NOT NULL DEFAULT 1,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_task_checkpoints_task ON task_checkpoints(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_checkpoints_status ON task_checkpoints(status);

  CREATE TABLE IF NOT EXISTS task_heartbeats (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id TEXT,
    step TEXT,
    message TEXT,
    progress REAL CHECK(progress >= 0 AND progress <= 1),
    meta TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_task_heartbeats_task ON task_heartbeats(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_heartbeats_agent ON task_heartbeats(agent_id);

  ALTER TABLE tasks ADD COLUMN runner_id TEXT;
  ALTER TABLE tasks ADD COLUMN runner_started_at TEXT;
  ALTER TABLE tasks ADD COLUMN runner_completed_at TEXT;
  ALTER TABLE tasks ADD COLUMN current_step TEXT;
  ALTER TABLE tasks ADD COLUMN total_steps INTEGER;
  INSERT OR IGNORE INTO _migrations (id) VALUES (48);
  `,
];
