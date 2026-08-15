/**
 * Referential-integrity conditions for the Todos dataset, and the honest verdict
 * computed from them.
 *
 * WHY THIS MODULE EXISTS: `todos doctor` used to hardcode `ok: true` on the remote
 * path and never set a non-zero exit code on either path, so a dataset carrying
 * five figures of orphaned rows reported three green check marks and exited 0. The
 * conditions below are the ones that silently hide work from operators:
 *
 *   - a task with no `project_id` is invisible to every project-scoped read;
 *   - a task with no `task_list_id` is invisible to every list-scoped read (an
 *     operator reading the list concludes there is no work);
 *   - a task list with no `project_id` is unreachable through its project;
 *   - a reference to an id that no longer exists (a DANGLING reference) is worse
 *     than a null: nothing can ever resolve it, and no UI shows it as missing.
 *
 * DESIGN CONSTRAINTS baked into this file:
 *
 *  1. ONE condition list, THREE evaluators. SQLite is relational (`tasks`,
 *     `task_lists`, `projects` with real foreign keys); Postgres is a single JSONB
 *     record table (`todos_sync_records`) with NO foreign keys at all, so orphan
 *     classes SQLite forbids structurally are possible in a self-hosted deployment.
 *     A condition added to {@link INTEGRITY_CONDITIONS} is therefore rendered for
 *     both engines (and for a client-side row scan) from the SAME declaration —
 *     a check implemented for one engine only would report healthy on the other.
 *  2. THE VERDICT IS DERIVED FROM THE REPORTED COUNTS. {@link summarizeIntegrity}
 *     is a pure function of the very condition rows that get printed. A verdict
 *     computed from a different dataset than the displayed counts is the original
 *     bug wearing a different hat.
 *  3. AN UNVERIFIED CONDITION IS NEVER A CLEAN CONDITION. When a count cannot be
 *     obtained (an authority that predates the aggregate route, a scan that could
 *     not complete), the condition carries `count: null` and the report is
 *     incomplete — it is never silently folded into "all clear".
 *  4. REPORT ONLY. Nothing here repairs data. Deciding what to do with existing
 *     orphans is an owner decision, not a diagnostic's.
 */
import { TASK_STATUSES, type TaskStatus } from "../types/index.js";

/** Machine-readable contract id for the integrity report block. */
export const TODOS_INTEGRITY_SCHEMA_VERSION = "todos.integrity.v1";

/**
 * Statuses that still represent outstanding work, derived from the canonical
 * {@link TASK_STATUSES} rather than re-listed, so a new status is classified here
 * the moment it is added to the type.
 */
const TERMINAL_TASK_STATUSES = ["completed", "failed", "cancelled"] as const;
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = TASK_STATUSES
  .filter((status) => !(TERMINAL_TASK_STATUSES as readonly string[]).includes(status));

/** Entity a condition scans. */
export type IntegrityEntity = "task" | "task_list";
/** Entity a condition's field points at. */
export type IntegrityTarget = "project" | "task_list";
/**
 * `missing` — the reference is NULL or empty, so the row is unrouted.
 * `dangling` — the reference is set but names a row that does not exist.
 */
export type IntegrityReferenceKind = "missing" | "dangling";
export type IntegritySeverity = "warn" | "error";

/** Where a condition's count came from. `unverified` means it was not measured. */
export type IntegritySource =
  | "sqlite"
  | "postgres"
  | "remote-authority"
  | "remote-scan"
  | "remote-rows"
  /** More than one measured source in a single report (the remote derivation path). */
  | "remote-derived"
  | "unverified";

export interface IntegrityConditionSpec {
  /** Stable machine id — the key automated consumers key off. */
  readonly id: string;
  readonly entity: IntegrityEntity;
  readonly field: "project_id" | "task_list_id";
  readonly target: IntegrityTarget;
  readonly kind: IntegrityReferenceKind;
  /**
   * Severity when the condition is non-empty. A `dangling` reference is always an
   * error (nothing can resolve it); a `missing` reference escalates from warn to
   * error once it hides OPEN work, which is the operator-visible harm.
   */
  readonly base_severity: IntegritySeverity;
  readonly escalate_when_open: boolean;
  /** One-line operator explanation of what the rows do to reads. */
  readonly impact: string;
}

/**
 * Every referential condition doctor knows how to count. Order is the display
 * order: task-level rows first (they hide work), then list-level rows.
 */
export const INTEGRITY_CONDITIONS: readonly IntegrityConditionSpec[] = [
  {
    id: "tasks_without_project",
    entity: "task",
    field: "project_id",
    target: "project",
    kind: "missing",
    base_severity: "warn",
    escalate_when_open: true,
    impact: "invisible to every project-scoped read (list, status, next, claim)",
  },
  {
    id: "tasks_without_task_list",
    entity: "task",
    field: "task_list_id",
    target: "task_list",
    kind: "missing",
    base_severity: "warn",
    escalate_when_open: true,
    impact: "invisible to every task-list read — the list reports zero open work",
  },
  {
    id: "tasks_with_unregistered_project",
    entity: "task",
    field: "project_id",
    target: "project",
    kind: "dangling",
    base_severity: "error",
    escalate_when_open: false,
    impact: "points at a project id that does not exist; the reference can never resolve",
  },
  {
    id: "tasks_with_unregistered_task_list",
    entity: "task",
    field: "task_list_id",
    target: "task_list",
    kind: "dangling",
    base_severity: "error",
    escalate_when_open: false,
    impact: "points at a task-list id that does not exist; the reference can never resolve",
  },
  {
    id: "task_lists_without_project",
    entity: "task_list",
    field: "project_id",
    target: "project",
    kind: "missing",
    base_severity: "warn",
    escalate_when_open: false,
    impact: "unbound list — unreachable from any project, so its tasks are unroutable",
  },
  {
    id: "task_lists_with_unregistered_project",
    entity: "task_list",
    field: "project_id",
    target: "project",
    kind: "dangling",
    base_severity: "error",
    escalate_when_open: false,
    impact: "points at a project id that does not exist; the list can never be reached",
  },
] as const;

/** Look a condition spec up by id (throws on an unknown id — ids are a contract). */
export function integrityCondition(id: string): IntegrityConditionSpec {
  const spec = INTEGRITY_CONDITIONS.find((condition) => condition.id === id);
  if (!spec) throw new Error(`unknown integrity condition: ${id}`);
  return spec;
}

/** A measured (or explicitly unmeasured) condition. */
export interface IntegrityCondition {
  id: string;
  entity: IntegrityEntity;
  field: string;
  kind: IntegrityReferenceKind;
  /** Matching rows, or `null` when the condition could not be measured. */
  count: number | null;
  /** Matching rows that are still open, `null` for entities without a status. */
  open_count: number | null;
  /** Effective severity for a non-empty condition; `null` when empty/unverified. */
  severity: IntegritySeverity | null;
  verified: boolean;
  source: IntegritySource;
  /** Why the count is missing (only set when `verified` is false). */
  unverified_reason?: string;
  message: string;
  impact: string;
}

export interface IntegritySummary {
  /** True only when every condition was measured and every count is zero. */
  ok: boolean;
  /** Conditions measured with count > 0. */
  findings: number;
  /** Rows affected across all findings. */
  rows: number;
  errors: number;
  warnings: number;
  /** Conditions that could not be measured — never counted as clean. */
  unverified: number;
  /** True when every condition was measured. */
  complete: boolean;
}

export interface IntegrityReport {
  schema_version: string;
  generated_at: string;
  /** Dominant source of the counts, for the operator reading the report. */
  source: IntegritySource;
  conditions: IntegrityCondition[];
  summary: IntegritySummary;
}

/** Raw measurement for one condition. */
export interface IntegrityMeasurement {
  count: number;
  open_count: number | null;
}

/**
 * Severity of a NON-EMPTY condition. Kept as a pure function of the measurement so
 * the printed number and the verdict cannot diverge.
 */
export function resolveIntegritySeverity(
  spec: IntegrityConditionSpec,
  measurement: IntegrityMeasurement,
): IntegritySeverity {
  if (spec.kind === "dangling") return "error";
  if (spec.escalate_when_open && (measurement.open_count ?? 0) > 0) return "error";
  return spec.base_severity;
}

const ENTITY_LABEL: Record<IntegrityEntity, [string, string]> = {
  task: ["task", "tasks"],
  task_list: ["task list", "task lists"],
};

function plural(entity: IntegrityEntity, count: number): string {
  const [one, many] = ENTITY_LABEL[entity];
  return count === 1 ? one : many;
}

/** Human line for a condition, always carrying the number it is derived from. */
export function formatIntegrityMessage(
  spec: IntegrityConditionSpec,
  measurement: IntegrityMeasurement,
): string {
  const noun = plural(spec.entity, measurement.count);
  const verb = measurement.count === 1 ? ["has", "references"] : ["have", "reference"];
  const open = measurement.open_count === null || measurement.open_count === 0
    ? ""
    : ` (${measurement.open_count} still open)`;
  return spec.kind === "missing"
    ? `${measurement.count} ${noun} ${verb[0]} no ${spec.field}${open}`
    : `${measurement.count} ${noun} ${verb[1]} a ${spec.target.replace("_", " ")} that is not registered${open}`;
}

/** Wrap a measurement as a reportable condition. */
export function measuredCondition(
  spec: IntegrityConditionSpec,
  measurement: IntegrityMeasurement,
  source: IntegritySource,
): IntegrityCondition {
  return {
    id: spec.id,
    entity: spec.entity,
    field: spec.field,
    kind: spec.kind,
    count: measurement.count,
    open_count: measurement.open_count,
    severity: measurement.count > 0 ? resolveIntegritySeverity(spec, measurement) : null,
    verified: true,
    source,
    message: formatIntegrityMessage(spec, measurement),
    impact: spec.impact,
  };
}

/**
 * A condition doctor could NOT measure. It is deliberately not a zero: an
 * unmeasured condition keeps the report incomplete so the verdict can never claim
 * health it did not establish.
 */
export function unverifiedCondition(
  spec: IntegrityConditionSpec,
  reason: string,
): IntegrityCondition {
  return {
    id: spec.id,
    entity: spec.entity,
    field: spec.field,
    kind: spec.kind,
    count: null,
    open_count: null,
    severity: null,
    verified: false,
    source: "unverified",
    unverified_reason: reason,
    message: `${spec.id}: NOT CHECKED — ${reason}`,
    impact: spec.impact,
  };
}

/**
 * The verdict. Pure function of the condition rows that get displayed:
 *   - any measured count > 0 is a finding;
 *   - any unmeasured condition makes the report incomplete;
 *   - `ok` requires BOTH completeness and zero findings.
 */
export function summarizeIntegrity(conditions: readonly IntegrityCondition[]): IntegritySummary {
  const measured = conditions.filter((condition) => condition.verified && condition.count !== null);
  const findings = measured.filter((condition) => (condition.count ?? 0) > 0);
  const unverified = conditions.length - measured.length;
  return {
    ok: unverified === 0 && findings.length === 0,
    findings: findings.length,
    rows: findings.reduce((total, condition) => total + (condition.count ?? 0), 0),
    errors: findings.filter((condition) => condition.severity === "error").length,
    warnings: findings.filter((condition) => condition.severity === "warn").length,
    unverified,
    complete: unverified === 0,
  };
}

/** Assemble a full report (summary always derived from `conditions`). */
export function buildIntegrityReport(
  conditions: IntegrityCondition[],
  generatedAt: string,
): IntegrityReport {
  const measuredSources = [...new Set(conditions.map((condition) => condition.source))]
    .filter((source) => source !== "unverified");
  return {
    schema_version: TODOS_INTEGRITY_SCHEMA_VERSION,
    generated_at: generatedAt,
    // Report-level label only; the authoritative provenance is per condition.
    source: measuredSources.length === 0
      ? "unverified"
      : measuredSources.length === 1 ? measuredSources[0]! : "remote-derived",
    conditions,
    summary: summarizeIntegrity(conditions),
  };
}

/**
 * Normalize a report that came from ANOTHER process (an authority's
 * `GET /v1/integrity`) against this build's condition list, and RECOMPUTE the
 * summary from the returned counts.
 *
 * Two ways a remote report could otherwise reintroduce the original bug:
 *   - the authority sends `summary.ok: true` next to non-zero counts, and the
 *     client believes the flag instead of the rows;
 *   - the authority is older/newer and simply omits a condition, which would
 *     silently shrink the checked set to whatever it happened to send.
 * Both are closed here: unknown conditions are dropped, missing ones become
 * UNVERIFIED, and the verdict is recomputed locally.
 */
export function adoptRemoteIntegrityReport(
  raw: { generated_at?: unknown; source?: unknown; conditions?: unknown },
  fallbackGeneratedAt: string,
): IntegrityReport {
  const received = new Map<string, Record<string, unknown>>();
  if (Array.isArray(raw.conditions)) {
    for (const entry of raw.conditions as Array<Record<string, unknown>>) {
      if (entry && typeof entry["id"] === "string") received.set(entry["id"], entry);
    }
  }
  const conditions = INTEGRITY_CONDITIONS.map((spec) => {
    const entry = received.get(spec.id);
    const count = entry?.["count"];
    const verified = entry?.["verified"];
    if (!entry || verified === false || typeof count !== "number" || !Number.isFinite(count)) {
      return unverifiedCondition(
        spec,
        entry
          ? typeof entry["unverified_reason"] === "string"
            ? String(entry["unverified_reason"])
            : "authority reported this condition without a usable count"
          : "authority did not report this condition",
      );
    }
    const openRaw = entry["open_count"];
    return measuredCondition(
      spec,
      {
        count,
        open_count: spec.entity === "task" ? (typeof openRaw === "number" && Number.isFinite(openRaw) ? openRaw : 0) : null,
      },
      typeof raw.source === "string" && raw.source === "postgres" ? "postgres" : "remote-authority",
    );
  });
  const report = buildIntegrityReport(
    conditions,
    typeof raw.generated_at === "string" ? raw.generated_at : fallbackGeneratedAt,
  );
  return typeof raw.source === "string" && (raw.source === "sqlite" || raw.source === "postgres")
    ? { ...report, source: raw.source }
    : report;
}

// ── SQLite renderer (relational tables, real foreign keys) ────────────────────

const SQLITE_TABLE: Record<IntegrityEntity | IntegrityTarget, string> = {
  task: "tasks",
  task_list: "task_lists",
  project: "projects",
};

function sqliteOpenStatusList(): string {
  return OPEN_TASK_STATUSES.map((status) => `'${status}'`).join(", ");
}

/**
 * One statement per condition returning BOTH the total and the open subtotal, so
 * the severity escalation and the displayed number come from a single read of the
 * table (no second query that could see a different dataset).
 */
export function buildSqliteIntegritySql(spec: IntegrityConditionSpec): string {
  const table = SQLITE_TABLE[spec.entity];
  const target = SQLITE_TABLE[spec.target];
  const column = `t."${spec.field}"`;
  const predicate = spec.kind === "missing"
    ? `(${column} IS NULL OR ${column} = '')`
    : `${column} IS NOT NULL AND ${column} <> '' ` +
      `AND NOT EXISTS (SELECT 1 FROM "${target}" r WHERE r."id" = ${column})`;
  const openExpr = spec.entity === "task"
    ? `SUM(CASE WHEN t."status" IN (${sqliteOpenStatusList()}) THEN 1 ELSE 0 END)`
    : "NULL";
  return `SELECT COUNT(*) AS count, ${openExpr} AS open_count FROM "${table}" t WHERE ${predicate}`;
}

// ── Postgres renderer (single JSONB record table, no foreign keys) ────────────

const RECORD_TYPE: Record<IntegrityEntity | IntegrityTarget, string> = {
  task: "tasks",
  task_list: "task_lists",
  project: "projects",
};

export interface PostgresIntegrityQuery {
  sql: string;
  params: unknown[];
}

/**
 * Postgres equivalent of {@link buildSqliteIntegritySql} against the JSONB record
 * table. Tombstones (`deleted_at IS NOT NULL`) are excluded on BOTH sides of the
 * existence check, otherwise a deleted project would make every task that points
 * at it look dangling (and a deleted task would be reported as a live orphan).
 * `$N` scalar params only — the production driver is Bun.SQL, which cannot bind a
 * JS array.
 */
export function buildPostgresIntegritySql(
  spec: IntegrityConditionSpec,
  options: { table: string; service: string },
): PostgresIntegrityQuery {
  const params: unknown[] = [options.service, RECORD_TYPE[spec.entity]];
  const p = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };
  const column = `t.payload->>'${spec.field}'`;
  const predicate = spec.kind === "missing"
    ? `(${column} IS NULL OR ${column} = '')`
    : `${column} IS NOT NULL AND ${column} <> '' AND NOT EXISTS (` +
      `SELECT 1 FROM ${options.table} r WHERE r.service = $1 AND r.object_type = ${p(RECORD_TYPE[spec.target])} ` +
      `AND r.deleted_at IS NULL AND r.object_id = ${column})`;
  const openExpr = spec.entity === "task"
    ? `COUNT(*) FILTER (WHERE t.payload->>'status' IN (${OPEN_TASK_STATUSES.map((status) => p(status)).join(", ")}))::int`
    : "NULL::int";
  const sql = `/* todos:integrity-${spec.id} */ SELECT COUNT(*)::int AS count, ${openExpr} AS open_count ` +
    `FROM ${options.table} t WHERE t.service = $1 AND t.object_type = $2 AND t.deleted_at IS NULL AND ${predicate}`;
  return { sql, params };
}

// ── In-memory row renderer (client-side scan of a remote authority) ───────────

/** The only task fields a condition needs; anything else is ignored. */
export interface IntegrityTaskRow {
  project_id?: string | null;
  task_list_id?: string | null;
  status?: string | null;
}

/** The only task-list fields a condition needs. */
export interface IntegrityTaskListRow {
  project_id?: string | null;
}

export interface IntegrityRowSets {
  tasks?: Iterable<IntegrityTaskRow>;
  taskLists?: Iterable<IntegrityTaskListRow>;
  /** Ids of REGISTERED projects — the dangling-reference denominator. */
  projectIds?: ReadonlySet<string>;
  /** Ids of REGISTERED task lists. */
  taskListIds?: ReadonlySet<string>;
}

function referenceOf(row: IntegrityTaskRow | IntegrityTaskListRow, field: string): string | null {
  const raw = (row as Record<string, unknown>)[field];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Evaluate one condition over already-materialized rows, using the SAME semantics
 * as the two SQL renderers: `missing` is null-or-empty, `dangling` is "set, but no
 * row with exactly that id exists". Returns `null` when the caller did not supply
 * the rows (or the registered-id set) the condition needs — an unmeasurable
 * condition must not come back as a zero.
 */
export function measureIntegrityRows(
  spec: IntegrityConditionSpec,
  sets: IntegrityRowSets,
): IntegrityMeasurement | null {
  const rows = spec.entity === "task" ? sets.tasks : sets.taskLists;
  if (!rows) return null;
  const registered = spec.kind === "dangling"
    ? (spec.target === "project" ? sets.projectIds : sets.taskListIds)
    : undefined;
  if (spec.kind === "dangling" && !registered) return null;

  let count = 0;
  let open = 0;
  for (const row of rows) {
    const reference = referenceOf(row, spec.field);
    const matches = spec.kind === "missing"
      ? reference === null
      : reference !== null && !registered!.has(reference);
    if (!matches) continue;
    count++;
    if (spec.entity === "task") {
      const status = (row as IntegrityTaskRow).status;
      if (typeof status === "string" && (OPEN_TASK_STATUSES as readonly string[]).includes(status)) open++;
    }
  }
  return { count, open_count: spec.entity === "task" ? open : null };
}
