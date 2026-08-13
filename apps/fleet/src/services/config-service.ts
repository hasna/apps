import type { Database } from "bun:sqlite";
import type { FleetAdapters } from "../adapters/types.js";
import { entitySlug as fixtureEntitySlug } from "../adapters/fixtures.js";
import { recordAudit } from "../db/audit.js";
import * as crud from "../db/crud.js";
import type { ApiPrincipal } from "../server/auth.js";
import { allowedEntityIds, authorize, hasEntityAccess, scopeToEntities } from "./authorization.js";
import {
  type AlertThreshold,
  type Annotation,
  type ErrorBudgetPolicy,
  type SavedView,
  type Slo,
  AlertThresholdNotFoundError,
  AnnotationNotFoundError,
  EntityAccessDeniedError,
  ErrorBudgetPolicyNotFoundError,
  SavedViewNotFoundError,
  SloNotFoundError,
} from "../types/index.js";

// Domain service for fleet's writable CONFIG layer. Every operation enforces the
// shared scope/role stack + entity scoping (§1c) and records mutations in the
// append-only audit (§4.7). CLI, MCP, and /v1 all call THESE functions — never
// duplicate domain logic per surface.

export interface OpContext {
  db: Database;
  principal: ApiPrincipal;
  adapters: FleetAdapters;
}

function resolveSlug(db: Database, entityId: string, provided?: string | null): string | null {
  if (provided) return provided;
  return crud.getEntitySlug(db, entityId) ?? fixtureEntitySlug(entityId);
}

function assertEntity(principal: ApiPrincipal, entityId: string): void {
  if (!hasEntityAccess(principal, entityId)) throw new EntityAccessDeniedError(entityId);
}

// Route every LIST op through the SAME entity-scoping the CRUD ops use.
// `allowedEntityIds()` is the single source of truth for entity isolation (§1c):
// it returns `null` ONLY for the bypass/SYSTEM context (localOwnerPrincipal / local
// CLI) — genuinely unconstrained — and the principal's EXPLICIT allowlist for every
// authenticated caller. An UNSCOPED non-bypass principal therefore resolves to the
// EMPTY array and sees NO rows (deny-by-default) — never wildcard.
//
// CAUTION: the crud `scopedRows` helper treats BOTH `undefined` AND an EMPTY id
// array as "unconstrained → ALL rows". So the empty allowed-set MUST be
// short-circuited HERE and never handed to crud; only a genuine `null` (bypass) is
// allowed to pass `undefined` through to select every row. `scopeToEntities` is
// applied as a final post-filter (defence in depth) for the constrained case.
function scopedList<T extends { entity_id: string }>(
  ctx: OpContext,
  fetch: (db: Database, entityIds?: string[]) => T[],
): T[] {
  const allowed = allowedEntityIds(ctx.principal);
  if (allowed !== null && allowed.length === 0) return [];
  return scopeToEntities(fetch(ctx.db, allowed ?? undefined), ctx.principal);
}

// --- saved views ---

export function createSavedView(
  ctx: OpContext,
  input: { entity_id: string; entity_slug?: string | null; name: string; kind: SavedView["kind"]; spec?: Record<string, unknown> },
): SavedView {
  authorize("write", ctx.principal, { resource: "saved_view" });
  assertEntity(ctx.principal, input.entity_id);
  const view = crud.insertSavedView(ctx.db, { ...input, entity_slug: resolveSlug(ctx.db, input.entity_id, input.entity_slug) });
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "create", resource: "saved_view", entity_id: input.entity_id, detail: { id: view.id, name: view.name } });
  return view;
}

export function getSavedView(ctx: OpContext, id: string): SavedView {
  authorize("read", ctx.principal, { resource: "saved_view" });
  const view = crud.getSavedView(ctx.db, id);
  if (!view) throw new SavedViewNotFoundError(id);
  assertEntity(ctx.principal, view.entity_id);
  return view;
}

export function listSavedViews(ctx: OpContext): SavedView[] {
  authorize("read", ctx.principal, { resource: "saved_view" });
  return scopedList(ctx, crud.listSavedViews);
}

export function updateSavedView(
  ctx: OpContext,
  id: string,
  patch: Partial<Pick<SavedView, "name" | "kind" | "spec" | "entity_slug">>,
): SavedView {
  authorize("write", ctx.principal, { resource: "saved_view" });
  const existing = crud.getSavedView(ctx.db, id);
  if (!existing) throw new SavedViewNotFoundError(id);
  assertEntity(ctx.principal, existing.entity_id);
  const updated = crud.updateSavedView(ctx.db, id, patch)!;
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "update", resource: "saved_view", entity_id: existing.entity_id, detail: { id } });
  return updated;
}

export function deleteSavedView(ctx: OpContext, id: string): { id: string; deleted: boolean } {
  authorize("write", ctx.principal, { resource: "saved_view" });
  const existing = crud.getSavedView(ctx.db, id);
  if (!existing) throw new SavedViewNotFoundError(id);
  assertEntity(ctx.principal, existing.entity_id);
  const deleted = crud.deleteSavedView(ctx.db, id);
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "delete", resource: "saved_view", entity_id: existing.entity_id, detail: { id } });
  return { id, deleted };
}

// --- slos ---

export function createSlo(
  ctx: OpContext,
  input: { entity_id: string; entity_slug?: string | null; target_type: Slo["target_type"]; target_ref: string; name: string; objective: Slo["objective"]; target_value: number; window_days?: number },
): Slo {
  authorize("write", ctx.principal, { resource: "slo" });
  assertEntity(ctx.principal, input.entity_id);
  const slo = crud.insertSlo(ctx.db, { ...input, entity_slug: resolveSlug(ctx.db, input.entity_id, input.entity_slug) });
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "create", resource: "slo", entity_id: input.entity_id, detail: { id: slo.id, objective: slo.objective } });
  return slo;
}

export function getSlo(ctx: OpContext, id: string): Slo {
  authorize("read", ctx.principal, { resource: "slo" });
  const slo = crud.getSlo(ctx.db, id);
  if (!slo) throw new SloNotFoundError(id);
  assertEntity(ctx.principal, slo.entity_id);
  return slo;
}

export function listSlos(ctx: OpContext): Slo[] {
  authorize("read", ctx.principal, { resource: "slo" });
  return scopedList(ctx, crud.listSlos);
}

export function updateSlo(
  ctx: OpContext,
  id: string,
  patch: Partial<Pick<Slo, "name" | "objective" | "target_value" | "window_days" | "target_ref" | "target_type" | "entity_slug">>,
): Slo {
  authorize("write", ctx.principal, { resource: "slo" });
  const existing = crud.getSlo(ctx.db, id);
  if (!existing) throw new SloNotFoundError(id);
  assertEntity(ctx.principal, existing.entity_id);
  const updated = crud.updateSlo(ctx.db, id, patch)!;
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "update", resource: "slo", entity_id: existing.entity_id, detail: { id } });
  return updated;
}

export function deleteSlo(ctx: OpContext, id: string): { id: string; deleted: boolean } {
  authorize("write", ctx.principal, { resource: "slo" });
  const existing = crud.getSlo(ctx.db, id);
  if (!existing) throw new SloNotFoundError(id);
  assertEntity(ctx.principal, existing.entity_id);
  const deleted = crud.deleteSlo(ctx.db, id);
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "delete", resource: "slo", entity_id: existing.entity_id, detail: { id } });
  return { id, deleted };
}

// --- error budget policies ---

export function createErrorBudgetPolicy(
  ctx: OpContext,
  input: { slo_id: string; entity_id: string; budget_percent: number; burn_alert_threshold?: number; window_days?: number },
): ErrorBudgetPolicy {
  authorize("write", ctx.principal, { resource: "error_budget_policy" });
  assertEntity(ctx.principal, input.entity_id);
  const policy = crud.insertErrorBudgetPolicy(ctx.db, input);
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "create", resource: "error_budget_policy", entity_id: input.entity_id, detail: { id: policy.id, slo_id: policy.slo_id } });
  return policy;
}

export function getErrorBudgetPolicy(ctx: OpContext, id: string): ErrorBudgetPolicy {
  authorize("read", ctx.principal, { resource: "error_budget_policy" });
  const policy = crud.getErrorBudgetPolicy(ctx.db, id);
  if (!policy) throw new ErrorBudgetPolicyNotFoundError(id);
  assertEntity(ctx.principal, policy.entity_id);
  return policy;
}

export function listErrorBudgetPolicies(ctx: OpContext): ErrorBudgetPolicy[] {
  authorize("read", ctx.principal, { resource: "error_budget_policy" });
  return scopedList(ctx, crud.listErrorBudgetPolicies);
}

export function updateErrorBudgetPolicy(
  ctx: OpContext,
  id: string,
  patch: Partial<Pick<ErrorBudgetPolicy, "budget_percent" | "burn_alert_threshold" | "window_days">>,
): ErrorBudgetPolicy {
  authorize("write", ctx.principal, { resource: "error_budget_policy" });
  const existing = crud.getErrorBudgetPolicy(ctx.db, id);
  if (!existing) throw new ErrorBudgetPolicyNotFoundError(id);
  assertEntity(ctx.principal, existing.entity_id);
  const updated = crud.updateErrorBudgetPolicy(ctx.db, id, patch)!;
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "update", resource: "error_budget_policy", entity_id: existing.entity_id, detail: { id } });
  return updated;
}

export function deleteErrorBudgetPolicy(ctx: OpContext, id: string): { id: string; deleted: boolean } {
  authorize("write", ctx.principal, { resource: "error_budget_policy" });
  const existing = crud.getErrorBudgetPolicy(ctx.db, id);
  if (!existing) throw new ErrorBudgetPolicyNotFoundError(id);
  assertEntity(ctx.principal, existing.entity_id);
  const deleted = crud.deleteErrorBudgetPolicy(ctx.db, id);
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "delete", resource: "error_budget_policy", entity_id: existing.entity_id, detail: { id } });
  return { id, deleted };
}

// --- alert thresholds ---

export function createAlertThreshold(
  ctx: OpContext,
  input: { entity_id: string; slo_id?: string | null; metric: string; comparator: AlertThreshold["comparator"]; threshold_value: number; severity?: AlertThreshold["severity"]; enabled?: boolean },
): AlertThreshold {
  authorize("write", ctx.principal, { resource: "alert_threshold" });
  assertEntity(ctx.principal, input.entity_id);
  const threshold = crud.insertAlertThreshold(ctx.db, input);
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "create", resource: "alert_threshold", entity_id: input.entity_id, detail: { id: threshold.id, metric: threshold.metric } });
  return threshold;
}

export function getAlertThreshold(ctx: OpContext, id: string): AlertThreshold {
  authorize("read", ctx.principal, { resource: "alert_threshold" });
  const threshold = crud.getAlertThreshold(ctx.db, id);
  if (!threshold) throw new AlertThresholdNotFoundError(id);
  assertEntity(ctx.principal, threshold.entity_id);
  return threshold;
}

export function listAlertThresholds(ctx: OpContext): AlertThreshold[] {
  authorize("read", ctx.principal, { resource: "alert_threshold" });
  return scopedList(ctx, crud.listAlertThresholds);
}

export function updateAlertThreshold(
  ctx: OpContext,
  id: string,
  patch: Partial<Pick<AlertThreshold, "metric" | "comparator" | "threshold_value" | "severity" | "enabled" | "slo_id">>,
): AlertThreshold {
  authorize("write", ctx.principal, { resource: "alert_threshold" });
  const existing = crud.getAlertThreshold(ctx.db, id);
  if (!existing) throw new AlertThresholdNotFoundError(id);
  assertEntity(ctx.principal, existing.entity_id);
  const updated = crud.updateAlertThreshold(ctx.db, id, patch)!;
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "update", resource: "alert_threshold", entity_id: existing.entity_id, detail: { id } });
  return updated;
}

export function deleteAlertThreshold(ctx: OpContext, id: string): { id: string; deleted: boolean } {
  authorize("write", ctx.principal, { resource: "alert_threshold" });
  const existing = crud.getAlertThreshold(ctx.db, id);
  if (!existing) throw new AlertThresholdNotFoundError(id);
  assertEntity(ctx.principal, existing.entity_id);
  const deleted = crud.deleteAlertThreshold(ctx.db, id);
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "delete", resource: "alert_threshold", entity_id: existing.entity_id, detail: { id } });
  return { id, deleted };
}

// --- annotations ---

export function createAnnotation(
  ctx: OpContext,
  input: { entity_id: string; target_ref: string; at?: string; text: string; author?: string },
): Annotation {
  authorize("write", ctx.principal, { resource: "annotation" });
  assertEntity(ctx.principal, input.entity_id);
  const annotation = crud.insertAnnotation(ctx.db, { ...input, author: input.author ?? ctx.principal.actor_id });
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "create", resource: "annotation", entity_id: input.entity_id, detail: { id: annotation.id } });
  return annotation;
}

export function getAnnotation(ctx: OpContext, id: string): Annotation {
  authorize("read", ctx.principal, { resource: "annotation" });
  const annotation = crud.getAnnotation(ctx.db, id);
  if (!annotation) throw new AnnotationNotFoundError(id);
  assertEntity(ctx.principal, annotation.entity_id);
  return annotation;
}

export function listAnnotations(ctx: OpContext): Annotation[] {
  authorize("read", ctx.principal, { resource: "annotation" });
  return scopedList(ctx, crud.listAnnotations);
}

export function updateAnnotation(
  ctx: OpContext,
  id: string,
  patch: Partial<Pick<Annotation, "text" | "target_ref" | "at">>,
): Annotation {
  authorize("write", ctx.principal, { resource: "annotation" });
  const existing = crud.getAnnotation(ctx.db, id);
  if (!existing) throw new AnnotationNotFoundError(id);
  assertEntity(ctx.principal, existing.entity_id);
  const updated = crud.updateAnnotation(ctx.db, id, patch)!;
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "update", resource: "annotation", entity_id: existing.entity_id, detail: { id } });
  return updated;
}

export function deleteAnnotation(ctx: OpContext, id: string): { id: string; deleted: boolean } {
  authorize("write", ctx.principal, { resource: "annotation" });
  const existing = crud.getAnnotation(ctx.db, id);
  if (!existing) throw new AnnotationNotFoundError(id);
  assertEntity(ctx.principal, existing.entity_id);
  const deleted = crud.deleteAnnotation(ctx.db, id);
  recordAudit(ctx.db, { actor_id: ctx.principal.actor_id, action: "delete", resource: "annotation", entity_id: existing.entity_id, detail: { id } });
  return { id, deleted };
}
