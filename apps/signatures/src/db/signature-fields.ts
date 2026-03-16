import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { SignatureField, FieldType } from "../types/index.js";
import { NotFoundError } from "../types/index.js";

function rowToField(row: Record<string, unknown>): SignatureField {
  return {
    id: row["id"] as string,
    document_id: row["document_id"] as string,
    page: row["page"] as number,
    x: row["x"] as number,
    y: row["y"] as number,
    width: row["width"] as number | undefined,
    height: row["height"] as number | undefined,
    field_type: row["field_type"] as FieldType,
    label: row["label"] as string | undefined,
    required: row["required"] as number,
    detected: row["detected"] as number,
    assigned_to: row["assigned_to"] as string | undefined,
    created_at: row["created_at"] as string,
  };
}

export function createSignatureField(data: {
  document_id: string;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  field_type?: FieldType;
  label?: string;
  required?: number;
  detected?: number;
  assigned_to?: string;
}): SignatureField {
  const db = getDatabase();
  const id = `fld-${nanoid(8)}`;

  db.query(
    `INSERT INTO signature_fields (id, document_id, page, x, y, width, height, field_type, label, required, detected, assigned_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.document_id,
    data.page,
    data.x,
    data.y,
    data.width ?? null,
    data.height ?? null,
    data.field_type ?? "signature",
    data.label ?? null,
    data.required ?? 1,
    data.detected ?? 0,
    data.assigned_to ?? null
  );

  return getFieldById(id);
}

export function getFieldById(id: string): SignatureField {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM signature_fields WHERE id = ?"
    )
    .get(id);
  if (!row) throw new NotFoundError("SignatureField", id);
  return rowToField(row);
}

export function listFieldsForDocument(documentId: string): SignatureField[] {
  const db = getDatabase();
  const rows = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM signature_fields WHERE document_id = ? ORDER BY page ASC, y ASC"
    )
    .all(documentId);
  return rows.map(rowToField);
}

export function deleteFieldsForDocument(documentId: string): void {
  const db = getDatabase();
  db.query("DELETE FROM signature_fields WHERE document_id = ?").run(documentId);
}

export function deleteField(id: string): void {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM signature_fields WHERE id = ?"
    )
    .get(id);
  if (!existing) throw new NotFoundError("SignatureField", id);
  db.query("DELETE FROM signature_fields WHERE id = ?").run(id);
}
