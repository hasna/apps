import type { ContactsDatabase } from "./database.js";
import type { Deal, CreateDealInput, UpdateDealInput, DealStage } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

// ─── Row mapper ───────────────────────────────────────────────────────────────

interface DealRow {
  id: string;
  title: string;
  contact_id: string | null;
  company_id: string | null;
  stage: string;
  value_usd: number | null;
  currency: string;
  close_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDeal(row: DealRow): Deal {
  return {
    id: row.id,
    title: row.title,
    contact_id: row.contact_id,
    company_id: row.company_id,
    stage: row.stage as DealStage,
    value_usd: row.value_usd,
    currency: row.currency,
    close_date: row.close_date,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createDeal(input: CreateDealInput, db?: ContactsDatabase): Deal {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  d.run(
    `INSERT INTO deals (id, title, contact_id, company_id, stage, value_usd, currency, close_date, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.contact_id ?? null,
      input.company_id ?? null,
      input.stage ?? "lead",
      input.value_usd ?? null,
      input.currency ?? "USD",
      input.close_date ?? null,
      input.notes ?? null,
      timestamp,
      timestamp,
    ]
  );
  return rowToDeal(d.query(`SELECT * FROM deals WHERE id = ?`).get(id) as DealRow);
}

export function getDeal(id: string, db?: ContactsDatabase): Deal | null {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM deals WHERE id = ?`).get(id) as DealRow | null;
  return row ? rowToDeal(row) : null;
}

export interface ListDealsOptions {
  stage?: DealStage;
  contact_id?: string;
  company_id?: string;
}

export function listDeals(opts: ListDealsOptions = {}, db?: ContactsDatabase): Deal[] {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (opts.stage) { conditions.push("stage = ?"); params.push(opts.stage); }
  if (opts.contact_id) { conditions.push("contact_id = ?"); params.push(opts.contact_id); }
  if (opts.company_id) { conditions.push("company_id = ?"); params.push(opts.company_id); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = d.query(`SELECT * FROM deals ${where} ORDER BY created_at DESC`).all(...params) as DealRow[];
  return rows.map(rowToDeal);
}

export function updateDeal(id: string, input: UpdateDealInput, db?: ContactsDatabase): Deal | null {
  const d = db || getDatabase();
  const existing = d.query(`SELECT * FROM deals WHERE id = ?`).get(id) as DealRow | null;
  if (!existing) return null;

  const setClauses: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now()];

  if (input.title !== undefined) { setClauses.push("title = ?"); params.push(input.title); }
  if (input.contact_id !== undefined) { setClauses.push("contact_id = ?"); params.push(input.contact_id ?? null); }
  if (input.company_id !== undefined) { setClauses.push("company_id = ?"); params.push(input.company_id ?? null); }
  if (input.stage !== undefined) { setClauses.push("stage = ?"); params.push(input.stage); }
  if (input.value_usd !== undefined) { setClauses.push("value_usd = ?"); params.push(input.value_usd ?? null); }
  if (input.currency !== undefined) { setClauses.push("currency = ?"); params.push(input.currency); }
  if (input.close_date !== undefined) { setClauses.push("close_date = ?"); params.push(input.close_date ?? null); }
  if (input.notes !== undefined) { setClauses.push("notes = ?"); params.push(input.notes ?? null); }

  params.push(id);
  d.run(`UPDATE deals SET ${setClauses.join(", ")} WHERE id = ?`, params);
  return rowToDeal(d.query(`SELECT * FROM deals WHERE id = ?`).get(id) as DealRow);
}

export function deleteDeal(id: string, db?: ContactsDatabase): void {
  const d = db || getDatabase();
  d.run(`DELETE FROM deals WHERE id = ?`, [id]);
}

export function getDealsByStage(db?: ContactsDatabase): Record<DealStage, Deal[]> {
  const d = db || getDatabase();
  const rows = d.query(`SELECT * FROM deals ORDER BY stage, created_at DESC`).all() as DealRow[];
  const result: Record<string, Deal[]> = {};
  for (const row of rows) {
    if (!result[row.stage]) result[row.stage] = [];
    result[row.stage]!.push(rowToDeal(row));
  }
  return result as Record<DealStage, Deal[]>;
}
