import type { Database } from "bun:sqlite";
import type { ContactNote } from "../types/index.js";
import { ContactNotFoundError } from "../types/index.js";
import { getDatabase, uuid } from "./database.js";

export function addNote(contactId: string, body: string, createdBy?: string, db?: Database): ContactNote {
  const d = db || getDatabase();

  const contact = d.query(`SELECT id FROM contacts WHERE id = ?`).get(contactId);
  if (!contact) throw new ContactNotFoundError(contactId);

  const id = uuid();
  d.run(
    `INSERT INTO contact_notes (id, contact_id, body, created_by) VALUES (?, ?, ?, ?)`,
    [id, contactId, body, createdBy ?? null]
  );

  return d.query(`SELECT * FROM contact_notes WHERE id = ?`).get(id) as ContactNote;
}

export function listNotes(contactId: string, db?: Database): ContactNote[] {
  const d = db || getDatabase();
  return d.query(
    `SELECT * FROM contact_notes WHERE contact_id = ? ORDER BY created_at ASC`
  ).all(contactId) as ContactNote[];
}

export function deleteNote(noteId: string, db?: Database): void {
  const d = db || getDatabase();
  d.run(`DELETE FROM contact_notes WHERE id = ?`, [noteId]);
}

export function getNote(noteId: string, db?: Database): ContactNote | null {
  const d = db || getDatabase();
  return d.query(`SELECT * FROM contact_notes WHERE id = ?`).get(noteId) as ContactNote | null;
}
