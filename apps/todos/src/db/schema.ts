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
      ssh_address TEXT, is_primary INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureColumn("machines", "ssh_address", "TEXT");
  ensureColumn("machines", "is_primary", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("machines", "archived_at", "TEXT");

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

  // ── Cycles ──
  ensureTable("cycles", `
    CREATE TABLE cycles (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      duration_weeks INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_cycles_project ON cycles(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_cycles_number ON cycles(number)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_cycles_status ON cycles(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_cycles_dates ON cycles(start_date, end_date)");

  ensureColumn("tasks", "cycle_id", "TEXT REFERENCES cycles(id) ON DELETE SET NULL");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_cycle ON tasks(cycle_id) WHERE cycle_id IS NOT NULL");
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
