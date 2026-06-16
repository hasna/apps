import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { Person } from "../types/index.js";
import { DuplicateError, NotFoundError } from "../types/index.js";

function rowToPerson(row: Record<string, unknown>): Person {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    email: row["email"] as string | undefined,
    phone: row["phone"] as string | undefined,
    company: row["company"] as string | undefined,
    role: row["role"] as string | undefined,
    metadata: row["metadata"]
      ? (JSON.parse(row["metadata"] as string) as Record<string, unknown>)
      : undefined,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
  };
}

export function createPerson(data: {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  role?: string;
  metadata?: Record<string, unknown>;
}): Person {
  const db = getDatabase();
  const email = data.email?.trim() || undefined;

  if (email) {
    const existing = db
      .query<{ id: string }, [string]>("SELECT id FROM people WHERE email = ?")
      .get(email);
    if (existing) throw new DuplicateError("Person", "email", email);
  }

  const id = `per-${nanoid(8)}`;
  db.query(
    `INSERT INTO people (id, name, email, phone, company, role, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.name,
    email ?? null,
    data.phone ?? null,
    data.company ?? null,
    data.role ?? null,
    data.metadata ? JSON.stringify(data.metadata) : null
  );

  return getPersonById(id);
}

export function getPersonById(id: string): Person {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>("SELECT * FROM people WHERE id = ?")
    .get(id);
  if (!row) throw new NotFoundError("Person", id);
  return rowToPerson(row);
}

export function getPersonByEmail(email: string): Person {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string]>("SELECT * FROM people WHERE email = ?")
    .get(email);
  if (!row) throw new NotFoundError("Person", email);
  return rowToPerson(row);
}

export function getPersonByIdOrEmail(idOrEmail: string): Person {
  const db = getDatabase();
  const row = db
    .query<Record<string, unknown>, [string, string]>(
      "SELECT * FROM people WHERE id = ? OR email = ?"
    )
    .get(idOrEmail, idOrEmail);
  if (!row) throw new NotFoundError("Person", idOrEmail);
  return rowToPerson(row);
}

export function listPeople(filters?: { query?: string; limit?: number; offset?: number }): Person[] {
  const db = getDatabase();
  const limit = filters?.limit ?? 100;
  const offset = filters?.offset ?? 0;

  if (filters?.query) {
    const q = `%${filters.query}%`;
    const rows = db
      .query<Record<string, unknown>, [string, string, string, number, number]>(
        `SELECT * FROM people
         WHERE name LIKE ? OR email LIKE ? OR company LIKE ?
         ORDER BY updated_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(q, q, q, limit, offset);
    return rows.map(rowToPerson);
  }

  const rows = db
    .query<Record<string, unknown>, [number, number]>(
      "SELECT * FROM people ORDER BY updated_at DESC LIMIT ? OFFSET ?"
    )
    .all(limit, offset);
  return rows.map(rowToPerson);
}

export function updatePerson(
  id: string,
  data: Partial<Omit<Person, "id" | "created_at">>
): Person {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>("SELECT id FROM people WHERE id = ?")
    .get(id);
  if (!existing) throw new NotFoundError("Person", id);

  const fields: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];
  for (const field of ["name", "email", "phone", "company", "role"] as const) {
    if (field in data) {
      fields.push(`${field} = ?`);
      values.push(data[field] ?? null);
    }
  }
  if (data.metadata !== undefined) {
    fields.push("metadata = ?");
    values.push(JSON.stringify(data.metadata));
  }
  values.push(id);

  db.query(`UPDATE people SET ${fields.join(", ")} WHERE id = ?`).run(...(values as [string]));
  return getPersonById(id);
}

export function deletePerson(id: string): void {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>("SELECT id FROM people WHERE id = ?")
    .get(id);
  if (!existing) throw new NotFoundError("Person", id);
  db.query("DELETE FROM people WHERE id = ?").run(id);
}
