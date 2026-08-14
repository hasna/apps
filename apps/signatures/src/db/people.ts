import { nanoid } from "nanoid";
import { getDatabase } from "./database.js";
import type { Person, SignerType } from "../types/index.js";
import { DuplicateError, NotFoundError } from "../types/index.js";

function rowToPerson(row: Record<string, unknown>): Person {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    email: row["email"] as string | undefined,
    phone: row["phone"] as string | undefined,
    company: row["company"] as string | undefined,
    role: row["role"] as string | undefined,
    signer_type: (row["signer_type"] as SignerType | undefined) ?? "human",
    agent_id: row["agent_id"] as string | undefined,
    agent_provider: row["agent_provider"] as string | undefined,
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
  signer_type?: SignerType;
  agent_id?: string;
  agent_provider?: string;
  metadata?: Record<string, unknown>;
}): Person {
  const db = getDatabase();
  const email = data.email?.trim() || undefined;
  const signerType = assertSignerType(data.signer_type ?? "human");

  if (email) {
    const existing = db
      .query<{ id: string }, [string]>("SELECT id FROM people WHERE email = ?")
      .get(email);
    if (existing) throw new DuplicateError("Person", "email", email);
  }
  if (signerType === "agent" && data.agent_id) {
    const existing = db
      .query<{ id: string }, [string]>("SELECT id FROM people WHERE agent_id = ?")
      .get(data.agent_id);
    if (existing) throw new DuplicateError("Person", "agent_id", data.agent_id);
  }

  const id = `per-${nanoid(8)}`;
  db.query(
    `INSERT INTO people (id, name, email, phone, company, role, signer_type, agent_id, agent_provider, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.name,
    email ?? null,
    data.phone ?? null,
    data.company ?? null,
    data.role ?? null,
    signerType,
    data.agent_id ?? null,
    data.agent_provider ?? null,
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
    .query<Record<string, unknown>, [string, string, string]>(
      "SELECT * FROM people WHERE id = ? OR email = ? OR agent_id = ?"
    )
    .get(idOrEmail, idOrEmail, idOrEmail);
  if (!row) throw new NotFoundError("Person", idOrEmail);
  return rowToPerson(row);
}

export function listPeople(filters?: { query?: string; signer_type?: SignerType; limit?: number; offset?: number }): Person[] {
  const db = getDatabase();
  const limit = filters?.limit ?? 100;
  const offset = filters?.offset ?? 0;
  const where: string[] = [];
  const values: unknown[] = [];

  if (filters?.query) {
    const q = `%${filters.query}%`;
    where.push("(name LIKE ? OR email LIKE ? OR company LIKE ? OR agent_id LIKE ?)");
    values.push(q, q, q, q);
  }
  if (filters?.signer_type) {
    where.push("signer_type = ?");
    values.push(assertSignerType(filters.signer_type));
  }

  values.push(limit, offset);
  const rows = db
    .query<Record<string, unknown>>(
      `SELECT * FROM people${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    )
    .all(...values);
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
  for (const field of ["name", "email", "phone", "company", "role", "agent_id", "agent_provider"] as const) {
    if (field in data) {
      fields.push(`${field} = ?`);
      values.push(data[field] ?? null);
    }
  }
  if (data.signer_type !== undefined) {
    fields.push("signer_type = ?");
    values.push(assertSignerType(data.signer_type));
  }
  if (data.metadata !== undefined) {
    fields.push("metadata = ?");
    values.push(JSON.stringify(data.metadata));
  }
  values.push(id);

  db.query(`UPDATE people SET ${fields.join(", ")} WHERE id = ?`).run(...(values as [string]));
  return getPersonById(id);
}

export function assertSignerType(value: unknown): SignerType {
  if (value === "human" || value === "agent") return value;
  throw new Error("signer_type must be one of: human, agent");
}

export function deletePerson(id: string): void {
  const db = getDatabase();
  const existing = db
    .query<{ id: string }, [string]>("SELECT id FROM people WHERE id = ?")
    .get(id);
  if (!existing) throw new NotFoundError("Person", id);
  db.query("DELETE FROM people WHERE id = ?").run(id);
}
