import { Database } from "bun:sqlite";
import { MIGRATIONS } from "./migrations.js";

export function runMigrations(db: Database): void {
  // Check current migration level
  try {
    const result = db.query("SELECT MAX(id) as max_id FROM _migrations").get() as { max_id: number | null } | null;
    const currentLevel = result?.max_id ?? 0;

    for (let i = currentLevel; i < MIGRATIONS.length; i++) {
      try {
        db.exec(MIGRATIONS[i]!);
      } catch {
        // Migration partially failed (e.g. ALTER TABLE on existing column).
        // ensureSchema below will fix any missing pieces.
      }
    }
  } catch {
    // _migrations table doesn't exist yet, run all migrations
    for (const migration of MIGRATIONS) {
      try {
        db.exec(migration);
      } catch {
        // Same — partial failure handled by ensureSchema
      }
    }
  }

  // Ensure ALL schema elements exist regardless of migration history.
  // This is the safety net: if any migration partially failed, or if the
  // user upgraded from a very old version, this fills in all gaps.
  // It's idempotent — safe to run on every startup.
  ensureSchema(db);
}

export function ensureSchema(db: Database): void {
  // Helper: add a column if it doesn't exist (no-op if it does)
  const ensureColumn = (table: string, column: string, type: string) => {
    try { db.query(`SELECT ${column} FROM ${table} LIMIT 0`).get(); }
    catch { try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); } catch {} }
  };

  // Helper: create a table if it doesn't exist
  const ensureTable = (name: string, sql: string) => {
    try {
      const exists = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
      if (!exists) db.exec(sql);
    } catch {}
  };

  // Helper: create an index if it doesn't exist
  const ensureIndex = (sql: string) => {
    try { db.exec(sql); } catch {}
  };

  // ── Tables ──
  ensureTable("orgs", `
    CREATE TABLE orgs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("agents", `
    CREATE TABLE agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
      role TEXT DEFAULT 'agent', permissions TEXT DEFAULT '["*"]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("task_lists", `
    CREATE TABLE task_lists (
      id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, slug)
    )`);

  ensureTable("plans", `
    CREATE TABLE plans (
      id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      task_list_id TEXT, agent_id TEXT,
      name TEXT NOT NULL, description TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("task_tags", `
    CREATE TABLE task_tags (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      tag TEXT NOT NULL, PRIMARY KEY (task_id, tag)
    )`);

  ensureTable("task_history", `
    CREATE TABLE task_history (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      action TEXT NOT NULL, field TEXT, old_value TEXT, new_value TEXT, agent_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("webhooks", `
    CREATE TABLE webhooks (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]',
      secret TEXT, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("task_templates", `
    CREATE TABLE task_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, title_pattern TEXT NOT NULL,
      description TEXT, priority TEXT DEFAULT 'medium', tags TEXT DEFAULT '[]',
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("template_tasks", `
    CREATE TABLE template_tasks (
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
    )`);

  ensureTable("task_checklists", `
    CREATE TABLE task_checklists (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("project_sources", `
    CREATE TABLE project_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      uri TEXT NOT NULL,
      description TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("task_relationships", `
    CREATE TABLE task_relationships (
      id TEXT PRIMARY KEY,
      source_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      target_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (source_task_id != target_task_id)
    )`);

  ensureTable("kg_edges", `
    CREATE TABLE kg_edges (
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
    )`);

  // Machine-local project paths
  ensureTable("project_machine_paths", `
    CREATE TABLE project_machine_paths (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      machine_id TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, machine_id)
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_machine_paths_project ON project_machine_paths(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_machine_paths_machine ON project_machine_paths(machine_id)");

  // Machine registry
  ensureTable("machines", `
    CREATE TABLE machines (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, hostname TEXT, platform TEXT,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  // ── Columns (ALTER TABLE is not idempotent in SQLite, so check first) ──

  // Projects
  ensureColumn("projects", "task_list_id", "TEXT");
  ensureColumn("projects", "task_prefix", "TEXT");
  ensureColumn("projects", "task_counter", "INTEGER NOT NULL DEFAULT 0");

  // Tasks
  ensureColumn("tasks", "plan_id", "TEXT REFERENCES plans(id) ON DELETE SET NULL");
  ensureColumn("tasks", "task_list_id", "TEXT REFERENCES task_lists(id) ON DELETE SET NULL");
  ensureColumn("tasks", "short_id", "TEXT");
  ensureColumn("tasks", "due_at", "TEXT");
  ensureColumn("tasks", "estimated_minutes", "INTEGER");
  ensureColumn("tasks", "requires_approval", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("tasks", "approved_by", "TEXT");
  ensureColumn("tasks", "approved_at", "TEXT");
  ensureColumn("tasks", "recurrence_rule", "TEXT");
  ensureColumn("tasks", "recurrence_parent_id", "TEXT REFERENCES tasks(id) ON DELETE SET NULL");
  ensureColumn("tasks", "confidence", "REAL");
  ensureColumn("tasks", "reason", "TEXT");
  ensureColumn("tasks", "spawned_from_session", "TEXT");
  ensureColumn("tasks", "assigned_by", "TEXT");
  ensureColumn("tasks", "assigned_from_project", "TEXT");
  ensureColumn("tasks", "started_at", "TEXT");
  ensureColumn("tasks", "task_type", "TEXT");
  ensureColumn("tasks", "cost_tokens", "INTEGER DEFAULT 0");
  ensureColumn("tasks", "cost_usd", "REAL DEFAULT 0");
  ensureColumn("tasks", "delegated_from", "TEXT");
  ensureColumn("tasks", "delegation_depth", "INTEGER DEFAULT 0");
  ensureColumn("tasks", "retry_count", "INTEGER DEFAULT 0");
  ensureColumn("tasks", "max_retries", "INTEGER DEFAULT 3");
  ensureColumn("tasks", "retry_after", "TEXT");
  ensureColumn("tasks", "sla_minutes", "INTEGER");
  ensureColumn("tasks", "archived_at", "TEXT");

  // Agents
  ensureColumn("agents", "role", "TEXT DEFAULT 'agent'");
  ensureColumn("agents", "permissions", 'TEXT DEFAULT \'["*"]\'');
  ensureColumn("agents", "reports_to", "TEXT");
  ensureColumn("agents", "title", "TEXT");
  ensureColumn("agents", "level", "TEXT");
  ensureColumn("agents", "org_id", "TEXT");
  ensureColumn("agents", "capabilities", "TEXT DEFAULT '[]'");

  // Projects
  ensureColumn("projects", "org_id", "TEXT");

  // Plans
  ensureColumn("plans", "task_list_id", "TEXT");
  ensureColumn("plans", "agent_id", "TEXT");

  // Templates
  ensureColumn("task_templates", "variables", "TEXT DEFAULT '[]'");
  ensureColumn("task_templates", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("template_tasks", "condition", "TEXT");
  ensureColumn("template_tasks", "include_template_id", "TEXT");

  ensureTable("template_versions", `
    CREATE TABLE template_versions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      template_id TEXT NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      snapshot TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_template_versions_template ON template_versions(template_id)");

  ensureTable("dispatches", `
    CREATE TABLE dispatches (
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
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_dispatches_status ON dispatches(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_dispatches_scheduled ON dispatches(scheduled_at)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_dispatches_task_list ON dispatches(task_list_id)");

  ensureTable("dispatch_logs", `
    CREATE TABLE dispatch_logs (
      id TEXT PRIMARY KEY,
      dispatch_id TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
      target_window TEXT NOT NULL,
      message TEXT NOT NULL,
      delay_ms INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('sent', 'failed')),
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_dispatch_logs_dispatch ON dispatch_logs(dispatch_id)");

  // Webhooks — scoped subscriptions
  ensureColumn("webhooks", "project_id", "TEXT");
  ensureColumn("webhooks", "task_list_id", "TEXT");
  ensureColumn("webhooks", "agent_id", "TEXT");
  ensureColumn("webhooks", "task_id", "TEXT");

  // Webhook delivery log
  ensureTable("webhook_deliveries", `
    CREATE TABLE webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      payload TEXT NOT NULL,
      status_code INTEGER,
      response TEXT,
      attempt INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event ON webhook_deliveries(event)");

  // Comments
  ensureColumn("task_comments", "type", "TEXT DEFAULT 'comment'");
  ensureColumn("task_comments", "progress_pct", "INTEGER");

  // Machine tracking — machine_id + synced_at on all entity tables
  ensureColumn("projects", "machine_id", "TEXT");
  ensureColumn("projects", "synced_at", "TEXT");
  ensureColumn("tasks", "machine_id", "TEXT");
  ensureColumn("tasks", "synced_at", "TEXT");
  ensureColumn("agents", "machine_id", "TEXT");
  ensureColumn("agents", "synced_at", "TEXT");
  ensureColumn("task_lists", "machine_id", "TEXT");
  ensureColumn("task_lists", "synced_at", "TEXT");
  ensureColumn("plans", "machine_id", "TEXT");
  ensureColumn("plans", "synced_at", "TEXT");
  ensureColumn("task_comments", "machine_id", "TEXT");
  ensureColumn("task_comments", "synced_at", "TEXT");
  ensureColumn("sessions", "machine_id", "TEXT");
  ensureColumn("sessions", "synced_at", "TEXT");
  ensureColumn("task_history", "machine_id", "TEXT");
  ensureColumn("webhooks", "machine_id", "TEXT");
  ensureColumn("webhooks", "synced_at", "TEXT");
  ensureColumn("task_templates", "machine_id", "TEXT");
  ensureColumn("task_templates", "synced_at", "TEXT");
  ensureColumn("orgs", "machine_id", "TEXT");
  ensureColumn("orgs", "synced_at", "TEXT");
  ensureColumn("handoffs", "machine_id", "TEXT");
  ensureColumn("handoffs", "synced_at", "TEXT");
  ensureColumn("task_checklists", "machine_id", "TEXT");
  ensureColumn("project_sources", "machine_id", "TEXT");
  ensureColumn("project_sources", "synced_at", "TEXT");
  ensureColumn("task_files", "machine_id", "TEXT");
  ensureColumn("task_relationships", "machine_id", "TEXT");
  ensureColumn("kg_edges", "machine_id", "TEXT");
  ensureColumn("project_agent_roles", "machine_id", "TEXT");
  ensureColumn("dispatches", "machine_id", "TEXT");
  ensureColumn("dispatches", "synced_at", "TEXT");

  // ── Indexes ──
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_task_list ON tasks(task_list_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_short_id ON tasks(short_id) WHERE short_id IS NOT NULL");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_lists_project ON task_lists(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_lists_slug ON task_lists(slug)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_plans_task_list ON plans(task_list_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_plans_agent ON plans(agent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_history_agent ON task_history(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_parent ON tasks(recurrence_parent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_rule ON tasks(recurrence_rule) WHERE recurrence_rule IS NOT NULL");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_checklists_task ON task_checklists(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_sources_project ON project_sources(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_sources_type ON project_sources(type)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON tasks(assigned_by)");

  // Task relationships indexes
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_rel_source ON task_relationships(source_task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_rel_target ON task_relationships(target_task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_rel_type ON task_relationships(relationship_type)");

  // Template tasks indexes
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_template_tasks_template ON template_tasks(template_id)");

  // Knowledge graph indexes
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_kg_source ON kg_edges(source_id, source_type)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_kg_target ON kg_edges(target_id, target_type)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_kg_relation ON kg_edges(relation_type)");

  // Machine tracking indexes
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_machine ON tasks(machine_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_synced ON tasks(synced_at)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_projects_machine ON projects(machine_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_agents_machine ON agents(machine_id)");

  // Time tracking
  ensureTable("task_time_logs", `
    CREATE TABLE task_time_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_id TEXT,
      started_at TEXT,
      ended_at TEXT,
      minutes INTEGER NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_time_logs_task ON task_time_logs(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_time_logs_agent ON task_time_logs(agent_id)");
  ensureColumn("tasks", "actual_minutes", "INTEGER");

  // Task watchers
  ensureTable("task_watchers", `
    CREATE TABLE task_watchers (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_id, agent_id)
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_watchers_task ON task_watchers(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_watchers_agent ON task_watchers(agent_id)");

  // Cross-project task dependencies
  ensureColumn("task_dependencies", "external_project_id", "TEXT");
  ensureColumn("task_dependencies", "external_task_id", "TEXT");

  // Local agent run dispatcher queue
  ensureTable("agent_runs", `
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      agent_id TEXT,
      adapter TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
      evidence TEXT DEFAULT '{}',
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      claimed_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_agent_runs_adapter ON agent_runs(adapter)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_agent_runs_task ON agent_runs(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_agent_runs_plan ON agent_runs(plan_id)");

  // Git traceability on task_commits
  ensureColumn("task_commits", "branch", "TEXT");
  ensureColumn("task_commits", "pr_url", "TEXT");
  ensureColumn("task_commits", "pr_number", "INTEGER");
  ensureColumn("task_commits", "pr_state", "TEXT");
  ensureColumn("task_commits", "ci_snapshot", "TEXT");
  ensureColumn("task_commits", "release_tag", "TEXT");
  ensureColumn("task_commits", "repo_path", "TEXT");
  ensureColumn("task_commits", "traceability", "TEXT DEFAULT '{}'");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_commits_branch ON task_commits(branch)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_commits_pr ON task_commits(pr_number)");

  // Labels and custom fields
  ensureTable("labels", `
    CREATE TABLE labels (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, name)
    )`);
  ensureTable("task_labels", `
    CREATE TABLE task_labels (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, label_id)
    )`);
  ensureTable("custom_field_definitions", `
    CREATE TABLE custom_field_definitions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      field_type TEXT NOT NULL CHECK(field_type IN ('text', 'number', 'boolean', 'date', 'enum')),
      options TEXT DEFAULT '[]',
      required INTEGER NOT NULL DEFAULT 0,
      default_value TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, slug)
    )`);
  ensureTable("task_custom_field_values", `
    CREATE TABLE task_custom_field_values (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, field_id)
    )`);
  ensureColumn("tasks", "priority_score", "INTEGER");
  ensureColumn("tasks", "priority_reason", "TEXT");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_labels_project ON labels(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_custom_fields_project ON custom_field_definitions(project_id)");

  // Approval gate requests
  ensureTable("task_approval_requests", `
    CREATE TABLE task_approval_requests (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      checkpoint_step TEXT,
      gate_type TEXT NOT NULL CHECK(gate_type IN ('start', 'complete', 'checkpoint', 'plan_step')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
      requested_by TEXT,
      reviewed_by TEXT,
      note TEXT,
      review_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_approval_requests_task ON task_approval_requests(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON task_approval_requests(status)");

  // Task leases
  ensureTable("task_leases", `
    CREATE TABLE task_leases (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      heartbeat_at TEXT,
      steal_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_leases_agent ON task_leases(agent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_leases_expires ON task_leases(expires_at)");

  // Run records — detailed agent execution logs and replay artifacts
  ensureTable("run_records", `
    CREATE TABLE run_records (
      id TEXT PRIMARY KEY,
      agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      agent_id TEXT,
      objective TEXT,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      claimed_task_ids TEXT NOT NULL DEFAULT '[]',
      commands TEXT NOT NULL DEFAULT '[]',
      stdout_summary TEXT,
      stderr_summary TEXT,
      files_touched TEXT NOT NULL DEFAULT '[]',
      verification_results TEXT NOT NULL DEFAULT '[]',
      artifact_ids TEXT NOT NULL DEFAULT '[]',
      status_transitions TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed', 'archived')),
      replay_bundle TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_run_records_agent_run ON run_records(agent_run_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_run_records_agent ON run_records(agent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_run_records_plan ON run_records(plan_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_run_records_status ON run_records(status)");

  // Unified activity log
  ensureTable("activity_log", `
    CREATE TABLE activity_log (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('task', 'project', 'plan', 'agent_run', 'run_record', 'comment', 'session')),
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      field TEXT,
      old_value TEXT,
      new_value TEXT,
      actor_id TEXT,
      session_id TEXT,
      machine_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_activity_log_actor ON activity_log(actor_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at)");
}

export function backfillTaskTags(db: Database): void {
  try {
    const count = db.query("SELECT COUNT(*) as count FROM task_tags").get() as { count: number } | null;
    if (count && count.count > 0) return;
  } catch {
    return;
  }

  try {
    const rows = db.query("SELECT id, tags FROM tasks WHERE tags IS NOT NULL AND tags != '[]'").all() as { id: string; tags: string | null }[];
    if (rows.length === 0) return;

    const insert = db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)");
    for (const row of rows) {
      if (!row.tags) continue;
      let tags: string[] = [];
      try {
        tags = JSON.parse(row.tags) as string[];
      } catch {
        continue;
      }
      for (const tag of tags) {
        if (tag) insert.run(row.id, tag);
      }
    }
  } catch {
    // Best-effort backfill only
  }
}
