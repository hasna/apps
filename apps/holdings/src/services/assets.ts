import { z } from "zod";
import { appendAudit } from "../db/audit.js";
import { deleteAsset, insertAsset, listAssets, updateAsset } from "../db/crud.js";
import { ASSET_KINDS, ASSET_STATUSES, NotFoundError, type Asset } from "../types/index.js";
import { authorize } from "./authorization.js";
import { authorizeAsset, requireAsset, requireEntity, type ServiceContext } from "./runtime.js";

const createSchema = z.object({
  entity_id: z.string().uuid(),
  kind: z.enum(ASSET_KINDS),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
});
export type CreateAssetInput = z.infer<typeof createSchema>;

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  kind: z.enum(ASSET_KINDS).optional(),
});
export type UpdateAssetInput = z.infer<typeof updateSchema>;

const listSchema = z.object({
  entity_id: z.string().uuid().optional(),
  kind: z.enum(ASSET_KINDS).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
});
export type ListAssetInput = z.infer<typeof listSchema>;

export function createAsset(ctx: ServiceContext, input: CreateAssetInput): Asset {
  const parsed = createSchema.parse(input);
  requireEntity(ctx, parsed.entity_id);
  authorize("write", ctx.auth, { entity_id: parsed.entity_id, resource: "asset" });
  const asset = insertAsset(ctx.db, {
    entity_id: parsed.entity_id,
    kind: parsed.kind,
    name: parsed.name,
    description: parsed.description ?? null,
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
  });
  appendAudit(ctx.db, {
    action: "asset.create",
    resource: "asset",
    resource_id: asset.id,
    actor_id: ctx.auth.actor_id,
    entity_id: asset.entity_id,
    payload: { kind: asset.kind, name: asset.name },
  });
  return asset;
}

export function getAssetById(ctx: ServiceContext, id: string): Asset {
  const asset = requireAsset(ctx, id);
  authorizeAsset(ctx, "read", asset, "asset");
  return asset;
}

export function listAssetsService(ctx: ServiceContext, input: ListAssetInput = {}): Asset[] {
  const parsed = listSchema.parse(input);
  const rows = listAssets(ctx.db, parsed);
  if (ctx.auth.bypass) return rows;
  return rows.filter((asset) => {
    try {
      authorizeAsset(ctx, "read", asset, "asset");
      return true;
    } catch {
      return false;
    }
  });
}

export function updateAssetService(ctx: ServiceContext, input: UpdateAssetInput): Asset {
  const parsed = updateSchema.parse(input);
  const asset = requireAsset(ctx, parsed.id);
  authorizeAsset(ctx, "write", asset, "asset");
  const updated = updateAsset(ctx.db, parsed.id, {
    ...(parsed.name !== undefined ? { name: parsed.name } : {}),
    ...(parsed.description !== undefined ? { description: parsed.description } : {}),
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    ...(parsed.kind !== undefined ? { kind: parsed.kind } : {}),
  });
  if (!updated) throw new NotFoundError("asset", parsed.id);
  appendAudit(ctx.db, {
    action: "asset.update",
    resource: "asset",
    resource_id: updated.id,
    actor_id: ctx.auth.actor_id,
    entity_id: updated.entity_id,
    payload: { status: updated.status },
  });
  return updated;
}

export function deleteAssetService(ctx: ServiceContext, id: string): { id: string; deleted: boolean } {
  const asset = requireAsset(ctx, id);
  authorizeAsset(ctx, "write", asset, "asset");
  const deleted = deleteAsset(ctx.db, id);
  appendAudit(ctx.db, {
    action: "asset.delete",
    resource: "asset",
    resource_id: id,
    actor_id: ctx.auth.actor_id,
    entity_id: asset.entity_id,
    payload: {},
  });
  return { id, deleted };
}
