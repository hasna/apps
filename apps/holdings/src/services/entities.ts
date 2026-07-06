import { z } from "zod";
import { appendAudit } from "../db/audit.js";
import { getEntity, insertEntity, listEntities } from "../db/crud.js";
import type { EntityRef } from "../types/index.js";
import { ConflictError, ValidationError } from "../types/index.js";
import { authorize } from "./authorization.js";
import { requireEntity, type ServiceContext } from "./runtime.js";

// Cached entity references (entity-anchoring, §1c). In cloud the source of truth
// is @hasna/entities via entity_get; locally we keep a seeded cache. entity_id
// values are unguessable UUIDv4 (generated when not supplied).

const uuidV4 = z.string().uuid();

const seedSchema = z.object({
  entity_id: uuidV4.optional(),
  entity_slug: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(200),
});

export type SeedEntityInput = z.infer<typeof seedSchema>;

/** Seed/cache an entity reference (admin action). */
export function seedEntity(ctx: ServiceContext, input: SeedEntityInput): EntityRef {
  const parsed = seedSchema.parse(input);
  authorize("admin", ctx.auth, { entity_id: parsed.entity_id, resource: "entity" });
  if (parsed.entity_id && getEntity(ctx.db, parsed.entity_id)) {
    throw new ConflictError(`Entity already cached: ${parsed.entity_id}`);
  }
  const entity = insertEntity(ctx.db, {
    ...(parsed.entity_id !== undefined ? { entity_id: parsed.entity_id } : {}),
    entity_slug: parsed.entity_slug ?? null,
    name: parsed.name,
  });
  appendAudit(ctx.db, {
    action: "entity.seed",
    resource: "entity",
    resource_id: entity.entity_id,
    actor_id: ctx.auth.actor_id,
    entity_id: entity.entity_id,
    payload: { name: entity.name, slug: entity.entity_slug },
  });
  return entity;
}

export function getEntityRef(ctx: ServiceContext, entityId: string): EntityRef {
  authorize("read", ctx.auth, { entity_id: entityId, resource: "entity" });
  return requireEntity(ctx, entityId);
}

/** List entities the caller is authorized to see. */
export function listEntityRefs(ctx: ServiceContext): EntityRef[] {
  const all = listEntities(ctx.db);
  if (ctx.auth.bypass) return all;
  return all.filter((e) => {
    try {
      authorize("read", ctx.auth, { entity_id: e.entity_id, resource: "entity" });
      return true;
    } catch {
      return false;
    }
  });
}

export function assertValidEntityId(value: string): string {
  const result = uuidV4.safeParse(value);
  if (!result.success) throw new ValidationError(`entity_id must be a UUIDv4: ${value}`);
  return value;
}
