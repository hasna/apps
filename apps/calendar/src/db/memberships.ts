import { Database } from "bun:sqlite";
import { getDatabase } from "./database.js";
import type { OrgMembership, CreateOrgMembershipInput } from "../types/index.js";
import { NotFoundError, ConflictError } from "../types/index.js";

function rowToMembership(row: any): OrgMembership {
  return {
    id: row.id,
    org_id: row.org_id,
    agent_id: row.agent_id,
    role: row.role as OrgMembership["role"],
    created_at: row.created_at,
  };
}

export function createMembership(input: CreateOrgMembershipInput, db?: Database): OrgMembership {
  db = db || getDatabase();
  const id = crypto.randomUUID().slice(0, 8);

  try {
    db.run(
      `INSERT INTO org_memberships (id, org_id, agent_id, role) VALUES (?, ?, ?, ?)`,
      [id, input.org_id, input.agent_id, input.role || "member"],
    );
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint failed")) {
      throw new ConflictError(`Agent ${input.agent_id} is already a member of org ${input.org_id}`);
    }
    throw e;
  }

  return getMembership(id, db)!;
}

export function getMembership(id: string, db?: Database): OrgMembership | null {
  db = db || getDatabase();
  const row = db.query("SELECT * FROM org_memberships WHERE id = ?").get(id);
  return row ? rowToMembership(row) : null;
}

export function getMembershipByAgentAndOrg(agentId: string, orgId: string, db?: Database): OrgMembership | null {
  db = db || getDatabase();
  const row = db.query("SELECT * FROM org_memberships WHERE agent_id = ? AND org_id = ?").get(agentId, orgId);
  return row ? rowToMembership(row) : null;
}

export function getMembershipsForOrg(orgId: string, db?: Database): OrgMembership[] {
  db = db || getDatabase();
  const rows = db.query("SELECT * FROM org_memberships WHERE org_id = ? ORDER BY role DESC, created_at").all(orgId);
  return (rows as any[]).map(rowToMembership);
}

export function getOrgsForAgent(agentId: string, db?: Database): OrgMembership[] {
  db = db || getDatabase();
  const rows = db.query("SELECT * FROM org_memberships WHERE agent_id = ? ORDER BY role DESC").all(agentId);
  return (rows as any[]).map(rowToMembership);
}

export function updateMembershipRole(id: string, role: "admin" | "member" | "service", db?: Database): OrgMembership {
  db = db || getDatabase();
  const existing = getMembership(id, db);
  if (!existing) throw new NotFoundError("OrgMembership", id);

  db.run(`UPDATE org_memberships SET role = ? WHERE id = ?`, [role, id]);
  return getMembership(id, db)!;
}

export function deleteMembership(id: string, db?: Database): boolean {
  db = db || getDatabase();
  const result = db.run(`DELETE FROM org_memberships WHERE id = ?`, [id]);
  return result.changes > 0;
}

export function deleteMembershipByAgentAndOrg(agentId: string, orgId: string, db?: Database): boolean {
  db = db || getDatabase();
  const result = db.run(`DELETE FROM org_memberships WHERE agent_id = ? AND org_id = ?`, [agentId, orgId]);
  return result.changes > 0;
}
