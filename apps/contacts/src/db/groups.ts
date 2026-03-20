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
    `SELECT g.*,
       (SELECT COUNT(*) FROM contact_groups cg WHERE cg.group_id = g.id) as member_count,
       (SELECT COUNT(*) FROM company_groups cog WHERE cog.group_id = g.id) as company_count
     FROM groups g ORDER BY g.name`
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

export function addContactToGroup(db: Database, contactId: string, groupId: string): { added: boolean; already_member: boolean } {
  const existing = db.query(`SELECT 1 FROM contact_groups WHERE contact_id = ? AND group_id = ?`).get(contactId, groupId);
  if (existing) return { added: false, already_member: true };
  db.query(`INSERT INTO contact_groups(contact_id, group_id) VALUES(?,?)`).run(contactId, groupId);
  return { added: true, already_member: false };
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

export function addCompanyToGroup(db: Database, companyId: string, groupId: string): { added: boolean; already_member: boolean } {
  const existing = db.query(`SELECT 1 FROM company_groups WHERE company_id = ? AND group_id = ?`).get(companyId, groupId);
  if (existing) return { added: false, already_member: true };
  db.query(`INSERT INTO company_groups(company_id, group_id) VALUES(?,?)`).run(companyId, groupId);
  return { added: true, already_member: false };
}

export function removeCompanyFromGroup(db: Database, companyId: string, groupId: string): void {
  db.query(`DELETE FROM company_groups WHERE company_id = ? AND group_id = ?`).run(companyId, groupId);
}

export function listCompaniesInGroup(db: Database, groupId: string): string[] {
  const rows = db.query(`SELECT company_id FROM company_groups WHERE group_id = ?`).all(groupId) as { company_id: string }[];
  return rows.map(r => r.company_id);
}

export function listGroupsForCompany(db: Database, companyId: string): Group[] {
  return db.query(
    `SELECT g.* FROM groups g JOIN company_groups cog ON g.id = cog.group_id WHERE cog.company_id = ? ORDER BY g.name`
  ).all(companyId) as Group[];
}
