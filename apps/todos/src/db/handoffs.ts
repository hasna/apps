import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";
import { redactEvidenceText } from "../lib/redaction.js";

export interface Handoff {
  id: string;
  agent_id: string | null;
  project_id: string | null;
  session_id: string | null;
  summary: string;
  completed: string[] | null;
  in_progress: string[] | null;
  blockers: string[] | null;
  next_steps: string[] | null;
  task_ids: string[] | null;
  relevant_files: string[] | null;
  run_ids: string[] | null;
  created_at: string;
  acknowledged_by: string[];
}

export interface CreateHandoffInput {
  agent_id?: string;
  project_id?: string;
  session_id?: string;
  summary: string;
  completed?: string[];
  in_progress?: string[];
  blockers?: string[];
  next_steps?: string[];
  task_ids?: string[];
  relevant_files?: string[];
  run_ids?: string[];
}

export interface ListHandoffsOptions {
  project_id?: string;
  agent_id?: string;
  unread_for?: string;
  limit?: number;
}

export interface CreateSessionRecoveryHandoffInput {
  agent_id: string;
  session_id?: string;
  project_id?: string;
  recovered_by?: string;
  reason?: string;
  limit?: number;
}

export interface HandoffBundle {
  schemaVersion: 1;
  kind: "hasna.todos.handoff";
  exported_at: string;
  handoff: Handoff;
  references: {
    tasks: Array<Record<string, unknown>>;
    files: Array<Record<string, unknown>>;
    runs: Array<Record<string, unknown>>;
    verifications: Array<Record<string, unknown>>;
    commits: Array<Record<string, unknown>>;
  };
}

export interface ImportHandoffBundleResult {
  applied: boolean;
  created: boolean;
  existing: boolean;
  handoff_id: string;
  summary: string;
  warnings: string[];
}

export function createHandoff(input: CreateHandoffInput, db?: Database): Handoff {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  d.run(
    `INSERT INTO handoffs (id, agent_id, project_id, session_id, summary, completed, in_progress, blockers, next_steps, task_ids, relevant_files, run_ids, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.agent_id || null,
      input.project_id || null,
      input.session_id || null,
      redactEvidenceText(input.summary),
      toJson(input.completed),
      toJson(input.in_progress),
      toJson(input.blockers),
      toJson(input.next_steps),
      toJson(input.task_ids),
      toJson(input.relevant_files),
      toJson(input.run_ids),
      timestamp,
    ],
  );
  return {
    id, agent_id: input.agent_id || null, project_id: input.project_id || null, session_id: input.session_id || null,
    summary: redactEvidenceText(input.summary),
    completed: input.completed || null, in_progress: input.in_progress || null,
    blockers: input.blockers || null, next_steps: input.next_steps || null,
    task_ids: input.task_ids || null,
    relevant_files: input.relevant_files || null,
    run_ids: input.run_ids || null,
    created_at: timestamp,
    acknowledged_by: [],
  };
}

function stableRows<T extends Record<string, unknown>>(rows: T[], keys: string[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const key of keys) next[key] = row[key] ?? null;
    return next;
  });
}

function bindList(values: string[]): { clause: string; values: string[] } {
  return { clause: values.map(() => "?").join(","), values };
}

function arrayOrNull(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
}

function toOptionalArray(value: unknown): string[] | undefined {
  return arrayOrNull(value) ?? undefined;
}

export function exportHandoffBundle(id: string, db?: Database, exportedAt: Date = new Date()): HandoffBundle {
  const d = db || getDatabase();
  const handoff = getHandoff(id, d);
  if (!handoff) throw new Error(`Handoff not found: ${id}`);

  const taskIds = handoff.task_ids ?? [];
  const runIds = handoff.run_ids ?? [];
  const filePaths = handoff.relevant_files ?? [];
  const references: HandoffBundle["references"] = {
    tasks: [],
    files: [],
    runs: [],
    verifications: [],
    commits: [],
  };

  if (taskIds.length) {
    const bound = bindList(taskIds);
    references.tasks = stableRows(
      d.query(`SELECT id, short_id, title, status, priority, assigned_to, agent_id, session_id, updated_at, completed_at FROM tasks WHERE id IN (${bound.clause}) ORDER BY title, id`).all(...bound.values) as Array<Record<string, unknown>>,
      ["id", "short_id", "title", "status", "priority", "assigned_to", "agent_id", "session_id", "updated_at", "completed_at"],
    );
    references.verifications = stableRows(
      d.query(`SELECT id, task_id, command, status, output_summary, artifact_path, agent_id, run_at, created_at FROM task_verifications WHERE task_id IN (${bound.clause}) ORDER BY task_id, run_at DESC, created_at DESC`).all(...bound.values) as Array<Record<string, unknown>>,
      ["id", "task_id", "command", "status", "output_summary", "artifact_path", "agent_id", "run_at", "created_at"],
    );
    references.commits = stableRows(
      d.query(`SELECT id, task_id, sha, message, author, committed_at, files_changed, created_at FROM task_commits WHERE task_id IN (${bound.clause}) ORDER BY task_id, committed_at DESC, created_at DESC`).all(...bound.values) as Array<Record<string, unknown>>,
      ["id", "task_id", "sha", "message", "author", "committed_at", "files_changed", "created_at"],
    );
  }

  if (taskIds.length || filePaths.length) {
    const clauses: string[] = [];
    const params: string[] = [];
    if (taskIds.length) {
      const bound = bindList(taskIds);
      clauses.push(`task_id IN (${bound.clause})`);
      params.push(...bound.values);
    }
    if (filePaths.length) {
      const bound = bindList(filePaths);
      clauses.push(`path IN (${bound.clause})`);
      params.push(...bound.values);
    }
    references.files = stableRows(
      d.query(`SELECT id, task_id, path, status, agent_id, note, updated_at FROM task_files WHERE ${clauses.join(" OR ")} ORDER BY path, task_id`).all(...params) as Array<Record<string, unknown>>,
      ["id", "task_id", "path", "status", "agent_id", "note", "updated_at"],
    );
  }

  if (runIds.length) {
    const bound = bindList(runIds);
    references.runs = stableRows(
      d.query(`SELECT id, task_id, agent_id, title, status, summary, started_at, completed_at, updated_at FROM task_runs WHERE id IN (${bound.clause}) ORDER BY started_at DESC, created_at DESC`).all(...bound.values) as Array<Record<string, unknown>>,
      ["id", "task_id", "agent_id", "title", "status", "summary", "started_at", "completed_at", "updated_at"],
    );
  }

  return {
    schemaVersion: 1,
    kind: "hasna.todos.handoff",
    exported_at: exportedAt.toISOString(),
    handoff,
    references,
  };
}

export function importHandoffBundle(
  bundle: HandoffBundle,
  options: { apply?: boolean } = {},
  db?: Database,
): ImportHandoffBundleResult {
  if (!bundle || bundle.schemaVersion !== 1 || bundle.kind !== "hasna.todos.handoff" || !bundle.handoff?.id) {
    throw new Error("Invalid handoff bundle");
  }
  const d = db || getDatabase();
  const handoff = bundle.handoff;
  const existing = getHandoff(handoff.id, d);
  const warnings: string[] = [];
  const missingTaskIds = (handoff.task_ids ?? []).filter((taskId) => !d.query("SELECT id FROM tasks WHERE id = ?").get(taskId));
  if (missingTaskIds.length) warnings.push(`${missingTaskIds.length} referenced task(s) are not present locally`);

  if (!options.apply) {
    return {
      applied: false,
      created: false,
      existing: !!existing,
      handoff_id: handoff.id,
      summary: handoff.summary,
      warnings,
    };
  }

  if (!existing) {
    d.run(
      `INSERT INTO handoffs (id, agent_id, project_id, session_id, summary, completed, in_progress, blockers, next_steps, task_ids, relevant_files, run_ids, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        handoff.id,
        handoff.agent_id,
        handoff.project_id,
        handoff.session_id,
        redactEvidenceText(handoff.summary),
        toJson(toOptionalArray(handoff.completed)),
        toJson(toOptionalArray(handoff.in_progress)),
        toJson(toOptionalArray(handoff.blockers)),
        toJson(toOptionalArray(handoff.next_steps)),
        toJson(toOptionalArray(handoff.task_ids)),
        toJson(toOptionalArray(handoff.relevant_files)),
        toJson(toOptionalArray(handoff.run_ids)),
        handoff.created_at,
      ],
    );
  }

  for (const agentId of handoff.acknowledged_by ?? []) {
    d.run(
      "INSERT OR REPLACE INTO handoff_acknowledgements (handoff_id, agent_id, acknowledged_at) VALUES (?, ?, ?)",
      [handoff.id, agentId, now()],
    );
  }

  return {
    applied: true,
    created: !existing,
    existing: !!existing,
    handoff_id: handoff.id,
    summary: handoff.summary,
    warnings,
  };
}

function toJson(value?: string[]): string | null {
  return value?.length ? JSON.stringify(value.map((item) => redactEvidenceText(item))) : null;
}

function parseArray(value: string | null | undefined): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : null;
  } catch {
    return null;
  }
}

function getAcknowledgedBy(handoffId: string, db: Database): string[] {
  return (db.query("SELECT agent_id FROM handoff_acknowledgements WHERE handoff_id = ? ORDER BY acknowledged_at, agent_id")
    .all(handoffId) as Array<{ agent_id: string }>).map((row) => row.agent_id);
}

function rowToHandoff(row: any, db: Database): Handoff {
  return {
    ...row,
    session_id: row.session_id || null,
    completed: parseArray(row.completed),
    in_progress: parseArray(row.in_progress),
    blockers: parseArray(row.blockers),
    next_steps: parseArray(row.next_steps),
    task_ids: parseArray(row.task_ids),
    relevant_files: parseArray(row.relevant_files),
    run_ids: parseArray(row.run_ids),
    acknowledged_by: getAcknowledgedBy(row.id, db),
  };
}

export function listHandoffs(projectIdOrOptions?: string | ListHandoffsOptions, limitOrDb: number | Database = 10, maybeDb?: Database): Handoff[] {
  const options: ListHandoffsOptions = typeof projectIdOrOptions === "object" && projectIdOrOptions !== null
    ? projectIdOrOptions
    : { project_id: projectIdOrOptions || undefined, limit: typeof limitOrDb === "number" ? limitOrDb : 10 };
  const d = maybeDb || (typeof limitOrDb === "object" ? limitOrDb : undefined) || getDatabase();
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (options.project_id) {
    conditions.push("project_id = ?");
    params.push(options.project_id);
  }
  if (options.agent_id) {
    conditions.push("agent_id = ?");
    params.push(options.agent_id);
  }
  if (options.unread_for) {
    conditions.push("id NOT IN (SELECT handoff_id FROM handoff_acknowledgements WHERE agent_id = ?)");
    params.push(options.unread_for);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = d.query(`SELECT * FROM handoffs ${where} ORDER BY rowid DESC LIMIT ?`).all(...params, options.limit || 10) as any[];
  return rows.map((row) => rowToHandoff(row, d));
}

export function getHandoff(id: string, db?: Database): Handoff | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM handoffs WHERE id = ? OR id LIKE ? ORDER BY rowid DESC LIMIT 2").all(id, `${id}%`) as any[];
  if (row.length === 0) return null;
  if (row.length > 1) throw new Error(`Handoff ID is ambiguous: ${id}`);
  return rowToHandoff(row[0], d);
}

export function acknowledgeHandoff(id: string, agentId: string, db?: Database): Handoff {
  const d = db || getDatabase();
  const handoff = getHandoff(id, d);
  if (!handoff) throw new Error(`Handoff not found: ${id}`);
  d.run(
    "INSERT OR REPLACE INTO handoff_acknowledgements (handoff_id, agent_id, acknowledged_at) VALUES (?, ?, ?)",
    [handoff.id, agentId, now()],
  );
  return getHandoff(handoff.id, d)!;
}

export function getLatestHandoff(agentId?: string, projectId?: string, db?: Database): Handoff | null {
  const d = db || getDatabase();
  let query = "SELECT * FROM handoffs WHERE 1=1";
  const params: any[] = [];
  if (agentId) { query += " AND agent_id = ?"; params.push(agentId); }
  if (projectId) { query += " AND project_id = ?"; params.push(projectId); }
  query += " ORDER BY rowid DESC LIMIT 1";
  const row = d.query(query).get(...params) as any;
  return row ? rowToHandoff(row, d) : null;
}

export function createSessionRecoveryHandoff(input: CreateSessionRecoveryHandoffInput, db?: Database): Handoff {
  const d = db || getDatabase();
  const limit = input.limit || 20;
  const conditions = ["status = 'in_progress'", "(assigned_to = ? OR agent_id = ? OR locked_by = ?)"];
  const params: SQLQueryBindings[] = [input.agent_id, input.agent_id, input.agent_id];
  if (input.session_id) {
    conditions.push("session_id = ?");
    params.push(input.session_id);
  }
  if (input.project_id) {
    conditions.push("project_id = ?");
    params.push(input.project_id);
  }
  const tasks = d.query(`
    SELECT id, title
    FROM tasks
    WHERE ${conditions.join(" AND ")}
      AND archived_at IS NULL
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ?
  `).all(...params, limit) as Array<{ id: string; title: string }>;
  const taskIds = tasks.map((task) => task.id);
  const placeholders = taskIds.map(() => "?").join(",");
  const files = taskIds.length
    ? (d.query(`
        SELECT DISTINCT path
        FROM task_files
        WHERE task_id IN (${placeholders}) AND status != 'removed'
        ORDER BY updated_at DESC, path
        LIMIT ?
      `).all(...taskIds, limit) as Array<{ path: string }>).map((row) => row.path)
    : [];
  const runs = taskIds.length
    ? (d.query(`
        SELECT id
        FROM task_runs
        WHERE task_id IN (${placeholders})
        ORDER BY started_at DESC, created_at DESC
        LIMIT ?
      `).all(...taskIds, limit) as Array<{ id: string }>).map((row) => row.id)
    : [];
  const taskLabels = tasks.map((task) => `${task.id.slice(0, 8)} ${task.title}`);
  const reason = input.reason || "stale session recovery";
  return createHandoff({
    agent_id: input.agent_id,
    project_id: input.project_id,
    session_id: input.session_id,
    summary: `${reason}: captured ${tasks.length} active task${tasks.length === 1 ? "" : "s"} for ${input.recovered_by || "next agent"}`,
    in_progress: taskLabels,
    blockers: [],
    next_steps: taskLabels.length
      ? taskLabels.map((task) => `Review active task ${task}`)
      : ["Confirm no active task state remains for this session"],
    task_ids: taskIds,
    relevant_files: files,
    run_ids: runs,
  }, d);
}
