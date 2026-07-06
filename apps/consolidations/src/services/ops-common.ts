import type { Row } from "../db/store.js";
import type { ApiPrincipal } from "../server/auth.js";
import type { Run } from "../types/index.js";
import { PermissionDeniedError } from "../types/index.js";
import type { OpContext } from "./op-types.js";

/** Reconstruct a domain object from a stored row (data holds the domain fields). */
export function toDomain<T>(row: Row): T {
  return { id: row.id, created_at: row.created_at, ...(row.data as object) } as T;
}

/** The entity ids a principal may access, or "all" for bypass/unrestricted-system. */
export function accessibleEntities(principal: ApiPrincipal): string[] | "all" {
  if (principal.bypass) return "all";
  return principal.entity_ids ?? [];
}

export function canAccessEntity(principal: ApiPrincipal, entityId: string): boolean {
  if (principal.bypass) return true;
  return (principal.entity_ids ?? []).includes(entityId);
}

/** Keep only rows whose entity_id the principal may access (deny-by-default). */
export function filterByEntityAccess(principal: ApiPrincipal, rows: Row[]): Row[] {
  if (principal.bypass) return rows;
  const allowed = new Set(principal.entity_ids ?? []);
  return rows.filter((row) => row.entity_id === null || allowed.has(row.entity_id));
}

/** Whether a principal may access ALL of a set of entities (deny-by-default). */
export function canAccessAllEntities(principal: ApiPrincipal, entityIds: string[]): boolean {
  if (principal.bypass) return true;
  const allowed = new Set(principal.entity_ids ?? []);
  return entityIds.every((id) => allowed.has(id));
}

/**
 * The distinct real entities an elimination references (both sides), excluding
 * the synthetic "group" sentinel. Eliminations store a NULL top-level entity_id
 * column (they span two entities living in data.entity_id_from/to), so they must
 * be authorized against these payload entities — never via the null-column
 * `filterByEntityAccess` fast-path, which would treat them as public.
 */
export function eliminationEntities(e: {
  entity_id_from?: string | null;
  entity_id_to?: string | null;
}): string[] {
  const ents = [e.entity_id_from, e.entity_id_to].filter(
    (x): x is string => Boolean(x) && x !== "group",
  );
  return Array.from(new Set(ents));
}

/** The minimal shape needed to authorize an elimination for reads. */
export type EliminationAuthShape = {
  run_id?: string | null;
  entity_id_from?: string | null;
  entity_id_to?: string | null;
};

/**
 * Resolve the entities an elimination must be authorized against.
 *
 * Computed eliminations produced by run.compute store the synthetic sentinel
 * entity_id_from="group"/entity_id_to="group" but carry a real run_id: they
 * MUST be gated behind access to the FULL run entity group, mirroring
 * statement.get/statement.list. Manual eliminations reference two real entities
 * directly (either side may be "group").
 *
 * Returns `null` when the elimination cannot be tied to any authorizable
 * entity (a group/group row whose run is missing, or a manual group/group row
 * with no run). Callers MUST treat `null` as deny-by-default — never as public.
 * Never returns an empty array, which would make `requireAllEntities` /
 * `canAccessAllEntities` vacuously true.
 */
export async function eliminationAuthEntities(
  ctx: OpContext,
  e: EliminationAuthShape,
): Promise<string[] | null> {
  if (e.run_id) {
    const row = await ctx.store.get("runs", e.run_id);
    if (!row) return null; // run vanished — cannot authorize, deny by default
    const run = toDomain<Run>(row);
    return run.entity_ids.length > 0 ? run.entity_ids : null;
  }
  const ents = eliminationEntities(e);
  return ents.length > 0 ? ents : null;
}

/** Whether a principal may read an elimination (deny-by-default; null => deny). */
export async function canAccessElimination(ctx: OpContext, e: EliminationAuthShape): Promise<boolean> {
  if (ctx.principal.bypass) return true;
  const entityIds = await eliminationAuthEntities(ctx, e);
  if (entityIds === null) return false;
  return canAccessAllEntities(ctx.principal, entityIds);
}

/** Enforce read access to an elimination, throwing PermissionDeniedError. */
export async function requireEliminationAccess(ctx: OpContext, e: EliminationAuthShape): Promise<void> {
  if (await canAccessElimination(ctx, e)) return;
  throw new PermissionDeniedError("read", "elimination");
}

/** Append a hash-chained audit event for a sensitive/money/lifecycle action. */
export async function writeAudit(
  ctx: OpContext,
  event: string,
  entityId: string | null,
  detail: string,
): Promise<void> {
  await ctx.store.appendAudit({
    event,
    actor_id: ctx.principal.actor_id,
    entity_id: entityId,
    detail,
    created_at: new Date().toISOString(),
  });
}
