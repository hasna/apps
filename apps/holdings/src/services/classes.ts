import { z } from "zod";
import { appendAudit } from "../db/audit.js";
import { deleteClass, getClass, insertClass, listClasses } from "../db/crud.js";
import { NotFoundError, type NiceClass } from "../types/index.js";
import { authorizeAsset, requireAsset, type ServiceContext } from "./runtime.js";

// Nice classification (1–45) for trademarks.
const createSchema = z.object({
  asset_id: z.string().uuid(),
  nice_class: z.number().int().min(1).max(45),
  description: z.string().trim().max(500).optional(),
});
export type CreateClassInput = z.infer<typeof createSchema>;

export function createClass(ctx: ServiceContext, input: CreateClassInput): NiceClass {
  const parsed = createSchema.parse(input);
  const asset = requireAsset(ctx, parsed.asset_id);
  authorizeAsset(ctx, "write", asset, "class");
  const row = insertClass(ctx.db, {
    asset_id: parsed.asset_id,
    nice_class: parsed.nice_class,
    description: parsed.description ?? null,
  });
  appendAudit(ctx.db, {
    action: "class.create",
    resource: "class",
    resource_id: row.id,
    actor_id: ctx.auth.actor_id,
    entity_id: asset.entity_id,
    payload: { nice_class: row.nice_class },
  });
  return row;
}

export function getClassById(ctx: ServiceContext, id: string): NiceClass {
  const row = getClass(ctx.db, id);
  if (!row) throw new NotFoundError("class", id);
  const asset = requireAsset(ctx, row.asset_id);
  authorizeAsset(ctx, "read", asset, "class");
  return row;
}

export function listClassesService(ctx: ServiceContext, input: { asset_id?: string } = {}): NiceClass[] {
  const rows = listClasses(ctx.db, input);
  if (ctx.auth.bypass) return rows;
  return rows.filter((row) => {
    const asset = requireAsset(ctx, row.asset_id);
    try {
      authorizeAsset(ctx, "read", asset, "class");
      return true;
    } catch {
      return false;
    }
  });
}

export function deleteClassService(ctx: ServiceContext, id: string): { id: string; deleted: boolean } {
  const row = getClass(ctx.db, id);
  if (!row) throw new NotFoundError("class", id);
  const asset = requireAsset(ctx, row.asset_id);
  authorizeAsset(ctx, "write", asset, "class");
  const deleted = deleteClass(ctx.db, id);
  appendAudit(ctx.db, {
    action: "class.delete",
    resource: "class",
    resource_id: id,
    actor_id: ctx.auth.actor_id,
    entity_id: asset.entity_id,
    payload: {},
  });
  return { id, deleted };
}
