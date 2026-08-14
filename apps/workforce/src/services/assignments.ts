import { getDatabase } from "../db/database.js";
import { getAssignmentRow, getMemberRow, insertAssignment, listAssignmentRows, updateAssignmentRow } from "../db/crud.js";
import {
  AssignmentNotFoundError,
  MemberNotFoundError,
  ValidationError,
  type Assignment,
} from "../types/index.js";
import { allowedEntityIds, authorize, type AuthorizationContext } from "./authorization.js";

// Member-to-entity/project assignments.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateAssignmentInput {
  member_id: string;
  entity_id: string;
  project?: string | null;
  role_on_assignment?: string;
  allocation_pct?: number;
  start_date?: string;
  end_date?: string | null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createAssignment(input: CreateAssignmentInput, ctx?: AuthorizationContext): Assignment {
  if (!UUID_RE.test(input.entity_id)) throw new ValidationError(`entity_id must be an unguessable UUIDv4 (got: ${input.entity_id}).`);
  const allocation = input.allocation_pct ?? 100;
  if (!Number.isInteger(allocation) || allocation < 0 || allocation > 100) {
    throw new ValidationError("allocation_pct must be an integer between 0 and 100.");
  }
  const db = getDatabase();
  const member = getMemberRow(db, input.member_id);
  if (!member) throw new MemberNotFoundError(input.member_id);
  authorize("write", ctx, { entity_id: input.entity_id, resource: "assignment" });
  return insertAssignment(db, {
    member_id: member.id,
    entity_id: input.entity_id,
    project: input.project ?? null,
    role_on_assignment: input.role_on_assignment ?? "",
    allocation_pct: allocation,
    start_date: input.start_date ?? today(),
    end_date: input.end_date ?? null,
    status: "active",
  });
}

export function getAssignment(id: string, ctx?: AuthorizationContext): Assignment {
  const db = getDatabase();
  const assignment = getAssignmentRow(db, id);
  if (!assignment) throw new AssignmentNotFoundError(id);
  authorize("read", ctx, { entity_id: assignment.entity_id, resource: `assignment:${id}` });
  return assignment;
}

export function listAssignments(
  filter: { member_id?: string; entity_id?: string; status?: string } = {},
  ctx?: AuthorizationContext,
): Assignment[] {
  const db = getDatabase();
  return listAssignmentRows(db, { ...filter, allowedEntities: allowedEntityIds(ctx) });
}

export interface EndAssignmentInput {
  end_date?: string;
}

export function endAssignment(id: string, input: EndAssignmentInput = {}, ctx?: AuthorizationContext): Assignment {
  const db = getDatabase();
  const assignment = getAssignmentRow(db, id);
  if (!assignment) throw new AssignmentNotFoundError(id);
  authorize("write", ctx, { entity_id: assignment.entity_id, resource: `assignment:${id}` });
  return updateAssignmentRow(db, id, { status: "ended", end_date: input.end_date ?? today() });
}
