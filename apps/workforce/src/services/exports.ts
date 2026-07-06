import { getDatabase } from "../db/database.js";
import { listAssignmentRows, listCapabilityRows, listMemberRows } from "../db/crud.js";
import type { MemberKind, MemberStatus } from "../types/index.js";
import { allowedEntityIds, authorize, type AuthorizationContext } from "./authorization.js";

// Export contract that feeds payroll/timesheets (iapp-payroll, iapp-timesheets).
// This is the single documented downstream contract: a normalized roster with
// each member's employment classification, home entity, active assignments and
// capabilities. Consumers key on member_id (stable UUID) + home_entity_id.

export const ROSTER_EXPORT_SCHEMA = "hasna.workforce.roster_export.v1";

export interface RosterExportAssignment {
  assignment_id: string;
  entity_id: string;
  project: string | null;
  role_on_assignment: string;
  allocation_pct: number;
  start_date: string;
  end_date: string | null;
}

export interface RosterExportMember {
  member_id: string;
  kind: MemberKind;
  name: string;
  role: string;
  owner_id: string | null;
  home_entity_id: string;
  home_entity_slug: string | null;
  status: MemberStatus;
  email: string | null;
  /** payroll classification derived from kind: agents/contractors are non-payroll W-9/vendor style. */
  payroll_class: "employee" | "contractor" | "agent";
  capabilities: string[];
  active_assignments: RosterExportAssignment[];
}

export interface RosterExport {
  schema: typeof ROSTER_EXPORT_SCHEMA;
  generated_at: string;
  entity_id: string | null;
  member_count: number;
  members: RosterExportMember[];
}

function payrollClass(kind: MemberKind): RosterExportMember["payroll_class"] {
  if (kind === "human") return "employee";
  if (kind === "contractor") return "contractor";
  return "agent";
}

export interface ExportRosterInput {
  entity_id?: string;
  include_offboarded?: boolean;
}

export function exportRoster(input: ExportRosterInput = {}, ctx?: AuthorizationContext): RosterExport {
  authorize("export", ctx, input.entity_id ? { entity_id: input.entity_id } : {});
  const db = getDatabase();
  const scoped = allowedEntityIds(ctx);
  const members = listMemberRows(db, {
    entity_id: input.entity_id,
    allowedEntities: scoped,
  }).filter((m) => (input.include_offboarded ? true : m.status !== "offboarded"));

  const exportMembers: RosterExportMember[] = members.map((m) => {
    const caps = listCapabilityRows(db, m.id).map((c) => c.name);
    const assignments = listAssignmentRows(db, { member_id: m.id, status: "active" }).map((a) => ({
      assignment_id: a.id,
      entity_id: a.entity_id,
      project: a.project,
      role_on_assignment: a.role_on_assignment,
      allocation_pct: a.allocation_pct,
      start_date: a.start_date,
      end_date: a.end_date,
    }));
    return {
      member_id: m.id,
      kind: m.kind,
      name: m.name,
      role: m.role,
      owner_id: m.owner_id,
      home_entity_id: m.home_entity_id,
      home_entity_slug: m.home_entity_slug,
      status: m.status,
      email: m.email,
      payroll_class: payrollClass(m.kind),
      capabilities: caps,
      active_assignments: assignments,
    };
  });

  return {
    schema: ROSTER_EXPORT_SCHEMA,
    generated_at: new Date().toISOString(),
    entity_id: input.entity_id ?? null,
    member_count: exportMembers.length,
    members: exportMembers,
  };
}
