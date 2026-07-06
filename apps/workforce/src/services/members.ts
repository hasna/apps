import { getDatabase } from "../db/database.js";
import { appendLifecycleEvent } from "../db/audit.js";
import { getMemberRow, insertMember, listMemberRows, updateMemberRow } from "../db/crud.js";
import {
  MEMBER_KINDS,
  MEMBER_STATUSES,
  MemberNotFoundError,
  ValidationError,
  type Member,
  type MemberKind,
  type MemberStatus,
} from "../types/index.js";
import { allowedEntityIds, authorize, type AuthorizationContext } from "./authorization.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateMemberInput {
  kind: MemberKind;
  name: string;
  home_entity_id: string;
  home_entity_slug?: string | null;
  role?: string;
  owner_id?: string | null;
  status?: MemberStatus;
  email?: string | null;
  effective_date?: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertEntityId(id: string): void {
  if (!UUID_RE.test(id)) {
    throw new ValidationError(`home_entity_id must be an unguessable UUIDv4 (got: ${id}).`);
  }
}

export function getMember(id: string, ctx?: AuthorizationContext): Member {
  const db = getDatabase();
  const member = getMemberRow(db, id);
  if (!member) throw new MemberNotFoundError(id);
  authorize("read", ctx, { entity_id: member.home_entity_id, resource: `member:${id}` });
  return member;
}

export function listMembers(
  filter: { kind?: MemberKind; status?: MemberStatus; owner_id?: string; entity_id?: string } = {},
  ctx?: AuthorizationContext,
): Member[] {
  const db = getDatabase();
  return listMemberRows(db, { ...filter, allowedEntities: allowedEntityIds(ctx) });
}

export function createMember(input: CreateMemberInput, ctx?: AuthorizationContext): Member {
  if (!input.name?.trim()) throw new ValidationError("name is required.");
  if (!MEMBER_KINDS.includes(input.kind)) throw new ValidationError(`kind must be one of: ${MEMBER_KINDS.join(", ")}.`);
  assertEntityId(input.home_entity_id);
  const status = input.status ?? "active";
  if (!MEMBER_STATUSES.includes(status)) throw new ValidationError(`status must be one of: ${MEMBER_STATUSES.join(", ")}.`);

  const db = getDatabase();
  authorize("write", ctx, { entity_id: input.home_entity_id, resource: "member" });

  const owner_id = input.owner_id ?? null;
  if (input.kind === "agent" && !owner_id) {
    throw new ValidationError("agent members require an owning human (owner_id).");
  }
  if (owner_id) {
    const owner = getMemberRow(db, owner_id);
    if (!owner) throw new ValidationError(`owner_id references a non-existent member: ${owner_id}.`);
  }

  const member = insertMember(db, {
    kind: input.kind,
    name: input.name.trim(),
    owner_id,
    role: input.role ?? "",
    home_entity_id: input.home_entity_id,
    home_entity_slug: input.home_entity_slug ?? null,
    status,
    email: input.email ?? null,
  });

  // Joiner event: every member's roster entry starts with a 'hire' lifecycle record.
  appendLifecycleEvent(db, {
    member_id: member.id,
    event_type: "hire",
    effective_date: input.effective_date ?? today(),
    to_role: member.role || null,
    reason: `${member.kind} onboarded`,
  });
  return member;
}

export interface UpdateMemberInput {
  name?: string;
  role?: string;
  home_entity_slug?: string | null;
  email?: string | null;
  owner_id?: string | null;
  expected_version?: number;
}

export function updateMember(id: string, patch: UpdateMemberInput, ctx?: AuthorizationContext): Member {
  const db = getDatabase();
  const current = getMemberRow(db, id);
  if (!current) throw new MemberNotFoundError(id);
  authorize("write", ctx, { entity_id: current.home_entity_id, resource: `member:${id}` });
  if (patch.owner_id) {
    const owner = getMemberRow(db, patch.owner_id);
    if (!owner) throw new ValidationError(`owner_id references a non-existent member: ${patch.owner_id}.`);
  }
  return updateMemberRow(
    db,
    id,
    {
      name: patch.name,
      role: patch.role,
      home_entity_slug: patch.home_entity_slug,
      email: patch.email,
      owner_id: patch.owner_id,
    },
    patch.expected_version,
  );
}
