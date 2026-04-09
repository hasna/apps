import type { ContactsDatabase } from "./database.js";
import type {
  VendorCommunication,
  CreateVendorCommunicationInput,
  UpdateVendorCommunicationInput,
  VendorCommType,
  VendorCommDirection,
  VendorCommStatus,
} from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

// ─── Row mapper ───────────────────────────────────────────────────────────────

interface VendorCommRow {
  id: string;
  company_id: string;
  contact_id: string | null;
  comm_date: string;
  type: string;
  direction: string;
  subject: string | null;
  body: string | null;
  status: string;
  invoice_amount: number | null;
  invoice_currency: string | null;
  invoice_ref: string | null;
  follow_up_date: string | null;
  follow_up_done: number;
  created_at: string;
}

function rowToVendorComm(row: VendorCommRow): VendorCommunication {
  return {
    id: row.id,
    company_id: row.company_id,
    contact_id: row.contact_id,
    comm_date: row.comm_date,
    type: row.type as VendorCommType,
    direction: row.direction as VendorCommDirection,
    subject: row.subject,
    body: row.body,
    status: row.status as VendorCommStatus,
    invoice_amount: row.invoice_amount,
    invoice_currency: row.invoice_currency,
    invoice_ref: row.invoice_ref,
    follow_up_date: row.follow_up_date,
    follow_up_done: !!row.follow_up_done,
    created_at: row.created_at,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function logVendorCommunication(input: CreateVendorCommunicationInput, db?: ContactsDatabase): VendorCommunication {
  const d = db || getDatabase();
  const id = uuid();

  d.run(
    `INSERT INTO vendor_communications
      (id, company_id, contact_id, comm_date, type, direction, subject, body, status,
       invoice_amount, invoice_currency, invoice_ref, follow_up_date, follow_up_done)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.company_id,
      input.contact_id ?? null,
      input.comm_date,
      input.type ?? 'email',
      input.direction ?? 'outbound',
      input.subject ?? null,
      input.body ?? null,
      input.status ?? 'sent',
      input.invoice_amount ?? null,
      input.invoice_currency ?? null,
      input.invoice_ref ?? null,
      input.follow_up_date ?? null,
      input.follow_up_done ? 1 : 0,
    ]
  );

  return rowToVendorComm(
    d.query(`SELECT * FROM vendor_communications WHERE id = ?`).get(id) as VendorCommRow
  );
}

export interface ListVendorCommsOptions {
  type?: VendorCommType;
  status?: VendorCommStatus;
  direction?: VendorCommDirection;
}

export function listVendorCommunications(
  companyId: string,
  opts: ListVendorCommsOptions = {},
  db?: ContactsDatabase
): VendorCommunication[] {
  const d = db || getDatabase();

  const conditions: string[] = ["company_id = ?"];
  const params: (string | number)[] = [companyId];

  if (opts.type) { conditions.push("type = ?"); params.push(opts.type); }
  if (opts.status) { conditions.push("status = ?"); params.push(opts.status); }
  if (opts.direction) { conditions.push("direction = ?"); params.push(opts.direction); }

  const where = conditions.join(" AND ");
  const rows = d.query(
    `SELECT * FROM vendor_communications WHERE ${where} ORDER BY comm_date DESC`
  ).all(...params) as VendorCommRow[];

  return rows.map(rowToVendorComm);
}

export function updateVendorCommunication(
  id: string,
  input: UpdateVendorCommunicationInput,
  db?: ContactsDatabase
): VendorCommunication {
  const d = db || getDatabase();

  const setClauses: string[] = [];
  const params: (string | number | null)[] = [];

  if ("contact_id" in input) { setClauses.push("contact_id = ?"); params.push(input.contact_id ?? null); }
  if (input.comm_date !== undefined) { setClauses.push("comm_date = ?"); params.push(input.comm_date); }
  if (input.type !== undefined) { setClauses.push("type = ?"); params.push(input.type); }
  if (input.direction !== undefined) { setClauses.push("direction = ?"); params.push(input.direction); }
  if ("subject" in input) { setClauses.push("subject = ?"); params.push(input.subject ?? null); }
  if ("body" in input) { setClauses.push("body = ?"); params.push(input.body ?? null); }
  if (input.status !== undefined) { setClauses.push("status = ?"); params.push(input.status); }
  if ("invoice_amount" in input) { setClauses.push("invoice_amount = ?"); params.push(input.invoice_amount ?? null); }
  if ("invoice_currency" in input) { setClauses.push("invoice_currency = ?"); params.push(input.invoice_currency ?? null); }
  if ("invoice_ref" in input) { setClauses.push("invoice_ref = ?"); params.push(input.invoice_ref ?? null); }
  if ("follow_up_date" in input) { setClauses.push("follow_up_date = ?"); params.push(input.follow_up_date ?? null); }
  if (input.follow_up_done !== undefined) { setClauses.push("follow_up_done = ?"); params.push(input.follow_up_done ? 1 : 0); }

  if (setClauses.length > 0) {
    params.push(id);
    d.run(`UPDATE vendor_communications SET ${setClauses.join(", ")} WHERE id = ?`, params);
  }

  return rowToVendorComm(
    d.query(`SELECT * FROM vendor_communications WHERE id = ?`).get(id) as VendorCommRow
  );
}

export function deleteVendorCommunication(id: string, db?: ContactsDatabase): void {
  const d = db || getDatabase();
  d.run(`DELETE FROM vendor_communications WHERE id = ?`, [id]);
}

export function listPendingFollowUps(db?: ContactsDatabase): VendorCommunication[] {
  const d = db || getDatabase();
  const today = new Date().toISOString().slice(0, 10);
  const rows = d.query(
    `SELECT * FROM vendor_communications
     WHERE follow_up_date <= ? AND follow_up_done = 0
     ORDER BY follow_up_date ASC`
  ).all(today) as VendorCommRow[];
  return rows.map(rowToVendorComm);
}

export function listMissingInvoices(db?: ContactsDatabase): VendorCommunication[] {
  const d = db || getDatabase();
  const rows = d.query(
    `SELECT * FROM vendor_communications
     WHERE type = 'invoice_request' AND status IN ('awaiting_response','no_response')
     ORDER BY comm_date ASC`
  ).all() as VendorCommRow[];
  return rows.map(rowToVendorComm);
}

export function markFollowUpDone(id: string, db?: ContactsDatabase): VendorCommunication {
  const d = db || getDatabase();
  d.run(`UPDATE vendor_communications SET follow_up_done = 1 WHERE id = ?`, [id]);
  return rowToVendorComm(
    d.query(`SELECT * FROM vendor_communications WHERE id = ?`).get(id) as VendorCommRow
  );
}
