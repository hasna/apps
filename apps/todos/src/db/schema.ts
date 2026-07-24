import { Database } from "bun:sqlite";
import { MIGRATIONS } from "./migrations.js";

export function runMigrations(db: Database): void {
  let strictMigrationFailure: unknown = null;
  const executeMigration = (migration: string, index: number): void => {
    try {
      db.exec(migration);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Migration was not running in an explicit transaction.
      }
      if (index + 1 >= 68) strictMigrationFailure = error;
      // Older migrations remain best-effort because ensureSchema repairs them.
    }
  };
  // Check current migration level
  try {
    const result = db.query("SELECT MAX(id) as max_id FROM _migrations").get() as { max_id: number | null } | null;
    const currentLevel = result?.max_id ?? 0;

    for (let i = currentLevel; i < MIGRATIONS.length; i++) {
      executeMigration(MIGRATIONS[i]!, i);
    }
  } catch {
    // _migrations table doesn't exist yet, run all migrations
    for (const [index, migration] of MIGRATIONS.entries()) {
      executeMigration(migration, index);
    }
  }
  if (strictMigrationFailure) throw strictMigrationFailure;

  // Ensure ALL schema elements exist regardless of migration history.
  // This is the safety net: if any migration partially failed, or if the
  // user upgraded from a very old version, this fills in all gaps.
  // It's idempotent — safe to run on every startup.
  ensureSchema(db);
}

function planSlugBase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plan";
}

function backfillPlanSlugs(db: Database): void {
  try {
    const rows = db
      .query("SELECT id, project_id, name, slug FROM plans ORDER BY created_at ASC, id ASC")
      .all() as Array<{ id: string; project_id: string | null; name: string; slug: string | null }>;
    const used = new Set<string>();
    for (const row of rows) {
      const scope = row.project_id ?? "__global__";
      const base = planSlugBase(row.slug || row.name);
      let candidate = base;
      let suffix = 2;
      while (used.has(`${scope}:${candidate}`)) {
        candidate = `${base}-${suffix}`;
        suffix += 1;
      }
      used.add(`${scope}:${candidate}`);
      if (row.slug !== candidate) {
        db.run("UPDATE plans SET slug = ? WHERE id = ?", [candidate, row.id]);
      }
    }
  } catch {}

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
      id TEXT PRIMARY KEY, slug TEXT,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
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

  ensureTable("tags", `
    CREATE TABLE tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("task_dependencies", `
    CREATE TABLE task_dependencies (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      external_project_id TEXT,
      external_task_id TEXT,
      PRIMARY KEY (task_id, depends_on),
      CHECK (task_id != depends_on)
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on)");

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

  ensureTable("handoffs", `
    CREATE TABLE handoffs (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      session_id TEXT,
      summary TEXT NOT NULL,
      completed TEXT,
      in_progress TEXT,
      blockers TEXT,
      next_steps TEXT,
      task_ids TEXT,
      relevant_files TEXT,
      run_ids TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureTable("handoff_acknowledgements", `
    CREATE TABLE handoff_acknowledgements (
      handoff_id TEXT NOT NULL REFERENCES handoffs(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      acknowledged_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (handoff_id, agent_id)
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_handoff_acks_agent ON handoff_acknowledgements(agent_id, acknowledged_at)");

  ensureTable("saved_search_views", `
    CREATE TABLE saved_search_views (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      scope TEXT NOT NULL DEFAULT 'tasks' CHECK(scope IN ('all', 'tasks', 'projects', 'plans', 'runs', 'comments')),
      filters TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_saved_search_views_scope ON saved_search_views(scope)");

  ensureTable("context_snapshots", `
    CREATE TABLE context_snapshots (
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
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_snapshots_agent ON context_snapshots(agent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_snapshots_task ON context_snapshots(task_id)");

  ensureTable("project_knowledge_records", `
    CREATE TABLE project_knowledge_records (
      id TEXT PRIMARY KEY,
      record_type TEXT NOT NULL CHECK(record_type IN ('decision','architecture_note','tradeoff','context_snapshot')),
      title TEXT NOT NULL,
      content TEXT,
      decision TEXT,
      rationale TEXT,
      alternatives TEXT DEFAULT '[]',
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      agent_id TEXT,
      snapshot_id TEXT REFERENCES context_snapshots(id) ON DELETE SET NULL,
      tags TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_knowledge_type ON project_knowledge_records(record_type)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_knowledge_project ON project_knowledge_records(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_knowledge_task ON project_knowledge_records(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_knowledge_plan ON project_knowledge_records(plan_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_knowledge_agent ON project_knowledge_records(agent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_knowledge_snapshot ON project_knowledge_records(snapshot_id)");

  ensureTable("project_risks", `
    CREATE TABLE project_risks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','mitigating','resolved','accepted')),
      severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low','medium','high','critical')),
      probability TEXT NOT NULL DEFAULT 'medium' CHECK(probability IN ('low','medium','high')),
      owner TEXT,
      mitigation TEXT,
      due_at TEXT,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      tags TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_risks_status ON project_risks(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_risks_severity ON project_risks(severity)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_risks_project ON project_risks(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_risks_plan ON project_risks(plan_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_risks_task ON project_risks(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_project_risks_due ON project_risks(due_at)");

  ensureTable("local_retrospectives", `
    CREATE TABLE local_retrospectives (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('project','plan')),
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      agent_id TEXT,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_local_retrospectives_project ON local_retrospectives(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_local_retrospectives_plan ON local_retrospectives(plan_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_local_retrospectives_agent ON local_retrospectives(agent_id)");

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

  ensureTable("task_git_refs", `
    CREATE TABLE task_git_refs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      ref_type TEXT NOT NULL CHECK(ref_type IN ('branch', 'pull_request')),
      name TEXT NOT NULL,
      url TEXT,
      provider TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_id, ref_type, name)
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_git_refs_task ON task_git_refs(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_git_refs_lookup ON task_git_refs(ref_type, name)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_git_refs_url ON task_git_refs(url)");

  ensureTable("task_commits", `
    CREATE TABLE task_commits (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      sha TEXT NOT NULL,
      message TEXT,
      author TEXT,
      files_changed TEXT,
      committed_at TEXT,
      branch TEXT,
      pr_url TEXT,
      pr_number INTEGER,
      pr_state TEXT,
      ci_snapshot TEXT,
      release_tag TEXT,
      repo_path TEXT,
      traceability TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_id, sha)
    )`);
  ensureColumn("task_commits", "branch", "TEXT");
  ensureColumn("task_commits", "pr_url", "TEXT");
  ensureColumn("task_commits", "pr_number", "INTEGER");
  ensureColumn("task_commits", "pr_state", "TEXT");
  ensureColumn("task_commits", "ci_snapshot", "TEXT");
  ensureColumn("task_commits", "release_tag", "TEXT");
  ensureColumn("task_commits", "repo_path", "TEXT");
  ensureColumn("task_commits", "traceability", "TEXT DEFAULT '{}'");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_commits_task ON task_commits(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_commits_sha ON task_commits(sha)");

  ensureTable("task_verifications", `
    CREATE TABLE task_verifications (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      command TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('passed', 'failed', 'unknown')),
      output_summary TEXT,
      artifact_path TEXT,
      agent_id TEXT,
      run_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_verifications_task ON task_verifications(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_verifications_status ON task_verifications(status)");

  ensureTable("artifacts", `
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      name TEXT,
      storage_mode TEXT NOT NULL DEFAULT 'copy',
      source_path TEXT,
      local_path TEXT,
      content_hash TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      redaction_status TEXT NOT NULL DEFAULT 'none',
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_artifacts_entity ON artifacts(entity_type, entity_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_artifacts_deleted ON artifacts(deleted_at)");

  ensureTable("task_runs", `
    CREATE TABLE task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_id TEXT,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
      summary TEXT,
      metadata TEXT DEFAULT '{}',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_runs_agent ON task_runs(agent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_runs_started ON task_runs(started_at)");

  ensureTable("task_run_events", `
    CREATE TABLE task_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK(event_type IN ('started', 'progress', 'claim', 'comment', 'command', 'file', 'artifact', 'completed', 'failed', 'cancelled')),
      message TEXT,
      data TEXT DEFAULT '{}',
      agent_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_run_events_run ON task_run_events(run_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_run_events_task ON task_run_events(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_run_events_type ON task_run_events(event_type)");

  ensureTable("task_run_commands", `
    CREATE TABLE task_run_commands (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      command TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('passed', 'failed', 'unknown')),
      exit_code INTEGER,
      output_summary TEXT,
      artifact_path TEXT,
      agent_id TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_run_commands_run ON task_run_commands(run_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_run_commands_task ON task_run_commands(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_run_commands_status ON task_run_commands(status)");

  ensureTable("task_run_artifacts", `
    CREATE TABLE task_run_artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      artifact_type TEXT,
      description TEXT,
      size_bytes INTEGER,
      sha256 TEXT,
      metadata TEXT DEFAULT '{}',
      agent_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_run_artifacts_run ON task_run_artifacts(run_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_run_artifacts_task ON task_run_artifacts(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_run_artifacts_path ON task_run_artifacts(path)");

  ensureTable("task_run_transactions", `
    CREATE TABLE task_run_transactions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL,
      key TEXT NOT NULL,
      loop_id TEXT,
      loop_run_id TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_id, key)
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_run_transactions_task_key ON task_run_transactions(task_id, key)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_run_transactions_key ON task_run_transactions(key)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_run_transactions_run ON task_run_transactions(run_id)");

  ensureTable("task_findings", `
    CREATE TABLE task_findings (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL,
      fingerprint TEXT NOT NULL,
      title TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low', 'medium', 'high', 'critical')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'ignored')),
      source TEXT,
      summary TEXT,
      artifact_path TEXT,
      metadata TEXT DEFAULT '{}',
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_id, fingerprint)
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_findings_task ON task_findings(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_findings_run ON task_findings(run_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_findings_status ON task_findings(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_findings_source ON task_findings(source)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_findings_fingerprint ON task_findings(fingerprint)");

  ensureTable("inbox_items", `
    CREATE TABLE inbox_items (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('pasted_error', 'ci_log', 'git_context', 'github_issue', 'file', 'other')),
      source_name TEXT,
      source_url TEXT,
      title TEXT NOT NULL,
      body TEXT,
      fingerprint TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'triaged' CHECK(status IN ('new', 'triaged', 'ignored')),
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_inbox_items_task ON inbox_items(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_inbox_items_source ON inbox_items(source_type, source_name)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_inbox_items_status ON inbox_items(status)");

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

  // Generation registry for DB-enforced uniqueness of new/changed canonical
  // slugs. Do not backfill: legacy duplicate rows must remain readable and be
  // explicitly reconciled instead of making startup fail or rewriting history.
  ensureTable("canonical_slug_claims", `
    CREATE TABLE canonical_slug_claims (
      kind TEXT NOT NULL CHECK(kind IN ('project', 'task_list')),
      scope_key TEXT NOT NULL,
      slug TEXT NOT NULL,
      object_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (kind, scope_key, slug)
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_canonical_slug_claims_object ON canonical_slug_claims(kind, object_id)");
  ensureColumn("projects", "task_list_id", "TEXT");
  db.exec(`CREATE TRIGGER IF NOT EXISTS claim_project_canonical_slug_insert
    BEFORE INSERT ON projects
    WHEN NEW.task_list_id IS NOT NULL AND NEW.task_list_id <> ''
    BEGIN
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM projects WHERE id <> NEW.id AND task_list_id = NEW.task_list_id
      ) THEN RAISE(ABORT, 'PROJECT_SLUG_CONFLICT') END;
      INSERT OR IGNORE INTO canonical_slug_claims(kind, scope_key, slug, object_id)
        VALUES ('project', 'global', NEW.task_list_id, NEW.id);
      SELECT CASE WHEN (
        SELECT object_id FROM canonical_slug_claims
        WHERE kind = 'project' AND scope_key = 'global' AND slug = NEW.task_list_id
      ) <> NEW.id THEN RAISE(ABORT, 'PROJECT_SLUG_CONFLICT') END;
    END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS claim_project_canonical_slug_update
    BEFORE UPDATE OF task_list_id ON projects
    WHEN NEW.task_list_id IS NOT OLD.task_list_id
    BEGIN
      DELETE FROM canonical_slug_claims WHERE kind = 'project' AND object_id = NEW.id;
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM projects WHERE id <> NEW.id AND task_list_id = NEW.task_list_id
      ) AND NEW.task_list_id IS NOT NULL AND NEW.task_list_id <> ''
        THEN RAISE(ABORT, 'PROJECT_SLUG_CONFLICT') END;
      INSERT OR IGNORE INTO canonical_slug_claims(kind, scope_key, slug, object_id)
        SELECT 'project', 'global', NEW.task_list_id, NEW.id
        WHERE NEW.task_list_id IS NOT NULL AND NEW.task_list_id <> '';
      SELECT CASE WHEN NEW.task_list_id IS NOT NULL AND NEW.task_list_id <> '' AND (
        SELECT object_id FROM canonical_slug_claims
        WHERE kind = 'project' AND scope_key = 'global' AND slug = NEW.task_list_id
      ) <> NEW.id THEN RAISE(ABORT, 'PROJECT_SLUG_CONFLICT') END;
    END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS release_project_canonical_slug_delete
    AFTER DELETE ON projects
    BEGIN
      DELETE FROM canonical_slug_claims WHERE kind = 'project' AND object_id = OLD.id;
    END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS claim_task_list_canonical_slug_insert
    BEFORE INSERT ON task_lists
    WHEN NEW.slug IS NOT NULL AND NEW.slug <> ''
    BEGIN
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM task_lists
        WHERE id <> NEW.id AND project_id IS NEW.project_id AND slug = NEW.slug
      ) THEN RAISE(ABORT, 'TASK_LIST_SLUG_CONFLICT') END;
      INSERT OR IGNORE INTO canonical_slug_claims(kind, scope_key, slug, object_id)
        VALUES ('task_list', CASE WHEN NEW.project_id IS NULL THEN 'standalone:' ELSE 'project:' || NEW.project_id END, NEW.slug, NEW.id);
      SELECT CASE WHEN (
        SELECT object_id FROM canonical_slug_claims
        WHERE kind = 'task_list'
          AND scope_key = CASE WHEN NEW.project_id IS NULL THEN 'standalone:' ELSE 'project:' || NEW.project_id END
          AND slug = NEW.slug
      ) <> NEW.id THEN RAISE(ABORT, 'TASK_LIST_SLUG_CONFLICT') END;
    END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS claim_task_list_canonical_slug_update
    BEFORE UPDATE OF slug, project_id ON task_lists
    WHEN NEW.slug IS NOT OLD.slug OR NEW.project_id IS NOT OLD.project_id
    BEGIN
      DELETE FROM canonical_slug_claims WHERE kind = 'task_list' AND object_id = NEW.id;
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM task_lists
        WHERE id <> NEW.id AND project_id IS NEW.project_id AND slug = NEW.slug
      ) AND NEW.slug IS NOT NULL AND NEW.slug <> ''
        THEN RAISE(ABORT, 'TASK_LIST_SLUG_CONFLICT') END;
      INSERT OR IGNORE INTO canonical_slug_claims(kind, scope_key, slug, object_id)
        SELECT 'task_list', CASE WHEN NEW.project_id IS NULL THEN 'standalone:' ELSE 'project:' || NEW.project_id END, NEW.slug, NEW.id
        WHERE NEW.slug IS NOT NULL AND NEW.slug <> '';
      SELECT CASE WHEN NEW.slug IS NOT NULL AND NEW.slug <> '' AND (
        SELECT object_id FROM canonical_slug_claims
        WHERE kind = 'task_list'
          AND scope_key = CASE WHEN NEW.project_id IS NULL THEN 'standalone:' ELSE 'project:' || NEW.project_id END
          AND slug = NEW.slug
      ) <> NEW.id THEN RAISE(ABORT, 'TASK_LIST_SLUG_CONFLICT') END;
    END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS release_task_list_canonical_slug_delete
    AFTER DELETE ON task_lists
    BEGIN
      DELETE FROM canonical_slug_claims WHERE kind = 'task_list' AND object_id = OLD.id;
    END`);

  // Local tombstones for remote/native storage sync. Core CRUD may hard-delete
  // rows locally, but sync needs a durable delete marker for the next push.
  ensureTable("storage_tombstones", `
    CREATE TABLE storage_tombstones (
      id TEXT PRIMARY KEY,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_machine_id TEXT,
      payload TEXT,
      version INTEGER,
      UNIQUE(object_type, object_id)
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_storage_tombstones_object ON storage_tombstones(object_type, object_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_storage_tombstones_updated ON storage_tombstones(updated_at)");

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
  ensureColumn("tasks", "scheduled_start_at", "TEXT");
  ensureColumn("tasks", "priority_score", "INTEGER");
  ensureColumn("tasks", "priority_reason", "TEXT");
  ensureColumn("tasks", "archived_at", "TEXT");
  // H5: runner/step columns added only in migration 48 — without these
  // ensureColumn calls, a partially-failed migration would leave them missing
  // permanently (the migration runner swallows errors).
  ensureColumn("tasks", "runner_id", "TEXT");
  ensureColumn("tasks", "runner_started_at", "TEXT");
  ensureColumn("tasks", "runner_completed_at", "TEXT");
  ensureColumn("tasks", "current_step", "TEXT");
  ensureColumn("tasks", "total_steps", "INTEGER");

  // Agents
  ensureColumn("agents", "role", "TEXT DEFAULT 'agent'");
  ensureColumn("agents", "permissions", 'TEXT DEFAULT \'["*"]\'');
  ensureColumn("agents", "reports_to", "TEXT");
  ensureColumn("agents", "title", "TEXT");
  ensureColumn("agents", "level", "TEXT");
  ensureColumn("agents", "org_id", "TEXT");
  ensureColumn("agents", "capabilities", "TEXT DEFAULT '[]'");
  // H5: agent session/status columns added only via migrations 17/23/(status).
  ensureColumn("agents", "session_id", "TEXT");
  ensureColumn("agents", "working_dir", "TEXT");
  ensureColumn("agents", "active_project_id", "TEXT");
  ensureColumn("agents", "status", "TEXT NOT NULL DEFAULT 'active'");

  // Projects
  ensureColumn("projects", "org_id", "TEXT");

  // Plans
  ensureColumn("plans", "slug", "TEXT");
  ensureColumn("plans", "task_list_id", "TEXT");
  ensureColumn("plans", "agent_id", "TEXT");
  backfillPlanSlugs(db);

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
  ensureColumn("handoffs", "session_id", "TEXT");
  ensureColumn("handoffs", "task_ids", "TEXT");
  ensureColumn("handoffs", "relevant_files", "TEXT");
  ensureColumn("handoffs", "run_ids", "TEXT");
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
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_archived_at ON tasks(archived_at)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_task_list ON tasks(task_list_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tasks_short_id ON tasks(short_id) WHERE short_id IS NOT NULL");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_lists_project ON task_lists(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_lists_slug ON task_lists(slug)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_plans_slug ON plans(slug)");
  ensureIndex("CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_scope_slug ON plans(COALESCE(project_id, ''), slug) WHERE slug IS NOT NULL");
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
      run_id TEXT,
      focus_session_id TEXT,
      agent_id TEXT,
      started_at TEXT,
      ended_at TEXT,
      minutes INTEGER NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureColumn("task_time_logs", "run_id", "TEXT");
  ensureColumn("task_time_logs", "focus_session_id", "TEXT");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_time_logs_task ON task_time_logs(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_time_logs_agent ON task_time_logs(agent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_time_logs_run ON task_time_logs(run_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_time_logs_focus_session ON task_time_logs(focus_session_id)");
  ensureColumn("tasks", "actual_minutes", "INTEGER");

  ensureTable("focus_sessions", `
    CREATE TABLE focus_sessions (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      run_id TEXT,
      agent_id TEXT,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed', 'cancelled')),
      started_at TEXT NOT NULL,
      last_resumed_at TEXT,
      paused_at TEXT,
      ended_at TEXT,
      actual_minutes INTEGER NOT NULL DEFAULT 0,
      idle_after_minutes INTEGER,
      notes TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_focus_sessions_task ON focus_sessions(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_focus_sessions_plan ON focus_sessions(plan_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_focus_sessions_run ON focus_sessions(run_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_focus_sessions_agent ON focus_sessions(agent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_focus_sessions_status ON focus_sessions(status)");

  ensureTable("task_boards", `
    CREATE TABLE task_boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      scope TEXT NOT NULL DEFAULT 'tasks' CHECK(scope IN ('tasks', 'plans')),
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      task_list_id TEXT REFERENCES task_lists(id) ON DELETE SET NULL,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      agent_id TEXT,
      lanes TEXT NOT NULL DEFAULT '[]',
      filters TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_boards_scope ON task_boards(scope)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_boards_project ON task_boards(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_boards_plan ON task_boards(plan_id)");

  ensureTable("local_calendar_items", `
    CREATE TABLE local_calendar_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('task_due', 'task_sla', 'task_reminder', 'milestone', 'work_block', 'run', 'imported')),
      title TEXT NOT NULL,
      description TEXT,
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      timezone TEXT,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      run_id TEXT,
      recurrence_rule TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_local_calendar_items_time ON local_calendar_items(starts_at, ends_at)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_local_calendar_items_task ON local_calendar_items(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_local_calendar_items_project ON local_calendar_items(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_local_calendar_items_kind ON local_calendar_items(kind)");

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
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_labels_project ON labels(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_labels_name ON labels(name)");

  ensureTable("task_labels", `
    CREATE TABLE task_labels (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, label_id)
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_labels_task ON task_labels(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_labels_label ON task_labels(label_id)");

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
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_custom_fields_project ON custom_field_definitions(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_custom_fields_slug ON custom_field_definitions(slug)");

  ensureTable("task_custom_field_values", `
    CREATE TABLE task_custom_field_values (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, field_id)
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_custom_values_task ON task_custom_field_values(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_custom_values_field ON task_custom_field_values(field_id)");

  // Legacy/simple saved views distinct from saved_search_views.
  ensureTable("saved_views", `
    CREATE TABLE saved_views (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      entity_type TEXT NOT NULL DEFAULT 'task',
      filters TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_saved_views_slug ON saved_views(slug)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_saved_views_entity ON saved_views(entity_type)");

  // Decision records and knowledge snapshots
  ensureTable("decision_records", `
    CREATE TABLE decision_records (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      agent_id TEXT,
      sequence_num INTEGER NOT NULL,
      short_ref TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed', 'accepted', 'deprecated', 'superseded', 'rejected')),
      context TEXT,
      decision TEXT NOT NULL,
      consequences TEXT,
      alternatives TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      supersedes_id TEXT REFERENCES decision_records(id) ON DELETE SET NULL,
      superseded_by_id TEXT REFERENCES decision_records(id) ON DELETE SET NULL,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_decision_records_project ON decision_records(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_decision_records_task ON decision_records(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_decision_records_plan ON decision_records(plan_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_decision_records_status ON decision_records(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_decision_records_short_ref ON decision_records(short_ref)");

  ensureTable("knowledge_snapshots", `
    CREATE TABLE knowledge_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      summary TEXT,
      content_hash TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      decision_ids TEXT DEFAULT '[]',
      topics TEXT DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'auto' CHECK(source IN ('manual', 'auto', 'import')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_knowledge_snapshots_project ON knowledge_snapshots(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_knowledge_snapshots_hash ON knowledge_snapshots(content_hash)");

  // Portable verification evidence
  ensureTable("verification_records", `
    CREATE TABLE verification_records (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      provider_name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('passed', 'failed', 'unknown')),
      summary TEXT,
      evidence TEXT DEFAULT '{}',
      artifact_id TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_verification_records_task ON verification_records(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_verification_records_status ON verification_records(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_verification_records_created ON verification_records(created_at)");

  // Hardened local leases
  ensureTable("task_leases", `
    CREATE TABLE task_leases (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      heartbeat_at TEXT,
      steal_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_leases_agent ON task_leases(agent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_task_leases_expires ON task_leases(expires_at)");

  // Notification reminders
  ensureTable("reminder_preferences", `
    CREATE TABLE reminder_preferences (
      id TEXT PRIMARY KEY,
      due_soon_hours INTEGER NOT NULL DEFAULT 24,
      sla_warning_minutes INTEGER NOT NULL DEFAULT 30,
      enabled INTEGER NOT NULL DEFAULT 1,
      desktop_notify INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

  ensureTable("notification_reminders", `
    CREATE TABLE notification_reminders (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      reminder_type TEXT NOT NULL CHECK(reminder_type IN ('due_soon', 'due_overdue', 'sla_warning', 'sla_breach', 'custom')),
      title TEXT NOT NULL,
      message TEXT,
      trigger_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'fired', 'dismissed', 'snoozed')),
      snoozed_until TEXT,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      agent_id TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      fired_at TEXT,
      dismissed_at TEXT
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_notification_reminders_task ON notification_reminders(task_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_notification_reminders_status ON notification_reminders(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_notification_reminders_trigger ON notification_reminders(trigger_at)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_notification_reminders_project ON notification_reminders(project_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_notification_reminders_agent ON notification_reminders(agent_id)");

  // First-class local run records
  ensureTable("run_records", `
    CREATE TABLE run_records (
      id TEXT PRIMARY KEY,
      agent_run_id TEXT,
      agent_id TEXT,
      objective TEXT,
      plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
      claimed_task_ids TEXT DEFAULT '[]',
      commands TEXT DEFAULT '[]',
      stdout_summary TEXT,
      stderr_summary TEXT,
      files_touched TEXT DEFAULT '[]',
      verification_results TEXT DEFAULT '[]',
      artifact_ids TEXT DEFAULT '[]',
      status_transitions TEXT DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed', 'archived')),
      replay_bundle TEXT,
      metadata TEXT DEFAULT '{}',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_run_records_agent_run ON run_records(agent_run_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_run_records_agent ON run_records(agent_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_run_records_plan ON run_records(plan_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_run_records_status ON run_records(status)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_run_records_started ON run_records(started_at)");

  // Append-only local activity log
  ensureTable("activity_log", `
    CREATE TABLE activity_log (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      field TEXT,
      old_value TEXT,
      new_value TEXT,
      actor_id TEXT,
      session_id TEXT,
      machine_id TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_activity_log_actor ON activity_log(actor_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at)");

  // API keys — hashed credentials for external app/API access
  ensureTable("api_keys", `
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      prefix TEXT NOT NULL UNIQUE,
      permissions TEXT NOT NULL DEFAULT '["*"]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      expires_at TEXT,
      revoked_at TEXT
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(revoked_at, expires_at)");

  // Authoritative PR-group execution ledger. Identity and receipt indexes are
  // durable fences, not advisory cache keys.
  ensureTable("pr_groups", `
    CREATE TABLE pr_groups (
      schema_version INTEGER NOT NULL DEFAULT 1,
      id TEXT PRIMARY KEY,
      identity_key TEXT NOT NULL UNIQUE,
      root_request_id TEXT NOT NULL,
      repository TEXT NOT NULL,
      leaf_task_id TEXT NOT NULL,
      branch TEXT NOT NULL,
      pr_number INTEGER,
      base_sha TEXT,
      state TEXT NOT NULL,
      active_attempt_id TEXT,
      active_generation TEXT,
      repair_cycle_count INTEGER NOT NULL DEFAULT 0,
      repair_cycle_limit INTEGER NOT NULL DEFAULT 2,
      terminal_attempt_id TEXT,
      terminal_generation TEXT,
      terminal_outcome TEXT,
      terminal_head_sha TEXT,
      terminal_at TEXT,
      cleanup_eligible_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
  ensureIndex("CREATE UNIQUE INDEX IF NOT EXISTS idx_pr_groups_identity ON pr_groups(identity_key)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_pr_groups_root_repository ON pr_groups(root_request_id, repository)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_pr_groups_active_generation ON pr_groups(active_generation)");

  ensureTable("pr_group_attempts", `
    CREATE TABLE pr_group_attempts (
      schema_version INTEGER NOT NULL DEFAULT 1,
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES pr_groups(id) ON DELETE CASCADE,
      leaf_task_id TEXT NOT NULL,
      dispatch_attempt TEXT NOT NULL,
      writer_generation TEXT NOT NULL,
      previous_attempt_id TEXT REFERENCES pr_group_attempts(id) ON DELETE SET NULL,
      worktree TEXT NOT NULL,
      branch TEXT NOT NULL,
      repository TEXT NOT NULL,
      pr_number INTEGER,
      base_sha TEXT,
      provider TEXT,
      provider_run_id TEXT,
      profile_alias TEXT,
      status TEXT NOT NULL,
      admitted_at TEXT NOT NULL,
      started_at TEXT,
      last_heartbeat_at TEXT,
      handed_off_at TEXT,
      fenced_at TEXT,
      terminal_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(group_id, leaf_task_id, dispatch_attempt),
      UNIQUE(group_id, writer_generation)
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_pr_group_attempts_group ON pr_group_attempts(group_id, created_at, id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_pr_group_attempts_generation ON pr_group_attempts(group_id, writer_generation)");

  ensureTable("pr_group_events", `
    CREATE TABLE pr_group_events (
      schema_version INTEGER NOT NULL DEFAULT 1,
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES pr_groups(id) ON DELETE CASCADE,
      attempt_id TEXT NOT NULL REFERENCES pr_group_attempts(id) ON DELETE CASCADE,
      writer_generation TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      state TEXT NOT NULL,
      message TEXT,
      head_sha TEXT,
      receipt_key TEXT UNIQUE,
      review_receipt_key TEXT,
      conditional_merge_receipt_key TEXT,
      outcome TEXT,
      repository TEXT NOT NULL,
      pr_number INTEGER,
      base_sha TEXT,
      actor_id TEXT,
      actor_run_id TEXT,
      expected_reviewer_id TEXT,
      expected_reviewer_run_id TEXT,
      repair_cycle INTEGER,
      ci_proof TEXT,
      cleanup_proof TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(group_id, sequence),
      UNIQUE(group_id, idempotency_key)
    )`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_pr_group_events_group_sequence ON pr_group_events(group_id, sequence)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_pr_group_events_attempt ON pr_group_events(attempt_id, sequence)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_pr_group_events_receipt ON pr_group_events(receipt_key)");
  ensureColumn("pr_groups", "leaf_task_id", "TEXT");
  ensureColumn("pr_groups", "branch", "TEXT");
  ensureColumn("pr_groups", "pr_number", "INTEGER");
  ensureColumn("pr_groups", "base_sha", "TEXT");
  ensureColumn("pr_groups", "repair_cycle_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("pr_groups", "repair_cycle_limit", "INTEGER NOT NULL DEFAULT 2");
  ensureColumn("pr_group_attempts", "repository", "TEXT");
  ensureColumn("pr_group_attempts", "pr_number", "INTEGER");
  ensureColumn("pr_group_attempts", "base_sha", "TEXT");
  ensureColumn("pr_group_events", "review_receipt_key", "TEXT");
  ensureColumn("pr_group_events", "conditional_merge_receipt_key", "TEXT");
  ensureColumn("pr_group_events", "repository", "TEXT");
  ensureColumn("pr_group_events", "pr_number", "INTEGER");
  ensureColumn("pr_group_events", "base_sha", "TEXT");
  ensureColumn("pr_group_events", "actor_id", "TEXT");
  ensureColumn("pr_group_events", "actor_run_id", "TEXT");
  ensureColumn("pr_group_events", "expected_reviewer_id", "TEXT");
  ensureColumn("pr_group_events", "expected_reviewer_run_id", "TEXT");
  ensureColumn("pr_group_events", "repair_cycle", "INTEGER");
  ensureColumn("pr_group_events", "ci_proof", "TEXT");
  ensureColumn("pr_group_events", "cleanup_proof", "TEXT");
  try {
    db.exec(`
      UPDATE pr_groups
      SET leaf_task_id = COALESCE(leaf_task_id, (
            SELECT attempt.leaf_task_id
            FROM pr_group_attempts AS attempt
            WHERE attempt.group_id = pr_groups.id
            ORDER BY CASE WHEN attempt.id = pr_groups.active_attempt_id THEN 0 ELSE 1 END,
                     attempt.created_at ASC, attempt.id ASC
            LIMIT 1
          )),
          branch = COALESCE(branch, (
            SELECT attempt.branch
            FROM pr_group_attempts AS attempt
            WHERE attempt.group_id = pr_groups.id
            ORDER BY CASE WHEN attempt.id = pr_groups.active_attempt_id THEN 0 ELSE 1 END,
                     attempt.created_at ASC, attempt.id ASC
            LIMIT 1
          ));
      UPDATE pr_group_attempts
      SET repository = COALESCE(repository, (
            SELECT groups.repository FROM pr_groups AS groups
            WHERE groups.id = pr_group_attempts.group_id
          )),
          pr_number = COALESCE(pr_number, (
            SELECT groups.pr_number FROM pr_groups AS groups
            WHERE groups.id = pr_group_attempts.group_id
          )),
          base_sha = COALESCE(base_sha, (
            SELECT groups.base_sha FROM pr_groups AS groups
            WHERE groups.id = pr_group_attempts.group_id
          ));
      UPDATE pr_groups
      SET pr_number = COALESCE(pr_number, (
            SELECT attempt.pr_number
            FROM pr_group_attempts AS attempt
            WHERE attempt.group_id = pr_groups.id AND attempt.pr_number IS NOT NULL
            ORDER BY CASE WHEN attempt.id = pr_groups.active_attempt_id THEN 0 ELSE 1 END,
                     attempt.created_at ASC, attempt.id ASC
            LIMIT 1
          )),
          base_sha = COALESCE(base_sha, (
            SELECT attempt.base_sha
            FROM pr_group_attempts AS attempt
            WHERE attempt.group_id = pr_groups.id AND attempt.base_sha IS NOT NULL
            ORDER BY CASE WHEN attempt.id = pr_groups.active_attempt_id THEN 0 ELSE 1 END,
                     attempt.created_at ASC, attempt.id ASC
            LIMIT 1
          ));
      UPDATE pr_group_attempts
      SET pr_number = COALESCE(pr_number, (
            SELECT groups.pr_number FROM pr_groups AS groups
            WHERE groups.id = pr_group_attempts.group_id
          )),
          base_sha = COALESCE(base_sha, (
            SELECT groups.base_sha FROM pr_groups AS groups
            WHERE groups.id = pr_group_attempts.group_id
          ));
      UPDATE pr_group_events
      SET repository = COALESCE(repository, (
            SELECT attempt.repository FROM pr_group_attempts AS attempt
            WHERE attempt.id = pr_group_events.attempt_id
          ), (
            SELECT groups.repository FROM pr_groups AS groups
            WHERE groups.id = pr_group_events.group_id
          )),
          pr_number = COALESCE(pr_number, (
            SELECT attempt.pr_number FROM pr_group_attempts AS attempt
            WHERE attempt.id = pr_group_events.attempt_id
          ), (
            SELECT groups.pr_number FROM pr_groups AS groups
            WHERE groups.id = pr_group_events.group_id
          )),
          base_sha = COALESCE(base_sha, (
            SELECT attempt.base_sha FROM pr_group_attempts AS attempt
            WHERE attempt.id = pr_group_events.attempt_id
          ), (
            SELECT groups.base_sha FROM pr_groups AS groups
            WHERE groups.id = pr_group_events.group_id
          ));
      INSERT OR IGNORE INTO _migrations (id)
      SELECT 66
      WHERE NOT EXISTS (
        SELECT 1 FROM pr_groups WHERE leaf_task_id IS NULL OR branch IS NULL
      )
        AND NOT EXISTS (
          SELECT 1 FROM pr_group_attempts WHERE repository IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM pr_group_events WHERE repository IS NULL
        );
    `);
  } catch {}

  const strictColumns = [
    ["pr_groups", "leaf_task_id"],
    ["pr_groups", "branch"],
    ["pr_group_attempts", "repository"],
    ["pr_group_events", "repository"],
  ] as const;
  for (const [table, column] of strictColumns) {
    const definition = db.query(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
      notnull: number;
    }>;
    if (definition.find((entry) => entry.name === column)?.notnull !== 1) {
      throw new Error(`PR-group schema integrity failure: ${table}.${column} is not NOT NULL`);
    }
  }
  const eventColumns = db.query("PRAGMA table_info(pr_group_events)").all() as Array<{ name: string }>;
  if (!eventColumns.some((entry) => entry.name === "ci_proof")) {
    throw new Error("PR-group schema integrity failure: pr_group_events.ci_proof is missing");
  }
  const receiptIndexes = db.query("PRAGMA index_list(pr_group_events)").all() as Array<{
    name: string;
    unique: number;
  }>;
  const hasGlobalReceiptUniqueness = receiptIndexes.some((index) => {
    if (index.unique !== 1) return false;
    const columns = db.query(`PRAGMA index_info(${JSON.stringify(index.name)})`).all() as Array<{
      name: string;
    }>;
    return columns.length === 1 && columns[0]?.name === "receipt_key";
  });
  if (!hasGlobalReceiptUniqueness) {
    throw new Error("PR-group schema integrity failure: receipt_key is not globally unique");
  }
  const strictMigration = db.query("SELECT 1 AS ok FROM _migrations WHERE id = 68").get() as {
    ok: number;
  } | null;
  if (strictMigration?.ok !== 1) {
    throw new Error("PR-group schema integrity failure: migration 68 is not recorded");
  }
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
