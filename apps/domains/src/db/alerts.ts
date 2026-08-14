/**
 * Alert types and CRUD operations
 */

import { getDatabase } from "./database.js";

// --- Alert types ---

export interface Alert {
  id: string;
  domain_id: string;
  type: "expiry" | "ssl_expiry" | "dns_change";
  trigger_days_before: number | null;
  sent_at: string | null;
  created_at: string;
}

interface AlertRow {
  id: string;
  domain_id: string;
  type: string;
  trigger_days_before: number | null;
  sent_at: string | null;
  created_at: string;
}

function rowToAlert(row: AlertRow): Alert {
  return {
    ...row,
    type: row.type as Alert["type"],
  };
}

// ============================================================
// Alert CRUD
// ============================================================

export interface CreateAlertInput {
  domain_id: string;
  type: Alert["type"];
  trigger_days_before?: number;
}

export function createAlert(input: CreateAlertInput): Alert {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO alerts (id, domain_id, type, trigger_days_before)
     VALUES (?, ?, ?, ?)`
  ).run(id, input.domain_id, input.type, input.trigger_days_before ?? null);

  return getAlert(id)!;
}

export function getAlert(id: string): Alert | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM alerts WHERE id = ?").get(id) as AlertRow | null;
  return row ? rowToAlert(row) : null;
}

export function listAlerts(domainId: string): Alert[] {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT * FROM alerts WHERE domain_id = ? ORDER BY type, trigger_days_before")
    .all(domainId) as AlertRow[];
  return rows.map(rowToAlert);
}

export function deleteAlert(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM alerts WHERE id = ?").run(id);
  return result.changes > 0;
}
