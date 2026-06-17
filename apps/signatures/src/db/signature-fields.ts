import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { SignatureField, FieldType, RecipientStatus, SignerType } from "../types/index.js";
import { NotFoundError } from "../types/index.js";
import { assertSignerType } from "./people.js";

function rowToField(row: Record<string, unknown>): SignatureField {
  return {
    id: row["id"] as string,
    document_id: row["document_id"] as string,
    page: row["page"] as number,
    x: row["x"] as number,
    y: row["y"] as number,
    width: row["width"] as number | undefined,
    height: row["height"] as number | undefined,
    unit: (row["unit"] as "percent" | "pdf_points" | undefined) ?? "percent",
    anchor: row["anchor"] as string | undefined,
    field_type: row["field_type"] as FieldType,
    label: row["label"] as string | undefined,
    required: row["required"] as number,
    detected: row["detected"] as number,
    assigned_to: row["assigned_to"] as string | undefined,
    signer_type: (row["signer_type"] as SignerType | undefined) ?? "human",
    role: row["role"] as string | undefined,
    signing_order: (row["signing_order"] as number | undefined) ?? 1,
    parallel_group: (row["parallel_group"] as number | undefined) ?? 1,
    recipient_status: (row["recipient_status"] as RecipientStatus | undefined) ?? "pending",
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
  unit?: "percent" | "pdf_points";
  anchor?: string;
  field_type?: FieldType;
  label?: string;
  required?: number;
  detected?: number;
  assigned_to?: string;
  signer_type?: SignerType;
  role?: string;
  signing_order?: number;
  parallel_group?: number;
  recipient_status?: RecipientStatus;
}): SignatureField {
  const db = getDatabase();
  const id = `fld-${nanoid(8)}`;
  const signerType = assertSignerType(data.signer_type ?? "human");

  db.query(
    `INSERT INTO signature_fields (id, document_id, page, x, y, width, height, unit, anchor, field_type, label, required, detected, assigned_to, signer_type, role, signing_order, parallel_group, recipient_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.document_id,
    data.page,
    data.x,
    data.y,
    data.width ?? null,
    data.height ?? null,
    data.unit ?? "percent",
    data.anchor ?? null,
    data.field_type ?? "signature",
    data.label ?? null,
    data.required ?? 1,
    data.detected ?? 0,
    data.assigned_to ?? null,
    signerType,
    data.role ?? null,
    data.signing_order ?? 1,
    data.parallel_group ?? data.signing_order ?? 1,
    data.recipient_status ?? "pending"
  );

  return getFieldById(id);
}

export function updateFieldRecipientStatus(id: string, recipientStatus: RecipientStatus): SignatureField {
  const db = getDatabase();
  getFieldById(id);
  db.query("UPDATE signature_fields SET recipient_status = ? WHERE id = ?").run(recipientStatus, id);
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
