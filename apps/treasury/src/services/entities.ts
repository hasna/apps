import { now, uuid } from "../db/database.js";
import { appendAudit } from "../db/audit.js";
import { guard, type RunContext } from "./context.js";
import { EntityNotFoundError, ValidationError, type EntityRef } from "../types/index.js";

// Entity cache (BUILD-SPEC §1c). entity_id is an unguessable UUIDv4; in cloud
// the source of record is @hasna/entities, seeded here via export. Treasury
// anchors every record to entity_id and AUTHORIZES the principal against it.

export interface CreateEntityInput {
  name: string;
  base_currency: string;
  entity_slug?: string | null;
}

export async function createEntity(rc: RunContext, input: CreateEntityInput): Promise<EntityRef> {
  guard(rc, "treasury:admin", "admin");
  if (!input.name?.trim()) throw new ValidationError("name is required.");
  if (!/^[A-Z]{3}$/.test(input.base_currency ?? "")) throw new ValidationError("base_currency must be an ISO-4217 code (e.g. USD).");
  const ts = now();
  const row: EntityRef = {
    entity_id: uuid(),
    entity_slug: input.entity_slug?.trim() || null,
    name: input.name.trim(),
    base_currency: input.base_currency,
    created_at: ts,
    updated_at: ts,
  };
  await rc.db.run(
    "INSERT INTO entities (entity_id, entity_slug, name, base_currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [row.entity_id, row.entity_slug, row.name, row.base_currency, row.created_at, row.updated_at],
  );
  await appendAudit(rc.db, { entity_id: row.entity_id, actor_id: rc.auth.actor_id, action: "entity.create", detail: `name=${row.name}` });
  return row;
}

export async function listEntities(rc: RunContext): Promise<EntityRef[]> {
  guard(rc, "treasury:read", "read");
  const rows = await rc.db.all<EntityRef>("SELECT * FROM entities ORDER BY name ASC");
  // Entity-scoped principals only see their own entities (deny-by-default).
  if (rc.auth.bypass || rc.auth.entity_ids === undefined) {
    return rc.auth.bypass ? rows : [];
  }
  const allowed = new Set(rc.auth.entity_ids);
  return rows.filter((r) => allowed.has(r.entity_id));
}

export async function getEntity(rc: RunContext, input: { entity_id: string }): Promise<EntityRef> {
  guard(rc, "treasury:read", "read", input.entity_id);
  return requireEntity(rc, input.entity_id);
}

export async function requireEntity(rc: RunContext, entity_id: string): Promise<EntityRef> {
  const row = await rc.db.get<EntityRef>("SELECT * FROM entities WHERE entity_id = ?", [entity_id]);
  if (!row) throw new EntityNotFoundError(entity_id);
  return row;
}
