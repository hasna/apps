import type { Database } from "bun:sqlite";
import type { Assignment, Capability, Member } from "../types/index.js";
import { now, uuid } from "./database.js";

// Low-level row operations. Domain rules, validation, authorization and audit
// live in src/services/*; this module only reads/writes rows.

// ---- members ----

export interface MemberRowInput {
  kind: Member["kind"];
  name: string;
  owner_id: string | null;
  role: string;
  home_entity_id: string;
  home_entity_slug: string | null;
  status: Member["status"];
  email: string | null;
}

export function insertMember(db: Database, input: MemberRowInput): Member {
  const id = uuid();
  const ts = now();
  db.query(
    `INSERT INTO members (id, kind, name, owner_id, role, home_entity_id, home_entity_slug, status, email, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(id, input.kind, input.name, input.owner_id, input.role, input.home_entity_id, input.home_entity_slug, input.status, input.email, ts, ts);
  return getMemberRow(db, id)!;
}

export function getMemberRow(db: Database, id: string): Member | null {
  return (db.query("SELECT * FROM members WHERE id = ?").get(id) as Member | null) ?? null;
}

export function listMemberRows(
  db: Database,
  filter: { kind?: string; status?: string; owner_id?: string; entity_id?: string; allowedEntities?: string[] | null },
): Member[] {
  const clauses: string[] = [];
  const args: string[] = [];
  if (filter.kind) {
    clauses.push("kind = ?");
    args.push(filter.kind);
  }
  if (filter.status) {
    clauses.push("status = ?");
    args.push(filter.status);
  }
  if (filter.owner_id) {
    clauses.push("owner_id = ?");
    args.push(filter.owner_id);
  }
  if (filter.entity_id) {
    clauses.push("home_entity_id = ?");
    args.push(filter.entity_id);
  }
  if (filter.allowedEntities && filter.allowedEntities.length > 0) {
    clauses.push(`home_entity_id IN (${filter.allowedEntities.map(() => "?").join(",")})`);
    args.push(...filter.allowedEntities);
  } else if (filter.allowedEntities && filter.allowedEntities.length === 0) {
    return [];
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.query(`SELECT * FROM members ${where} ORDER BY created_at ASC, id ASC`).all(...args) as Member[];
}

export function updateMemberRow(db: Database, id: string, patch: Partial<MemberRowInput>, expectedVersion?: number): Member {
  const current = getMemberRow(db, id)!;
  const next: MemberRowInput = {
    kind: current.kind,
    name: patch.name ?? current.name,
    owner_id: patch.owner_id !== undefined ? patch.owner_id : current.owner_id,
    role: patch.role ?? current.role,
    home_entity_id: patch.home_entity_id ?? current.home_entity_id,
    home_entity_slug: patch.home_entity_slug !== undefined ? patch.home_entity_slug : current.home_entity_slug,
    status: patch.status ?? current.status,
    email: patch.email !== undefined ? patch.email : current.email,
  };
  const version = current.version + 1;
  const result = db
    .query(
      `UPDATE members SET name = ?, owner_id = ?, role = ?, home_entity_id = ?, home_entity_slug = ?, status = ?, email = ?, updated_at = ?, version = ?
       WHERE id = ? AND version = ?`,
    )
    .run(next.name, next.owner_id, next.role, next.home_entity_id, next.home_entity_slug, next.status, next.email, now(), version, id, expectedVersion ?? current.version);
  if (result.changes === 0) {
    throw new VersionConflict();
  }
  return getMemberRow(db, id)!;
}

class VersionConflict extends Error {
  code = "VERSION_CONFLICT";
}

// ---- capabilities ----

export function insertCapability(
  db: Database,
  input: { member_id: string; name: string; category: string; level: Capability["level"]; notes: string | null },
): Capability {
  const id = uuid();
  db.query(
    `INSERT INTO capabilities (id, member_id, name, category, level, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.member_id, input.name, input.category, input.level, input.notes, now());
  return getCapabilityRow(db, id)!;
}

export function getCapabilityRow(db: Database, id: string): Capability | null {
  return (db.query("SELECT * FROM capabilities WHERE id = ?").get(id) as Capability | null) ?? null;
}

export function listCapabilityRows(db: Database, memberId?: string): Capability[] {
  return (memberId
    ? db.query("SELECT * FROM capabilities WHERE member_id = ? ORDER BY created_at ASC, id ASC").all(memberId)
    : db.query("SELECT * FROM capabilities ORDER BY created_at ASC, id ASC").all()) as Capability[];
}

export function deleteCapabilityRow(db: Database, id: string): boolean {
  return db.query("DELETE FROM capabilities WHERE id = ?").run(id).changes > 0;
}

// ---- assignments ----

export interface AssignmentRowInput {
  member_id: string;
  entity_id: string;
  project: string | null;
  role_on_assignment: string;
  allocation_pct: number;
  start_date: string;
  end_date: string | null;
  status: Assignment["status"];
}

export function insertAssignment(db: Database, input: AssignmentRowInput): Assignment {
  const id = uuid();
  const ts = now();
  db.query(
    `INSERT INTO assignments (id, member_id, entity_id, project, role_on_assignment, allocation_pct, start_date, end_date, status, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(id, input.member_id, input.entity_id, input.project, input.role_on_assignment, input.allocation_pct, input.start_date, input.end_date, input.status, ts, ts);
  return getAssignmentRow(db, id)!;
}

export function getAssignmentRow(db: Database, id: string): Assignment | null {
  return (db.query("SELECT * FROM assignments WHERE id = ?").get(id) as Assignment | null) ?? null;
}

export function listAssignmentRows(
  db: Database,
  filter: { member_id?: string; entity_id?: string; status?: string; allowedEntities?: string[] | null },
): Assignment[] {
  const clauses: string[] = [];
  const args: string[] = [];
  if (filter.member_id) {
    clauses.push("member_id = ?");
    args.push(filter.member_id);
  }
  if (filter.entity_id) {
    clauses.push("entity_id = ?");
    args.push(filter.entity_id);
  }
  if (filter.status) {
    clauses.push("status = ?");
    args.push(filter.status);
  }
  if (filter.allowedEntities && filter.allowedEntities.length > 0) {
    clauses.push(`entity_id IN (${filter.allowedEntities.map(() => "?").join(",")})`);
    args.push(...filter.allowedEntities);
  } else if (filter.allowedEntities && filter.allowedEntities.length === 0) {
    return [];
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.query(`SELECT * FROM assignments ${where} ORDER BY created_at ASC, id ASC`).all(...args) as Assignment[];
}

export function updateAssignmentRow(db: Database, id: string, patch: Partial<AssignmentRowInput>, expectedVersion?: number): Assignment {
  const current = getAssignmentRow(db, id)!;
  const next: AssignmentRowInput = {
    member_id: current.member_id,
    entity_id: patch.entity_id ?? current.entity_id,
    project: patch.project !== undefined ? patch.project : current.project,
    role_on_assignment: patch.role_on_assignment ?? current.role_on_assignment,
    allocation_pct: patch.allocation_pct ?? current.allocation_pct,
    start_date: patch.start_date ?? current.start_date,
    end_date: patch.end_date !== undefined ? patch.end_date : current.end_date,
    status: patch.status ?? current.status,
  };
  const version = current.version + 1;
  const result = db
    .query(
      `UPDATE assignments SET entity_id = ?, project = ?, role_on_assignment = ?, allocation_pct = ?, start_date = ?, end_date = ?, status = ?, updated_at = ?, version = ?
       WHERE id = ? AND version = ?`,
    )
    .run(next.entity_id, next.project, next.role_on_assignment, next.allocation_pct, next.start_date, next.end_date, next.status, now(), version, id, expectedVersion ?? current.version);
  if (result.changes === 0) throw new VersionConflict();
  return getAssignmentRow(db, id)!;
}
