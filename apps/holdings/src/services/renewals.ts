import { z } from "zod";
import { appendAudit } from "../db/audit.js";
import { deleteRenewal, getRenewal, insertRenewal, listRenewals, updateRenewal } from "../db/crud.js";
import { NotFoundError, RENEWAL_STATUSES, type Renewal } from "../types/index.js";
import { authorizeAsset, requireAsset, type ServiceContext } from "./runtime.js";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const createSchema = z.object({
  asset_id: z.string().uuid(),
  registration_id: z.string().uuid().optional(),
  due_date: dateStr,
  fee_amount: z.number().nonnegative().optional(),
  fee_currency: z.string().trim().length(3).optional(),
  status: z.enum(RENEWAL_STATUSES).optional(),
  reminder_days: z.number().int().min(0).max(3650).optional(),
});
export type CreateRenewalInput = z.infer<typeof createSchema>;

const updateSchema = z.object({
  id: z.string().uuid(),
  due_date: dateStr.optional(),
  fee_amount: z.number().nonnegative().nullable().optional(),
  fee_currency: z.string().trim().length(3).nullable().optional(),
  status: z.enum(RENEWAL_STATUSES).optional(),
  reminder_days: z.number().int().min(0).max(3650).optional(),
});
export type UpdateRenewalInput = z.infer<typeof updateSchema>;

export interface UpcomingRenewal extends Renewal {
  days_until_due: number;
  entity_id: string;
  asset_name: string;
}

function requireRenewal(ctx: ServiceContext, id: string): Renewal {
  const row = getRenewal(ctx.db, id);
  if (!row) throw new NotFoundError("renewal", id);
  return row;
}

export function createRenewal(ctx: ServiceContext, input: CreateRenewalInput): Renewal {
  const parsed = createSchema.parse(input);
  const asset = requireAsset(ctx, parsed.asset_id);
  authorizeAsset(ctx, "renew", asset, "renewal");
  const row = insertRenewal(ctx.db, {
    asset_id: parsed.asset_id,
    registration_id: parsed.registration_id ?? null,
    due_date: parsed.due_date,
    fee_amount: parsed.fee_amount ?? null,
    fee_currency: parsed.fee_currency ?? null,
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    ...(parsed.reminder_days !== undefined ? { reminder_days: parsed.reminder_days } : {}),
  });
  appendAudit(ctx.db, {
    action: "renewal.create",
    resource: "renewal",
    resource_id: row.id,
    actor_id: ctx.auth.actor_id,
    entity_id: asset.entity_id,
    payload: { due_date: row.due_date, status: row.status },
  });
  return row;
}

export function getRenewalById(ctx: ServiceContext, id: string): Renewal {
  const row = requireRenewal(ctx, id);
  const asset = requireAsset(ctx, row.asset_id);
  authorizeAsset(ctx, "read", asset, "renewal");
  return row;
}

export function listRenewalsService(ctx: ServiceContext, input: { asset_id?: string; status?: string } = {}): Renewal[] {
  const rows = listRenewals(ctx.db, input);
  if (ctx.auth.bypass) return rows;
  return rows.filter((row) => {
    const asset = requireAsset(ctx, row.asset_id);
    try {
      authorizeAsset(ctx, "read", asset, "renewal");
      return true;
    } catch {
      return false;
    }
  });
}

export function updateRenewalService(ctx: ServiceContext, input: UpdateRenewalInput): Renewal {
  const parsed = updateSchema.parse(input);
  const existing = requireRenewal(ctx, parsed.id);
  const asset = requireAsset(ctx, existing.asset_id);
  authorizeAsset(ctx, "renew", asset, "renewal");
  const { id, ...patch } = parsed;
  const updated = updateRenewal(ctx.db, id, patch);
  if (!updated) throw new NotFoundError("renewal", id);
  appendAudit(ctx.db, {
    action: "renewal.update",
    resource: "renewal",
    resource_id: updated.id,
    actor_id: ctx.auth.actor_id,
    entity_id: asset.entity_id,
    payload: { status: updated.status, due_date: updated.due_date },
  });
  return updated;
}

export function deleteRenewalService(ctx: ServiceContext, id: string): { id: string; deleted: boolean } {
  const existing = requireRenewal(ctx, id);
  const asset = requireAsset(ctx, existing.asset_id);
  authorizeAsset(ctx, "renew", asset, "renewal");
  const deleted = deleteRenewal(ctx.db, id);
  appendAudit(ctx.db, {
    action: "renewal.delete",
    resource: "renewal",
    resource_id: id,
    actor_id: ctx.auth.actor_id,
    entity_id: asset.entity_id,
    payload: {},
  });
  return { id, deleted };
}

/**
 * Deadline tracking: renewals due within `withinDays` (default 90), not yet
 * completed, sorted by due date. Anchored + authorized per entity.
 */
export function upcomingRenewals(
  ctx: ServiceContext,
  input: { within_days?: number; as_of?: string } = {},
): UpcomingRenewal[] {
  const withinDays = input.within_days ?? 90;
  const asOf = input.as_of ? new Date(`${input.as_of}T00:00:00Z`) : new Date();
  const horizon = new Date(asOf.getTime() + withinDays * 86_400_000);
  const rows = listRenewals(ctx.db);
  const result: UpcomingRenewal[] = [];
  for (const row of rows) {
    if (row.status === "completed") continue;
    const due = new Date(`${row.due_date}T00:00:00Z`);
    if (due > horizon) continue;
    const asset = requireAsset(ctx, row.asset_id);
    try {
      authorizeAsset(ctx, "read", asset, "renewal");
    } catch {
      continue;
    }
    const daysUntil = Math.floor((due.getTime() - asOf.getTime()) / 86_400_000);
    result.push({ ...row, days_until_due: daysUntil, entity_id: asset.entity_id, asset_name: asset.name });
  }
  return result.sort((a, b) => a.due_date.localeCompare(b.due_date));
}
