import type { Database } from "bun:sqlite";
import type {
  AlertThreshold,
  Annotation,
  ErrorBudgetPolicy,
  SavedView,
  Slo,
} from "../types/index.js";
import { now, uuid } from "./database.js";

// Low-level row ops for fleet's config tables. Pure DB mapping — authorization,
// validation, and auditing live in the service layer.

// --- saved_views ---

interface SavedViewRow {
  id: string;
  entity_id: string;
  entity_slug: string | null;
  name: string;
  kind: string;
  spec: string;
  version: number;
  created_at: string;
  updated_at: string;
}

function mapSavedView(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    entity_id: row.entity_id,
    entity_slug: row.entity_slug,
    name: row.name,
    kind: row.kind as SavedView["kind"],
    spec: JSON.parse(row.spec) as Record<string, unknown>,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface SavedViewInput {
  entity_id: string;
  entity_slug?: string | null;
  name: string;
  kind: SavedView["kind"];
  spec?: Record<string, unknown>;
}

export function insertSavedView(db: Database, input: SavedViewInput): SavedView {
  const id = uuid();
  const ts = now();
  db.run(
    "INSERT INTO saved_views (id, entity_id, entity_slug, name, kind, spec, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
    [id, input.entity_id, input.entity_slug ?? null, input.name, input.kind, JSON.stringify(input.spec ?? {}), ts, ts],
  );
  return getSavedView(db, id)!;
}

export function getSavedView(db: Database, id: string): SavedView | null {
  const row = db.query("SELECT * FROM saved_views WHERE id = ?").get(id) as SavedViewRow | null;
  return row ? mapSavedView(row) : null;
}

export function listSavedViews(db: Database, entityIds?: string[]): SavedView[] {
  const rows = scopedRows<SavedViewRow>(db, "saved_views", entityIds);
  return rows.map(mapSavedView);
}

export function updateSavedView(
  db: Database,
  id: string,
  patch: Partial<Pick<SavedView, "name" | "kind" | "spec" | "entity_slug">>,
): SavedView | null {
  const current = getSavedView(db, id);
  if (!current) return null;
  db.run(
    "UPDATE saved_views SET name = ?, kind = ?, spec = ?, entity_slug = ?, version = version + 1, updated_at = ? WHERE id = ?",
    [
      patch.name ?? current.name,
      patch.kind ?? current.kind,
      JSON.stringify(patch.spec ?? current.spec),
      patch.entity_slug ?? current.entity_slug,
      now(),
      id,
    ],
  );
  return getSavedView(db, id);
}

export function deleteSavedView(db: Database, id: string): boolean {
  const res = db.run("DELETE FROM saved_views WHERE id = ?", [id]);
  return res.changes > 0;
}

// --- slos ---

interface SloRow {
  id: string;
  entity_id: string;
  entity_slug: string | null;
  target_type: string;
  target_ref: string;
  name: string;
  objective: string;
  target_value: number;
  window_days: number;
  version: number;
  created_at: string;
  updated_at: string;
}

function mapSlo(row: SloRow): Slo {
  return {
    id: row.id,
    entity_id: row.entity_id,
    entity_slug: row.entity_slug,
    target_type: row.target_type as Slo["target_type"],
    target_ref: row.target_ref,
    name: row.name,
    objective: row.objective as Slo["objective"],
    target_value: row.target_value,
    window_days: row.window_days,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface SloInput {
  entity_id: string;
  entity_slug?: string | null;
  target_type: Slo["target_type"];
  target_ref: string;
  name: string;
  objective: Slo["objective"];
  target_value: number;
  window_days?: number;
}

export function insertSlo(db: Database, input: SloInput): Slo {
  const id = uuid();
  const ts = now();
  db.run(
    "INSERT INTO slos (id, entity_id, entity_slug, target_type, target_ref, name, objective, target_value, window_days, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
    [id, input.entity_id, input.entity_slug ?? null, input.target_type, input.target_ref, input.name, input.objective, input.target_value, input.window_days ?? 30, ts, ts],
  );
  return getSlo(db, id)!;
}

export function getSlo(db: Database, id: string): Slo | null {
  const row = db.query("SELECT * FROM slos WHERE id = ?").get(id) as SloRow | null;
  return row ? mapSlo(row) : null;
}

export function listSlos(db: Database, entityIds?: string[]): Slo[] {
  return scopedRows<SloRow>(db, "slos", entityIds).map(mapSlo);
}

export function updateSlo(
  db: Database,
  id: string,
  patch: Partial<Pick<Slo, "name" | "objective" | "target_value" | "window_days" | "target_ref" | "target_type" | "entity_slug">>,
): Slo | null {
  const current = getSlo(db, id);
  if (!current) return null;
  db.run(
    "UPDATE slos SET name = ?, objective = ?, target_value = ?, window_days = ?, target_ref = ?, target_type = ?, entity_slug = ?, version = version + 1, updated_at = ? WHERE id = ?",
    [
      patch.name ?? current.name,
      patch.objective ?? current.objective,
      patch.target_value ?? current.target_value,
      patch.window_days ?? current.window_days,
      patch.target_ref ?? current.target_ref,
      patch.target_type ?? current.target_type,
      patch.entity_slug ?? current.entity_slug,
      now(),
      id,
    ],
  );
  return getSlo(db, id);
}

export function deleteSlo(db: Database, id: string): boolean {
  return db.run("DELETE FROM slos WHERE id = ?", [id]).changes > 0;
}

// --- error_budget_policies ---

interface EbpRow {
  id: string;
  slo_id: string;
  entity_id: string;
  budget_percent: number;
  burn_alert_threshold: number;
  window_days: number;
  version: number;
  created_at: string;
  updated_at: string;
}

function mapEbp(row: EbpRow): ErrorBudgetPolicy {
  return { ...row };
}

export interface EbpInput {
  slo_id: string;
  entity_id: string;
  budget_percent: number;
  burn_alert_threshold?: number;
  window_days?: number;
}

export function insertErrorBudgetPolicy(db: Database, input: EbpInput): ErrorBudgetPolicy {
  const id = uuid();
  const ts = now();
  db.run(
    "INSERT INTO error_budget_policies (id, slo_id, entity_id, budget_percent, burn_alert_threshold, window_days, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
    [id, input.slo_id, input.entity_id, input.budget_percent, input.burn_alert_threshold ?? 0.8, input.window_days ?? 30, ts, ts],
  );
  return getErrorBudgetPolicy(db, id)!;
}

export function getErrorBudgetPolicy(db: Database, id: string): ErrorBudgetPolicy | null {
  const row = db.query("SELECT * FROM error_budget_policies WHERE id = ?").get(id) as EbpRow | null;
  return row ? mapEbp(row) : null;
}

export function getErrorBudgetPolicyForSlo(db: Database, sloId: string): ErrorBudgetPolicy | null {
  const row = db.query("SELECT * FROM error_budget_policies WHERE slo_id = ? ORDER BY created_at DESC LIMIT 1").get(sloId) as EbpRow | null;
  return row ? mapEbp(row) : null;
}

export function listErrorBudgetPolicies(db: Database, entityIds?: string[]): ErrorBudgetPolicy[] {
  return scopedRows<EbpRow>(db, "error_budget_policies", entityIds).map(mapEbp);
}

export function updateErrorBudgetPolicy(
  db: Database,
  id: string,
  patch: Partial<Pick<ErrorBudgetPolicy, "budget_percent" | "burn_alert_threshold" | "window_days">>,
): ErrorBudgetPolicy | null {
  const current = getErrorBudgetPolicy(db, id);
  if (!current) return null;
  db.run(
    "UPDATE error_budget_policies SET budget_percent = ?, burn_alert_threshold = ?, window_days = ?, version = version + 1, updated_at = ? WHERE id = ?",
    [patch.budget_percent ?? current.budget_percent, patch.burn_alert_threshold ?? current.burn_alert_threshold, patch.window_days ?? current.window_days, now(), id],
  );
  return getErrorBudgetPolicy(db, id);
}

export function deleteErrorBudgetPolicy(db: Database, id: string): boolean {
  return db.run("DELETE FROM error_budget_policies WHERE id = ?", [id]).changes > 0;
}

// --- alert_thresholds ---

interface ThresholdRow {
  id: string;
  entity_id: string;
  slo_id: string | null;
  metric: string;
  comparator: string;
  threshold_value: number;
  severity: string;
  enabled: number;
  version: number;
  created_at: string;
  updated_at: string;
}

function mapThreshold(row: ThresholdRow): AlertThreshold {
  return {
    id: row.id,
    entity_id: row.entity_id,
    slo_id: row.slo_id,
    metric: row.metric,
    comparator: row.comparator as AlertThreshold["comparator"],
    threshold_value: row.threshold_value,
    severity: row.severity as AlertThreshold["severity"],
    enabled: row.enabled === 1,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface ThresholdInput {
  entity_id: string;
  slo_id?: string | null;
  metric: string;
  comparator: AlertThreshold["comparator"];
  threshold_value: number;
  severity?: AlertThreshold["severity"];
  enabled?: boolean;
}

export function insertAlertThreshold(db: Database, input: ThresholdInput): AlertThreshold {
  const id = uuid();
  const ts = now();
  db.run(
    "INSERT INTO alert_thresholds (id, entity_id, slo_id, metric, comparator, threshold_value, severity, enabled, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
    [id, input.entity_id, input.slo_id ?? null, input.metric, input.comparator, input.threshold_value, input.severity ?? "warning", input.enabled === false ? 0 : 1, ts, ts],
  );
  return getAlertThreshold(db, id)!;
}

export function getAlertThreshold(db: Database, id: string): AlertThreshold | null {
  const row = db.query("SELECT * FROM alert_thresholds WHERE id = ?").get(id) as ThresholdRow | null;
  return row ? mapThreshold(row) : null;
}

export function listAlertThresholds(db: Database, entityIds?: string[]): AlertThreshold[] {
  return scopedRows<ThresholdRow>(db, "alert_thresholds", entityIds).map(mapThreshold);
}

export function updateAlertThreshold(
  db: Database,
  id: string,
  patch: Partial<Pick<AlertThreshold, "metric" | "comparator" | "threshold_value" | "severity" | "enabled" | "slo_id">>,
): AlertThreshold | null {
  const current = getAlertThreshold(db, id);
  if (!current) return null;
  db.run(
    "UPDATE alert_thresholds SET metric = ?, comparator = ?, threshold_value = ?, severity = ?, enabled = ?, slo_id = ?, version = version + 1, updated_at = ? WHERE id = ?",
    [
      patch.metric ?? current.metric,
      patch.comparator ?? current.comparator,
      patch.threshold_value ?? current.threshold_value,
      patch.severity ?? current.severity,
      (patch.enabled ?? current.enabled) ? 1 : 0,
      patch.slo_id !== undefined ? patch.slo_id : current.slo_id,
      now(),
      id,
    ],
  );
  return getAlertThreshold(db, id);
}

export function deleteAlertThreshold(db: Database, id: string): boolean {
  return db.run("DELETE FROM alert_thresholds WHERE id = ?", [id]).changes > 0;
}

// --- annotations ---

interface AnnotationRow {
  id: string;
  entity_id: string;
  target_ref: string;
  at: string;
  text: string;
  author: string;
  version: number;
  created_at: string;
  updated_at: string;
}

function mapAnnotation(row: AnnotationRow): Annotation {
  return { ...row };
}

export interface AnnotationInput {
  entity_id: string;
  target_ref: string;
  at?: string;
  text: string;
  author: string;
}

export function insertAnnotation(db: Database, input: AnnotationInput): Annotation {
  const id = uuid();
  const ts = now();
  db.run(
    "INSERT INTO annotations (id, entity_id, target_ref, at, text, author, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
    [id, input.entity_id, input.target_ref, input.at ?? ts, input.text, input.author, ts, ts],
  );
  return getAnnotation(db, id)!;
}

export function getAnnotation(db: Database, id: string): Annotation | null {
  const row = db.query("SELECT * FROM annotations WHERE id = ?").get(id) as AnnotationRow | null;
  return row ? mapAnnotation(row) : null;
}

export function listAnnotations(db: Database, entityIds?: string[]): Annotation[] {
  return scopedRows<AnnotationRow>(db, "annotations", entityIds).map(mapAnnotation);
}

export function updateAnnotation(
  db: Database,
  id: string,
  patch: Partial<Pick<Annotation, "text" | "target_ref" | "at">>,
): Annotation | null {
  const current = getAnnotation(db, id);
  if (!current) return null;
  db.run(
    "UPDATE annotations SET text = ?, target_ref = ?, at = ?, version = version + 1, updated_at = ? WHERE id = ?",
    [patch.text ?? current.text, patch.target_ref ?? current.target_ref, patch.at ?? current.at, now(), id],
  );
  return getAnnotation(db, id);
}

export function deleteAnnotation(db: Database, id: string): boolean {
  return db.run("DELETE FROM annotations WHERE id = ?", [id]).changes > 0;
}

// --- entities cache (offline entity_slug resolution, §1c) ---

export function upsertEntity(db: Database, id: string, slug: string | null, name: string | null): void {
  db.run(
    "INSERT INTO entities (id, slug, name) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, name = excluded.name",
    [id, slug, name],
  );
}

export function getEntitySlug(db: Database, id: string): string | null {
  const row = db.query("SELECT slug FROM entities WHERE id = ?").get(id) as { slug: string | null } | null;
  return row?.slug ?? null;
}

// --- shared entity-scoped select ---

function scopedRows<T>(db: Database, table: string, entityIds?: string[]): T[] {
  if (!entityIds || entityIds.length === 0) {
    return db.query(`SELECT * FROM ${table} ORDER BY created_at DESC`).all() as T[];
  }
  const placeholders = entityIds.map(() => "?").join(", ");
  return db
    .query(`SELECT * FROM ${table} WHERE entity_id IN (${placeholders}) ORDER BY created_at DESC`)
    .all(...entityIds) as T[];
}
