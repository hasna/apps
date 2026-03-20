import { Database } from "bun:sqlite";
import { uuid, now } from "./database.js";
import type { Group, CreateGroupInput } from "../types/index.js";

export function createGroup(db: Database, input: CreateGroupInput): Group {
  const id = uuid();
  db.query(`INSERT INTO groups(id, name, description, created_at, updated_at) VALUES(?,?,?,?,?)`)
    .run(id, input.name, input.description ?? null, now(), now());
  return getGroup(db, id)!;
}

export function getGroup(db: Database, id: string): Group | null {
  return db.query(`SELECT * FROM groups WHERE id = ?`).get(id) as Group | null;
}

export function listGroups(db: Database): Group[] {
  return db.query(
    `SELECT g.*, COUNT(cg.contact_id) as member_count FROM groups g LEFT JOIN contact_groups cg ON g.id = cg.group_id GROUP BY g.id ORDER BY g.name`
  ).all() as Group[];
}

export function updateGroup(db: Database, id: string, input: Partial<CreateGroupInput>): Group {
  const fields: string[] = [];
  const vals: (string | null)[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); vals.push(input.name); }
  if (input.description !== undefined) { fields.push("description = ?"); vals.push(input.description ?? null); }
  fields.push("updated_at = ?"); vals.push(now());
  vals.push(id);
  db.query(`UPDATE groups SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
  return getGroup(db, id)!;
}

export function deleteGroup(db: Database, id: string): void {
  db.query(`DELETE FROM groups WHERE id = ?`).run(id);
}

export function addContactToGroup(db: Database, contactId: string, groupId: string): void {
  db.query(`INSERT OR IGNORE INTO contact_groups(contact_id, group_id) VALUES(?,?)`).run(contactId, groupId);
}

export function removeContactFromGroup(db: Database, contactId: string, groupId: string): void {
  db.query(`DELETE FROM contact_groups WHERE contact_id = ? AND group_id = ?`).run(contactId, groupId);
}

export function listContactsInGroup(db: Database, groupId: string): string[] {
  const rows = db.query(`SELECT contact_id FROM contact_groups WHERE group_id = ?`).all(groupId) as { contact_id: string }[];
  return rows.map(r => r.contact_id);
}

export function listGroupsForContact(db: Database, contactId: string): Group[] {
  return db.query(
    `SELECT g.* FROM groups g JOIN contact_groups cg ON g.id = cg.group_id WHERE cg.contact_id = ? ORDER BY g.name`
  ).all(contactId) as Group[];
}
