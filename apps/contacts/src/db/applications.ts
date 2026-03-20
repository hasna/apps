import type { Database } from "bun:sqlite";
import type {
  Application,
  CreateApplicationInput,
  UpdateApplicationInput,
  ListApplicationsOptions,
  ApplicationType,
  ApplicationStatus,
  ApplicationMethod,
} from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

// ─── Row mapper ───────────────────────────────────────────────────────────────

interface ApplicationRow {
  id: string;
  program_name: string;
  provider_company_id: string | null;
  type: string;
  value_usd: number | null;
  applicant_contact_id: string | null;
  primary_contact_id: string | null;
  status: string;
  submitted_date: string | null;
  decision_date: string | null;
  follow_up_date: string | null;
  notes: string | null;
  method: string | null;
  form_url: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function rowToApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    program_name: row.program_name,
    provider_company_id: row.provider_company_id,
    type: row.type as ApplicationType,
    value_usd: row.value_usd,
    applicant_contact_id: row.applicant_contact_id,
    primary_contact_id: row.primary_contact_id,
    status: row.status as ApplicationStatus,
    submitted_date: row.submitted_date,
    decision_date: row.decision_date,
    follow_up_date: row.follow_up_date,
    notes: row.notes,
    method: (row.method ?? null) as ApplicationMethod | null,
    form_url: row.form_url,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createApplication(input: CreateApplicationInput, db?: Database): Application {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO applications
      (id, program_name, provider_company_id, type, value_usd, applicant_contact_id, primary_contact_id,
       status, submitted_date, decision_date, follow_up_date, notes, method, form_url, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.program_name,
      input.provider_company_id ?? null,
      input.type ?? 'other',
      input.value_usd ?? null,
      input.applicant_contact_id ?? null,
      input.primary_contact_id ?? null,
      input.status ?? 'draft',
      input.submitted_date ?? null,
      input.decision_date ?? null,
      input.follow_up_date ?? null,
      input.notes ?? null,
      input.method ?? null,
      input.form_url ?? null,
      JSON.stringify(input.metadata ?? {}),
      timestamp,
      timestamp,
    ]
  );

  return rowToApplication(
    d.query(`SELECT * FROM applications WHERE id = ?`).get(id) as ApplicationRow
  );
}

export function getApplication(id: string, db?: Database): Application | null {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM applications WHERE id = ?`).get(id) as ApplicationRow | null;
  return row ? rowToApplication(row) : null;
}

export function listApplications(opts: ListApplicationsOptions = {}, db?: Database): Application[] {
  const d = db || getDatabase();

  const conditions: string[] = [];
  const params: string[] = [];

  if (opts.type) { conditions.push("type = ?"); params.push(opts.type); }
  if (opts.status) { conditions.push("status = ?"); params.push(opts.status); }
  if (opts.provider_company_id) { conditions.push("provider_company_id = ?"); params.push(opts.provider_company_id); }
  if (opts.applicant_contact_id) { conditions.push("applicant_contact_id = ?"); params.push(opts.applicant_contact_id); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = d.query(
    `SELECT * FROM applications ${where} ORDER BY created_at DESC`
  ).all(...params) as ApplicationRow[];

  return rows.map(rowToApplication);
}

export function updateApplication(id: string, input: UpdateApplicationInput, db?: Database): Application {
  const d = db || getDatabase();

  const setClauses: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now()];

  if (input.program_name !== undefined) { setClauses.push("program_name = ?"); params.push(input.program_name); }
  if ("provider_company_id" in input) { setClauses.push("provider_company_id = ?"); params.push(input.provider_company_id ?? null); }
  if (input.type !== undefined) { setClauses.push("type = ?"); params.push(input.type); }
  if ("value_usd" in input) { setClauses.push("value_usd = ?"); params.push(input.value_usd ?? null); }
  if ("applicant_contact_id" in input) { setClauses.push("applicant_contact_id = ?"); params.push(input.applicant_contact_id ?? null); }
  if ("primary_contact_id" in input) { setClauses.push("primary_contact_id = ?"); params.push(input.primary_contact_id ?? null); }
  if (input.status !== undefined) { setClauses.push("status = ?"); params.push(input.status); }
  if ("submitted_date" in input) { setClauses.push("submitted_date = ?"); params.push(input.submitted_date ?? null); }
  if ("decision_date" in input) { setClauses.push("decision_date = ?"); params.push(input.decision_date ?? null); }
  if ("follow_up_date" in input) { setClauses.push("follow_up_date = ?"); params.push(input.follow_up_date ?? null); }
  if ("notes" in input) { setClauses.push("notes = ?"); params.push(input.notes ?? null); }
  if ("method" in input) { setClauses.push("method = ?"); params.push(input.method ?? null); }
  if ("form_url" in input) { setClauses.push("form_url = ?"); params.push(input.form_url ?? null); }
  if (input.metadata !== undefined) { setClauses.push("metadata = ?"); params.push(JSON.stringify(input.metadata)); }

  params.push(id);
  d.run(`UPDATE applications SET ${setClauses.join(", ")} WHERE id = ?`, params);

  return rowToApplication(
    d.query(`SELECT * FROM applications WHERE id = ?`).get(id) as ApplicationRow
  );
}

export function deleteApplication(id: string, db?: Database): void {
  const d = db || getDatabase();
  d.run(`DELETE FROM applications WHERE id = ?`, [id]);
}

export function listFollowUpDue(db?: Database): Application[] {
  const d = db || getDatabase();
  const today = new Date().toISOString().slice(0, 10);
  const rows = d.query(
    `SELECT * FROM applications
     WHERE follow_up_date <= ? AND status = 'follow_up_needed'
     ORDER BY follow_up_date ASC`
  ).all(today) as ApplicationRow[];
  return rows.map(rowToApplication);
}

export function listPendingApplications(db?: Database): Application[] {
  const d = db || getDatabase();
  const rows = d.query(
    `SELECT * FROM applications
     WHERE status IN ('draft','submitted','pending')
     ORDER BY created_at DESC`
  ).all() as ApplicationRow[];
  return rows.map(rowToApplication);
}
