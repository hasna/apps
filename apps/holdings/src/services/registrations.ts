import { z } from "zod";
import { appendAudit } from "../db/audit.js";
import {
  deleteRegistration,
  getRegistration,
  insertRegistration,
  listRegistrations,
  updateRegistration,
} from "../db/crud.js";
import { NotFoundError, REGISTRATION_KINDS, REGISTRATION_STATUSES, type Registration } from "../types/index.js";
import { authorizeAsset, requireAsset, type ServiceContext } from "./runtime.js";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const createSchema = z.object({
  asset_id: z.string().uuid(),
  jurisdiction: z.string().trim().min(1).max(60),
  office: z.string().trim().max(120).optional(),
  kind: z.enum(REGISTRATION_KINDS).optional(),
  app_number: z.string().trim().max(120).optional(),
  reg_number: z.string().trim().max(120).optional(),
  filing_date: dateStr.optional(),
  registration_date: dateStr.optional(),
  status: z.enum(REGISTRATION_STATUSES).optional(),
});
export type CreateRegistrationInput = z.infer<typeof createSchema>;

const updateSchema = z.object({
  id: z.string().uuid(),
  office: z.string().trim().max(120).nullable().optional(),
  kind: z.enum(REGISTRATION_KINDS).optional(),
  app_number: z.string().trim().max(120).nullable().optional(),
  reg_number: z.string().trim().max(120).nullable().optional(),
  filing_date: dateStr.nullable().optional(),
  registration_date: dateStr.nullable().optional(),
  status: z.enum(REGISTRATION_STATUSES).optional(),
});
export type UpdateRegistrationInput = z.infer<typeof updateSchema>;

function requireRegistration(ctx: ServiceContext, id: string): Registration {
  const row = getRegistration(ctx.db, id);
  if (!row) throw new NotFoundError("registration", id);
  return row;
}

export function createRegistration(ctx: ServiceContext, input: CreateRegistrationInput): Registration {
  const parsed = createSchema.parse(input);
  const asset = requireAsset(ctx, parsed.asset_id);
  authorizeAsset(ctx, "register", asset, "registration");
  const row = insertRegistration(ctx.db, {
    asset_id: parsed.asset_id,
    jurisdiction: parsed.jurisdiction,
    office: parsed.office ?? null,
    ...(parsed.kind !== undefined ? { kind: parsed.kind } : {}),
    app_number: parsed.app_number ?? null,
    reg_number: parsed.reg_number ?? null,
    filing_date: parsed.filing_date ?? null,
    registration_date: parsed.registration_date ?? null,
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
  });
  appendAudit(ctx.db, {
    action: "registration.create",
    resource: "registration",
    resource_id: row.id,
    actor_id: ctx.auth.actor_id,
    entity_id: asset.entity_id,
    payload: { jurisdiction: row.jurisdiction, status: row.status },
  });
  return row;
}

export function getRegistrationById(ctx: ServiceContext, id: string): Registration {
  const row = requireRegistration(ctx, id);
  const asset = requireAsset(ctx, row.asset_id);
  authorizeAsset(ctx, "read", asset, "registration");
  return row;
}

export function listRegistrationsService(
  ctx: ServiceContext,
  input: { asset_id?: string; status?: string } = {},
): Registration[] {
  const rows = listRegistrations(ctx.db, input);
  if (ctx.auth.bypass) return rows;
  return rows.filter((row) => {
    const asset = requireAsset(ctx, row.asset_id);
    try {
      authorizeAsset(ctx, "read", asset, "registration");
      return true;
    } catch {
      return false;
    }
  });
}

export function updateRegistrationService(ctx: ServiceContext, input: UpdateRegistrationInput): Registration {
  const parsed = updateSchema.parse(input);
  const existing = requireRegistration(ctx, parsed.id);
  const asset = requireAsset(ctx, existing.asset_id);
  authorizeAsset(ctx, "register", asset, "registration");
  const { id, ...patch } = parsed;
  const updated = updateRegistration(ctx.db, id, patch);
  if (!updated) throw new NotFoundError("registration", id);
  appendAudit(ctx.db, {
    action: "registration.update",
    resource: "registration",
    resource_id: updated.id,
    actor_id: ctx.auth.actor_id,
    entity_id: asset.entity_id,
    payload: { status: updated.status },
  });
  return updated;
}

export function deleteRegistrationService(ctx: ServiceContext, id: string): { id: string; deleted: boolean } {
  const existing = requireRegistration(ctx, id);
  const asset = requireAsset(ctx, existing.asset_id);
  authorizeAsset(ctx, "register", asset, "registration");
  const deleted = deleteRegistration(ctx.db, id);
  appendAudit(ctx.db, {
    action: "registration.delete",
    resource: "registration",
    resource_id: id,
    actor_id: ctx.auth.actor_id,
    entity_id: asset.entity_id,
    payload: {},
  });
  return { id, deleted };
}
