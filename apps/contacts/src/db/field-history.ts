import { Database } from "bun:sqlite";
import { getDatabase, uuid, now } from "./database.js";

export interface ContactFieldHistory {
  id: string;
  contact_id: string;
  field_name: string;
  old_value?: string | null;
  new_value?: string | null;
  valid_from: string;
  source?: string | null;
  confidence: "verified" | "inferred" | "imported" | "stale";
  created_by?: string | null;
  created_at: string;
}

export function recordFieldChange(
  contactId: string,
  fieldName: string,
  oldValue: unknown,
  newValue: unknown,
  source?: string,
  createdBy?: string,
  db?: Database,
): void {
  const _db = db || getDatabase();
  _db
    .query(
      `INSERT INTO contact_field_history(id,contact_id,field_name,old_value,new_value,valid_from,source,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      uuid(),
      contactId,
      fieldName,
      oldValue != null ? String(oldValue) : null,
      newValue != null ? String(newValue) : null,
      now(),
      source || null,
      createdBy || null,
      now(),
    );
}

export function getFieldHistory(
  contactId: string,
  fieldName?: string,
  db?: Database,
): ContactFieldHistory[] {
  const _db = db || getDatabase();
  if (fieldName) {
    return _db
      .query(
        `SELECT * FROM contact_field_history WHERE contact_id=? AND field_name=? ORDER BY valid_from DESC`,
      )
      .all(contactId, fieldName) as ContactFieldHistory[];
  }
  return _db
    .query(
      `SELECT * FROM contact_field_history WHERE contact_id=? ORDER BY valid_from DESC`,
    )
    .all(contactId) as ContactFieldHistory[];
}

export function getContactAt(
  contactId: string,
  timestamp: string,
  db?: Database,
): Record<string, string> {
  const _db = db || getDatabase();
  // Get all field changes up to timestamp, return last value per field
  const rows = _db
    .query(
      `SELECT field_name, new_value FROM contact_field_history WHERE contact_id=? AND valid_from<=? ORDER BY valid_from ASC`,
    )
    .all(contactId, timestamp) as { field_name: string; new_value: string }[];
  const result: Record<string, string> = {};
  for (const r of rows) {
    if (r.new_value != null) result[r.field_name] = r.new_value;
  }
  return result;
}
