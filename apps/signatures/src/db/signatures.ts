import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { Signature, SignatureType } from "../types/index.js";
import { NotFoundError } from "../types/index.js";

function rowToSignature(row: Record<string, unknown>): Signature {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    type: row["type"] as SignatureType,
    font_family: row["font_family"] as string | undefined,
    font_size: row["font_size"] as number,
    color: row["color"] as string,
    text_value: row["text_value"] as string | undefined,
    image_path: row["image_path"] as string | undefined,
    image_prompt: row["image_prompt"] as string | undefined,
    width: row["width"] as number | undefined,
    height: row["height"] as number | undefined,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
  };
}

export function createSignature(data: {
  name: string;
  type: SignatureType;
  font_family?: string;
  font_size?: number;
  color?: string;
  text_value?: string;
  image_path?: string;
  image_prompt?: string;
  width?: number;
  height?: number;
}): Signature {
  const db = getDatabase();
  const id = `sig-${nanoid(8)}`;

  db.query(
    `INSERT INTO signatures (id, name, type, font_family, font_size, color, text_value, image_path, image_prompt, width, height)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.name,
    data.type,
    data.font_family ?? null,
    data.font_size ?? 48,
    data.color ?? "#000000",
    data.text_value ?? null,
    data.image_path ?? null,
    data.image_prompt ?? null,
    data.width ?? null,
    data.height ?? null
  );

  return getSignatureById(id);
}

export function getSignatureById(id: string): Signature {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>(
      "SELECT * FROM signatures WHERE id = ?"
    )
    .get(id);
  if (!row) throw new NotFoundError("Signature", id);
  return rowToSignature(row);
}

export function listSignatures(type?: SignatureType): Signature[] {
  const db = getDatabase();
  if (type) {
    const rows = db
      .query<Record<string, unknown>, [string]>(
        "SELECT * FROM signatures WHERE type = ? ORDER BY created_at DESC"
      )
      .all(type);
    return rows.map(rowToSignature);
  }
  const rows = db
    .query<Record<string, unknown>, []>(
      "SELECT * FROM signatures ORDER BY created_at DESC"
    )
    .all();
  return rows.map(rowToSignature);
}

export function updateSignature(
  id: string,
  data: Partial<Omit<Signature, "id" | "created_at">>
): Signature {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM signatures WHERE id = ?"
    )
    .get(id);
  if (!existing) throw new NotFoundError("Signature", id);

  const fields: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  const simpleFields: (keyof Signature)[] = [
    "name", "type", "font_family", "font_size", "color",
    "text_value", "image_path", "image_prompt", "width", "height",
  ];

  for (const field of simpleFields) {
    const val = (data as Record<string, unknown>)[field as string];
    if (field in data && val !== undefined) {
      fields.push(`${field} = ?`);
      values.push(val);
    }
  }

  values.push(id);
  db.query(`UPDATE signatures SET ${fields.join(", ")} WHERE id = ?`).run(...(values as [string]));
  return getSignatureById(id);
}

export function deleteSignature(id: string): void {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM signatures WHERE id = ?"
    )
    .get(id);
  if (!existing) throw new NotFoundError("Signature", id);
  db.query("DELETE FROM signatures WHERE id = ?").run(id);
}
