import type { Database } from "bun:sqlite";
import type {
  ContactTask,
  CreateContactTaskInput,
  UpdateContactTaskInput,
  EscalationRule,
} from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

// ─── Row mapper ───────────────────────────────────────────────────────────────

interface ContactTaskRow {
  id: string;
  title: string;
  description: string | null;
  contact_id: string;
  assigned_by: string | null;
  deadline: string | null;
  status: string;
  priority: string;
  entity_id: string | null;
  linked_todos_task_id: string | null;
  escalation_rules: string;
  created_at: string;
  updated_at: string;
}

function rowToContactTask(row: ContactTaskRow): ContactTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    contact_id: row.contact_id,
    assigned_by: row.assigned_by,
    deadline: row.deadline,
    status: row.status as ContactTask["status"],
    priority: row.priority as ContactTask["priority"],
    entity_id: row.entity_id,
    linked_todos_task_id: row.linked_todos_task_id,
    escalation_rules: JSON.parse(row.escalation_rules || "[]") as EscalationRule[],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createContactTask(input: CreateContactTaskInput, db?: Database): ContactTask {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO contact_tasks
      (id, title, description, contact_id, assigned_by, deadline, status, priority,
       entity_id, linked_todos_task_id, escalation_rules, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.description ?? null,
      input.contact_id,
      input.assigned_by ?? null,
      input.deadline ?? null,
      input.status ?? 'pending',
      input.priority ?? 'medium',
      input.entity_id ?? null,
      input.linked_todos_task_id ?? null,
      JSON.stringify(input.escalation_rules ?? []),
      timestamp,
      timestamp,
    ]
  );

  return rowToContactTask(
    d.query(`SELECT * FROM contact_tasks WHERE id = ?`).get(id) as ContactTaskRow
  );
}

export function getContactTask(id: string, db?: Database): ContactTask | null {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM contact_tasks WHERE id = ?`).get(id) as ContactTaskRow | null;
  return row ? rowToContactTask(row) : null;
}

export interface ListContactTasksOptions {
  contact_id?: string;
  entity_id?: string;
  status?: ContactTask["status"];
  priority?: ContactTask["priority"];
}

export function listContactTasks(opts: ListContactTasksOptions = {}, db?: Database): ContactTask[] {
  const d = db || getDatabase();

  const conditions: string[] = [];
  const params: string[] = [];

  if (opts.contact_id) { conditions.push("contact_id = ?"); params.push(opts.contact_id); }
  if (opts.entity_id) { conditions.push("entity_id = ?"); params.push(opts.entity_id); }
  if (opts.status) { conditions.push("status = ?"); params.push(opts.status); }
  if (opts.priority) { conditions.push("priority = ?"); params.push(opts.priority); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = d.query(
    `SELECT * FROM contact_tasks ${where} ORDER BY deadline ASC, priority DESC, created_at ASC`
  ).all(...params) as ContactTaskRow[];

  return rows.map(rowToContactTask);
}

export function updateContactTask(id: string, input: UpdateContactTaskInput, db?: Database): ContactTask {
  const d = db || getDatabase();

  const setClauses: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now()];

  if (input.title !== undefined) { setClauses.push("title = ?"); params.push(input.title); }
  if ("description" in input) { setClauses.push("description = ?"); params.push(input.description ?? null); }
  if ("assigned_by" in input) { setClauses.push("assigned_by = ?"); params.push(input.assigned_by ?? null); }
  if ("deadline" in input) { setClauses.push("deadline = ?"); params.push(input.deadline ?? null); }
  if (input.status !== undefined) { setClauses.push("status = ?"); params.push(input.status); }
  if (input.priority !== undefined) { setClauses.push("priority = ?"); params.push(input.priority); }
  if ("entity_id" in input) { setClauses.push("entity_id = ?"); params.push(input.entity_id ?? null); }
  if ("linked_todos_task_id" in input) { setClauses.push("linked_todos_task_id = ?"); params.push(input.linked_todos_task_id ?? null); }
  if (input.escalation_rules !== undefined) { setClauses.push("escalation_rules = ?"); params.push(JSON.stringify(input.escalation_rules)); }

  params.push(id);
  d.run(`UPDATE contact_tasks SET ${setClauses.join(", ")} WHERE id = ?`, params);

  return rowToContactTask(
    d.query(`SELECT * FROM contact_tasks WHERE id = ?`).get(id) as ContactTaskRow
  );
}

export function deleteContactTask(id: string, db?: Database): void {
  const d = db || getDatabase();
  d.run(`DELETE FROM contact_tasks WHERE id = ?`, [id]);
}

export function listOverdueTasks(db?: Database): ContactTask[] {
  const d = db || getDatabase();
  const now_iso = new Date().toISOString();
  const rows = d.query(
    `SELECT * FROM contact_tasks
     WHERE deadline < ? AND status NOT IN ('completed','cancelled')
     ORDER BY deadline ASC`
  ).all(now_iso) as ContactTaskRow[];
  return rows.map(rowToContactTask);
}

export function checkEscalations(db?: Database): Array<{ task: ContactTask; rules_triggered: EscalationRule[] }> {
  const overdue = listOverdueTasks(db);
  const now_ms = Date.now();

  const results: Array<{ task: ContactTask; rules_triggered: EscalationRule[] }> = [];

  for (const task of overdue) {
    if (!task.deadline || task.escalation_rules.length === 0) continue;

    const deadlineMs = new Date(task.deadline).getTime();
    const daysPastDeadline = (now_ms - deadlineMs) / (1000 * 60 * 60 * 24);

    const triggered = task.escalation_rules.filter(
      rule => daysPastDeadline >= rule.after_days
    );

    if (triggered.length > 0) {
      results.push({ task, rules_triggered: triggered });
    }
  }

  return results;
}
