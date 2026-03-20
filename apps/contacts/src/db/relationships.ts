import type { Database } from "bun:sqlite";
import type {
  ContactRelationship,
  CreateRelationshipInput,
  RelationshipRow,
} from "../types/index.js";
import { ContactNotFoundError } from "../types/index.js";
import { getDatabase, uuid } from "./database.js";

function rowToRelationship(row: RelationshipRow): ContactRelationship {
  return {
    ...row,
    relationship_type: row.relationship_type as ContactRelationship["relationship_type"],
  };
}

export function createRelationship(input: CreateRelationshipInput, db?: Database): ContactRelationship {
  const d = db || getDatabase();

  const a = d.query(`SELECT id FROM contacts WHERE id = ?`).get(input.contact_a_id);
  if (!a) throw new ContactNotFoundError(input.contact_a_id);

  const b = d.query(`SELECT id FROM contacts WHERE id = ?`).get(input.contact_b_id);
  if (!b) throw new ContactNotFoundError(input.contact_b_id);

  const id = uuid();
  d.run(
    `INSERT INTO contact_relationships (id, contact_a_id, contact_b_id, relationship_type, notes) VALUES (?, ?, ?, ?, ?)`,
    [id, input.contact_a_id, input.contact_b_id, input.relationship_type, input.notes ?? null]
  );

  return rowToRelationship(d.query(`SELECT * FROM contact_relationships WHERE id = ?`).get(id) as RelationshipRow);
}

export interface ListRelationshipsOptions {
  contact_id?: string;
  relationship_type?: ContactRelationship["relationship_type"];
}

export function listRelationships(opts: ListRelationshipsOptions = {}, db?: Database): ContactRelationship[] {
  const d = db || getDatabase();
  const { contact_id, relationship_type } = opts;

  const conditions: string[] = [];
  const params: string[] = [];

  if (contact_id) {
    conditions.push("(contact_a_id = ? OR contact_b_id = ?)");
    params.push(contact_id, contact_id);
  }

  if (relationship_type) {
    conditions.push("relationship_type = ?");
    params.push(relationship_type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = d.query(`SELECT * FROM contact_relationships ${where} ORDER BY created_at DESC`).all(...params) as RelationshipRow[];

  return rows.map(rowToRelationship);
}

export function getRelationship(id: string, db?: Database): ContactRelationship | null {
  const d = db || getDatabase();
  const row = d.query(`SELECT * FROM contact_relationships WHERE id = ?`).get(id) as RelationshipRow | null;
  return row ? rowToRelationship(row) : null;
}

export function deleteRelationship(id: string, db?: Database): void {
  const d = db || getDatabase();
  d.run(`DELETE FROM contact_relationships WHERE id = ?`, [id]);
}
