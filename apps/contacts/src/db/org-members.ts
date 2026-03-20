import type { Database } from "bun:sqlite";
import type { OrgMember, CreateOrgMemberInput, UpdateOrgMemberInput } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

// ─── Row mapper ───────────────────────────────────────────────────────────────

interface OrgMemberRow {
  id: string;
  company_id: string;
  contact_id: string;
  title: string | null;
  specialization: string | null;
  office_phone: string | null;
  response_sla_hours: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToOrgMember(row: OrgMemberRow): OrgMember {
  return {
    id: row.id,
    company_id: row.company_id,
    contact_id: row.contact_id,
    title: row.title,
    specialization: row.specialization,
    office_phone: row.office_phone,
    response_sla_hours: row.response_sla_hours,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function addOrgMember(input: CreateOrgMemberInput, db?: Database): OrgMember {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO org_members (id, company_id, contact_id, title, specialization, office_phone, response_sla_hours, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.company_id,
      input.contact_id,
      input.title ?? null,
      input.specialization ?? null,
      input.office_phone ?? null,
      input.response_sla_hours ?? null,
      input.notes ?? null,
      timestamp,
      timestamp,
    ]
  );

  return rowToOrgMember(
    d.query(`SELECT * FROM org_members WHERE id = ?`).get(id) as OrgMemberRow
  );
}

export function getOrgMember(id: string, db?: Database): OrgMember | null {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM org_members WHERE id = ?`).get(id) as OrgMemberRow | null;
  return row ? rowToOrgMember(row) : null;
}

export function listOrgMembers(companyId: string, db?: Database): OrgMember[] {
  const d = db || getDatabase();
  const rows = d.query(
    `SELECT * FROM org_members WHERE company_id = ? ORDER BY created_at ASC`
  ).all(companyId) as OrgMemberRow[];
  return rows.map(rowToOrgMember);
}

export function updateOrgMember(id: string, input: UpdateOrgMemberInput, db?: Database): OrgMember {
  const d = db || getDatabase();

  const setClauses: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [now()];

  if ("title" in input) { setClauses.push("title = ?"); params.push(input.title ?? null); }
  if ("specialization" in input) { setClauses.push("specialization = ?"); params.push(input.specialization ?? null); }
  if ("office_phone" in input) { setClauses.push("office_phone = ?"); params.push(input.office_phone ?? null); }
  if ("response_sla_hours" in input) { setClauses.push("response_sla_hours = ?"); params.push(input.response_sla_hours ?? null); }
  if ("notes" in input) { setClauses.push("notes = ?"); params.push(input.notes ?? null); }

  params.push(id);
  d.run(`UPDATE org_members SET ${setClauses.join(", ")} WHERE id = ?`, params);

  return rowToOrgMember(
    d.query(`SELECT * FROM org_members WHERE id = ?`).get(id) as OrgMemberRow
  );
}

export function removeOrgMember(id: string, db?: Database): void {
  const d = db || getDatabase();
  d.run(`DELETE FROM org_members WHERE id = ?`, [id]);
}

export function listOrgMembersForContact(contactId: string, db?: Database): OrgMember[] {
  const d = db || getDatabase();
  const rows = d.query(
    `SELECT * FROM org_members WHERE contact_id = ? ORDER BY created_at ASC`
  ).all(contactId) as OrgMemberRow[];
  return rows.map(rowToOrgMember);
}
