import { getDatabase } from "../db/database.js";
import { appendLifecycleEvent, listLifecycleEvents, verifyLifecycleChain, type ChainVerification } from "../db/audit.js";
import { getMemberRow, updateMemberRow } from "../db/crud.js";
import {
  InvalidLifecycleTransitionError,
  MemberNotFoundError,
  ValidationError,
  type LifecycleEvent,
  type Member,
  type MemberStatus,
} from "../types/index.js";
import { authorize, type AuthorizationContext } from "./authorization.js";

// Joiner-Mover-Leaver lifecycle. Mutations that change member status/role also
// append an immutable, hash-chained lifecycle event (§4.7).

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function listMemberLifecycle(memberId: string, ctx?: AuthorizationContext): LifecycleEvent[] {
  const db = getDatabase();
  const member = getMemberRow(db, memberId);
  if (!member) throw new MemberNotFoundError(memberId);
  authorize("read", ctx, { entity_id: member.home_entity_id, resource: `member:${memberId}` });
  return listLifecycleEvents(db, memberId);
}

export interface RoleChangeInput {
  member_id: string;
  to_role: string;
  effective_date?: string;
  reason?: string;
}

export function recordRoleChange(input: RoleChangeInput, ctx?: AuthorizationContext): { member: Member; event: LifecycleEvent } {
  if (!input.to_role?.trim()) throw new ValidationError("to_role is required for a role change.");
  const db = getDatabase();
  const member = requireActiveMember(input.member_id);
  authorize("lifecycle", ctx, { entity_id: member.home_entity_id, resource: `member:${member.id}` });
  const from_role = member.role || null;
  const updated = updateMemberRow(db, member.id, { role: input.to_role.trim() });
  const event = appendLifecycleEvent(db, {
    member_id: member.id,
    event_type: "role_change",
    effective_date: input.effective_date ?? today(),
    from_role,
    to_role: input.to_role.trim(),
    reason: input.reason ?? null,
  });
  return { member: updated, event };
}

export interface StatusChangeInput {
  member_id: string;
  effective_date?: string;
  reason?: string;
}

const STATUS_TRANSITIONS: Record<MemberStatus, MemberStatus[]> = {
  active: ["suspended", "offboarded"],
  suspended: ["active", "offboarded"],
  offboarded: [],
};

function transition(
  input: StatusChangeInput,
  toStatus: MemberStatus,
  eventType: "suspend" | "reactivate" | "offboard",
  ctx?: AuthorizationContext,
): { member: Member; event: LifecycleEvent } {
  const db = getDatabase();
  const member = requireMember(input.member_id);
  authorize("lifecycle", ctx, { entity_id: member.home_entity_id, resource: `member:${member.id}` });
  if (!STATUS_TRANSITIONS[member.status].includes(toStatus)) {
    throw new InvalidLifecycleTransitionError(`Cannot ${eventType} a member in status '${member.status}'.`);
  }
  const updated = updateMemberRow(db, member.id, { status: toStatus });
  const event = appendLifecycleEvent(db, {
    member_id: member.id,
    event_type: eventType,
    effective_date: input.effective_date ?? today(),
    from_role: member.role || null,
    to_role: member.role || null,
    reason: input.reason ?? null,
  });
  return { member: updated, event };
}

export function suspendMember(input: StatusChangeInput, ctx?: AuthorizationContext) {
  return transition(input, "suspended", "suspend", ctx);
}

export function reactivateMember(input: StatusChangeInput, ctx?: AuthorizationContext) {
  return transition(input, "active", "reactivate", ctx);
}

export function offboardMember(input: StatusChangeInput, ctx?: AuthorizationContext) {
  return transition(input, "offboarded", "offboard", ctx);
}

/** Verify the tamper-evident lifecycle audit chain (admin-only). */
export function verifyLifecycleAudit(ctx?: AuthorizationContext): ChainVerification {
  authorize("admin", ctx, {});
  return verifyLifecycleChain(getDatabase());
}

function requireMember(id: string): Member {
  const member = getMemberRow(getDatabase(), id);
  if (!member) throw new MemberNotFoundError(id);
  return member;
}

function requireActiveMember(id: string): Member {
  const member = requireMember(id);
  if (member.status === "offboarded") {
    throw new InvalidLifecycleTransitionError("Cannot change the role of an offboarded member.");
  }
  return member;
}
