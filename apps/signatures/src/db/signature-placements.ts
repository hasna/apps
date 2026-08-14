import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { SignaturePlacement } from "../types/index.js";
import { NotFoundError } from "../types/index.js";

function rowToPlacement(row: Record<string, unknown>): SignaturePlacement {
  return {
    id: row["id"] as string,
    document_id: row["document_id"] as string,
    signature_id: row["signature_id"] as string,
    field_id: row["field_id"] as string | undefined,
    page: row["page"] as number,
    x: row["x"] as number,
    y: row["y"] as number,
    width: row["width"] as number | undefined,
    height: row["height"] as number | undefined,
    signed_at: row["signed_at"] as string | undefined,
    created_at: row["created_at"] as string,
  };
}

export function createPlacement(data: {
  document_id: string;
  signature_id: string;
  field_id?: string;
  page: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
}): SignaturePlacement {
  const db = getDatabase();
  const id = `plc-${nanoid(8)}`;
  const signed_at = new Date().toISOString();

  db.query(
    `INSERT INTO signature_placements (id, document_id, signature_id, field_id, page, x, y, width, height, signed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.document_id,
    data.signature_id,
    data.field_id ?? null,
    data.page,
    data.x,
    data.y,
    data.width ?? null,
    data.height ?? null,
    signed_at
  );

  return getPlacementById(id);
}

export function getPlacementById(id: string): SignaturePlacement {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM signature_placements WHERE id = ?"
    )
    .get(id);
  if (!row) throw new NotFoundError("SignaturePlacement", id);
  return rowToPlacement(row);
}

export function listPlacementsForDocument(documentId: string): SignaturePlacement[] {
  const db = getDatabase();
  const rows = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM signature_placements WHERE document_id = ? ORDER BY page ASC, created_at ASC"
    )
    .all(documentId);
  return rows.map(rowToPlacement);
}

export function deletePlacement(id: string): void {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM signature_placements WHERE id = ?"
    )
    .get(id);
  if (!existing) throw new NotFoundError("SignaturePlacement", id);
  db.query("DELETE FROM signature_placements WHERE id = ?").run(id);
}
