import { getDatabase } from "../db/database.js";
import { deleteCapabilityRow, getCapabilityRow, getMemberRow, insertCapability, listCapabilityRows } from "../db/crud.js";
import {
  CAPABILITY_LEVELS,
  CapabilityNotFoundError,
  MemberNotFoundError,
  ValidationError,
  type Capability,
  type CapabilityLevel,
} from "../types/index.js";
import { authorize, type AuthorizationContext } from "./authorization.js";

// Capability catalog: skills/capabilities per member (human, contractor or agent).

export interface AddCapabilityInput {
  member_id: string;
  name: string;
  category?: string;
  level?: CapabilityLevel;
  notes?: string | null;
}

export function addCapability(input: AddCapabilityInput, ctx?: AuthorizationContext): Capability {
  if (!input.name?.trim()) throw new ValidationError("capability name is required.");
  const level = input.level ?? "intermediate";
  if (!CAPABILITY_LEVELS.includes(level)) throw new ValidationError(`level must be one of: ${CAPABILITY_LEVELS.join(", ")}.`);
  const db = getDatabase();
  const member = getMemberRow(db, input.member_id);
  if (!member) throw new MemberNotFoundError(input.member_id);
  authorize("write", ctx, { entity_id: member.home_entity_id, resource: `member:${member.id}` });
  return insertCapability(db, {
    member_id: member.id,
    name: input.name.trim(),
    category: input.category?.trim() || "general",
    level,
    notes: input.notes ?? null,
  });
}

export function listCapabilities(memberId: string, ctx?: AuthorizationContext): Capability[] {
  const db = getDatabase();
  const member = getMemberRow(db, memberId);
  if (!member) throw new MemberNotFoundError(memberId);
  authorize("read", ctx, { entity_id: member.home_entity_id, resource: `member:${memberId}` });
  return listCapabilityRows(db, memberId);
}

export function getCapability(id: string, ctx?: AuthorizationContext): Capability {
  const db = getDatabase();
  const cap = getCapabilityRow(db, id);
  if (!cap) throw new CapabilityNotFoundError(id);
  const member = getMemberRow(db, cap.member_id);
  authorize("read", ctx, { entity_id: member?.home_entity_id, resource: `capability:${id}` });
  return cap;
}

export function removeCapability(id: string, ctx?: AuthorizationContext): { id: string; deleted: boolean } {
  const db = getDatabase();
  const cap = getCapabilityRow(db, id);
  if (!cap) throw new CapabilityNotFoundError(id);
  const member = getMemberRow(db, cap.member_id);
  authorize("write", ctx, { entity_id: member?.home_entity_id, resource: `capability:${id}` });
  return { id, deleted: deleteCapabilityRow(db, id) };
}
