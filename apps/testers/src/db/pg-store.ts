/**
 * Cloud (RDS Postgres) data store for the testers /v1 HTTP surface.
 *
 * Amendment A1 (PURE REMOTE): every function reads/writes the cloud Postgres
 * directly via the vendored storage kit's typed query client. There is no
 * cache or local mirror here. This wraps the same relational model as the
 * local SQLite layer (src/db/*) so the /v1 API exposes the app's real ops.
 */
import type { TypedQueryClient, PoolQueryClient } from "../generated/storage-kit/query.js";
import type {
  Project,
  Scenario,
  Run,
  Result,
  Persona,
  ScenarioPriority,
  PersistedScanIssue,
  Agent,
  Schedule,
  Flow,
  ApiCheck,
  ApiCheckResult,
  TestingWorkflow,
  Screenshot,
} from "../types/index.js";
import { workflowExecutionFromValue } from "../types/index.js";
import type { Environment } from "./environments.js";
import type { AuthPreset } from "./auth-presets.js";
import type { Session } from "./sessions.js";
import type { StepResult } from "./step-results.js";
import type { GoldenAnswer, GoldenCheckResult } from "./golden-answers.js";
import { getNextRunTime } from "../lib/scheduler.js";

// ─── helpers ──────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}
function nowIso(): string {
  return new Date().toISOString();
}
function shortUuid(): string {
  return uuid().slice(0, 8);
}
function j(value: unknown): string {
  return JSON.stringify(value ?? null);
}
function parse<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
function asBool(v: unknown): boolean {
  return v === true || v === 1 || v === "t" || v === "true";
}
function asNum(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v);
}

// ─── row mappers (Postgres types) ───────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function projectRow(r: any): Project {
  return {
    id: r.id,
    name: r.name,
    path: r.path ?? null,
    description: r.description ?? null,
    baseUrl: r.base_url ?? null,
    port: r.port ?? null,
    settings: parse<Record<string, unknown>>(r.settings, {}),
    scenarioPrefix: r.scenario_prefix ?? "TST",
    scenarioCounter: r.scenario_counter ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function scenarioRow(r: any): Scenario {
  return {
    id: r.id,
    shortId: r.short_id,
    projectId: r.project_id ?? null,
    name: r.name,
    description: r.description ?? "",
    steps: parse<string[]>(r.steps, []),
    tags: parse<string[]>(r.tags, []),
    priority: (r.priority ?? "medium") as ScenarioPriority,
    model: r.model ?? null,
    timeoutMs: r.timeout_ms ?? null,
    targetPath: r.target_path ?? null,
    requiresAuth: asBool(r.requires_auth),
    authConfig: r.auth_config ? parse(r.auth_config, null) : null,
    metadata: r.metadata ? parse(r.metadata, null) : null,
    assertions: parse(r.assertions, []),
    personaId: r.persona_id ?? null,
    scenarioType: (r.scenario_type ?? "browser") as Scenario["scenarioType"],
    requiredRole: r.required_role ?? null,
    version: asNum(r.version),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastPassedAt: r.last_passed_at ?? null,
    lastPassedUrl: r.last_passed_url ?? null,
    parameters: r.parameters ? parse(r.parameters, null) : null,
  };
}

function runRow(r: any): Run {
  return {
    id: r.id,
    projectId: r.project_id ?? null,
    status: r.status,
    url: r.url,
    model: r.model,
    headed: asBool(r.headed),
    parallel: asNum(r.parallel),
    total: asNum(r.total),
    passed: asNum(r.passed),
    failed: asNum(r.failed),
    startedAt: r.started_at,
    finishedAt: r.finished_at ?? null,
    metadata: r.metadata ? parse(r.metadata, null) : null,
    isBaseline: asBool(r.is_baseline),
    samples: r.samples ?? 1,
    flakinessThreshold: r.flakiness_threshold ?? 0.95,
    prNumber: r.pr_number ?? null,
    prTitle: r.pr_title ?? null,
    prBranch: r.pr_branch ?? null,
    prBaseBranch: r.pr_base_branch ?? null,
    prCommitSha: r.pr_commit_sha ?? null,
    prUrl: r.pr_url ?? null,
    ghAppInstallationId: r.gh_app_installation_id ?? null,
  };
}

function resultRow(r: any): Result {
  return {
    id: r.id,
    runId: r.run_id,
    scenarioId: r.scenario_id,
    status: r.status,
    reasoning: r.reasoning ?? null,
    error: r.error ?? null,
    stepsCompleted: asNum(r.steps_completed),
    stepsTotal: asNum(r.steps_total),
    durationMs: asNum(r.duration_ms),
    model: r.model,
    tokensUsed: asNum(r.tokens_used),
    costCents: asNum(r.cost_cents),
    metadata: r.metadata ? parse(r.metadata, null) : null,
    createdAt: r.created_at,
    personaId: r.persona_id ?? null,
    personaName: r.persona_name ?? null,
    failureAnalysis: r.failure_analysis ? parse(r.failure_analysis, null) : null,
    harPath: r.har_path ?? null,
  };
}

function personaRow(r: any): Persona {
  const hasAuth = r.auth_email && r.auth_password;
  return {
    id: r.id,
    shortId: r.short_id,
    projectId: r.project_id ?? null,
    name: r.name,
    description: r.description ?? "",
    role: r.role,
    instructions: r.instructions ?? "",
    traits: parse<string[]>(r.traits, []),
    goals: parse<string[]>(r.goals, []),
    behaviors: parse<string[]>(r.behaviors, []),
    expertiseLevel: r.expertise_level ?? "intermediate",
    demographics: parse(r.demographics, {}),
    painPoints: parse<string[]>(r.pain_points, []),
    metadata: r.metadata ? parse(r.metadata, null) : null,
    enabled: asBool(r.enabled),
    version: asNum(r.version),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    auth: hasAuth
      ? {
          email: r.auth_email,
          password: r.auth_password,
          loginPath: r.auth_login_path ?? "/login",
          cookies: r.auth_cookies ? parse(r.auth_cookies, null) : null,
          strategy: r.auth_strategy ?? "form-login",
          headers: r.auth_headers ? parse(r.auth_headers, undefined) : undefined,
          customScript: r.auth_script ?? undefined,
        }
      : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── projects ───────────────────────────────────────────────────────────────

export interface CreateProjectBody {
  name: string;
  path?: string | null;
  description?: string | null;
  baseUrl?: string | null;
  port?: number | null;
  scenarioPrefix?: string;
}

export async function listProjects(db: TypedQueryClient): Promise<Project[]> {
  const rows = await db.many("SELECT * FROM projects ORDER BY created_at DESC");
  return rows.map(projectRow);
}
export async function getProject(db: TypedQueryClient, id: string): Promise<Project | null> {
  const row = await db.get("SELECT * FROM projects WHERE id = $1", [id]);
  return row ? projectRow(row) : null;
}
export async function createProject(db: TypedQueryClient, body: CreateProjectBody): Promise<Project> {
  if (!body?.name) throw new ValidationError("name is required");
  const id = uuid();
  const ts = nowIso();
  const row = await db.get(
    `INSERT INTO projects (id, name, path, description, base_url, port, scenario_prefix, settings, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'{}',$8,$8) RETURNING *`,
    [id, body.name, body.path ?? null, body.description ?? null, body.baseUrl ?? null, body.port ?? null, body.scenarioPrefix ?? "TST", ts],
  );
  return projectRow(row);
}
export async function updateProject(
  db: TypedQueryClient,
  id: string,
  body: Partial<CreateProjectBody>,
): Promise<Project | null> {
  const existing = await getProject(db, id);
  if (!existing) return null;
  const row = await db.get(
    `UPDATE projects SET name=$2, path=$3, description=$4, base_url=$5, port=$6, updated_at=$7 WHERE id=$1 RETURNING *`,
    [
      id,
      body.name ?? existing.name,
      body.path ?? existing.path,
      body.description ?? existing.description,
      body.baseUrl ?? existing.baseUrl,
      body.port ?? existing.port,
      nowIso(),
    ],
  );
  return row ? projectRow(row) : null;
}

// ─── scenarios ──────────────────────────────────────────────────────────────

export interface CreateScenarioBody {
  name: string;
  description?: string;
  steps?: string[];
  tags?: string[];
  priority?: ScenarioPriority;
  model?: string | null;
  timeoutMs?: number | null;
  targetPath?: string | null;
  requiresAuth?: boolean;
  projectId?: string | null;
  metadata?: Record<string, unknown>;
  personaId?: string | null;
}

async function nextShortId(db: TypedQueryClient, projectId?: string | null): Promise<string> {
  if (projectId) {
    const proj = await db.get<{ scenario_prefix: string; scenario_counter: number }>(
      "SELECT scenario_prefix, scenario_counter FROM projects WHERE id = $1",
      [projectId],
    );
    if (proj) {
      const prefix = proj.scenario_prefix || "TST";
      let next = (proj.scenario_counter ?? 0) + 1;
      let shortId = `${prefix}-${next}`;
      // short_id is globally UNIQUE; per-project counters can collide across
      // projects, so advance until we find a free id (mirrors the SQLite path).
      while (await db.get("SELECT 1 FROM scenarios WHERE short_id = $1", [shortId])) {
        next += 1;
        shortId = `${prefix}-${next}`;
      }
      await db.execute("UPDATE projects SET scenario_counter = $1 WHERE id = $2", [next, projectId]);
      return shortId;
    }
  }
  return shortUuid();
}

export async function listScenarios(
  db: TypedQueryClient,
  filter: { projectId?: string; limit?: number; offset?: number } = {},
): Promise<Scenario[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) {
    params.push(filter.projectId);
    clauses.push(`project_id = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  const rows = await db.many(
    `SELECT * FROM scenarios ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return rows.map(scenarioRow);
}
export async function getScenario(db: TypedQueryClient, id: string): Promise<Scenario | null> {
  const row = await db.get("SELECT * FROM scenarios WHERE id = $1 OR short_id = $1", [id]);
  return row ? scenarioRow(row) : null;
}
export async function createScenario(
  dbc: PoolQueryClient,
  body: CreateScenarioBody,
): Promise<Scenario> {
  if (!body?.name) throw new ValidationError("name is required");
  return dbc.transaction(async (db) => {
    const id = uuid();
    const ts = nowIso();
    const shortId = await nextShortId(db, body.projectId ?? null);
    const row = await db.get(
      `INSERT INTO scenarios
       (id, short_id, project_id, name, description, steps, tags, priority, model, timeout_ms, target_path, requires_auth, metadata, persona_id, assertions, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'[]',1,$15,$15) RETURNING *`,
      [
        id,
        shortId,
        body.projectId ?? null,
        body.name,
        body.description ?? "",
        j(body.steps ?? []),
        j(body.tags ?? []),
        body.priority ?? "medium",
        body.model ?? null,
        body.timeoutMs ?? null,
        body.targetPath ?? null,
        body.requiresAuth ?? false,
        body.metadata ? j(body.metadata) : null,
        body.personaId ?? null,
        ts,
      ],
    );
    return scenarioRow(row);
  });
}
export async function updateScenario(
  db: TypedQueryClient,
  id: string,
  body: Partial<CreateScenarioBody>,
): Promise<Scenario | null> {
  const existing = await getScenario(db, id);
  if (!existing) return null;
  const row = await db.get(
    `UPDATE scenarios SET
       name=$2, description=$3, steps=$4, tags=$5, priority=$6, model=$7, timeout_ms=$8,
       target_path=$9, requires_auth=$10, metadata=$11, version=version+1, updated_at=$12
     WHERE id=$1 RETURNING *`,
    [
      existing.id,
      body.name ?? existing.name,
      body.description ?? existing.description,
      j(body.steps ?? existing.steps),
      j(body.tags ?? existing.tags),
      body.priority ?? existing.priority,
      body.model ?? existing.model,
      body.timeoutMs ?? existing.timeoutMs,
      body.targetPath ?? existing.targetPath,
      body.requiresAuth ?? existing.requiresAuth,
      body.metadata ? j(body.metadata) : existing.metadata ? j(existing.metadata) : null,
      nowIso(),
    ],
  );
  return row ? scenarioRow(row) : null;
}
/**
 * Persist the pass-cache write (lastPassedAt/lastPassedUrl) for a scenario,
 * mirroring the local SQLite store (src/db/scenarios.ts updateScenarioPassedCache).
 * This is the server side of the hosted client's PATCH /v1/scenarios/:id; the
 * client issues that PATCH from ApiStore.updateScenarioPassedCache and the
 * runner deliberately treats a failure as non-critical, so a missing route or
 * a write that omits these columns silently no-ops the cache.
 */
export async function updateScenarioPassedCache(
  db: TypedQueryClient,
  id: string,
  url: string,
): Promise<Scenario | null> {
  const row = await db.get(
    `UPDATE scenarios SET last_passed_at=$2, last_passed_url=$3, updated_at=$4 WHERE id=$1 RETURNING *`,
    [id, nowIso(), url, nowIso()],
  );
  return row ? scenarioRow(row) : null;
}
export async function deleteScenario(db: TypedQueryClient, id: string): Promise<boolean> {
  const existing = await getScenario(db, id);
  if (!existing) return false;
  await db.execute("DELETE FROM scenarios WHERE id = $1", [existing.id]);
  return true;
}
export async function countScenarios(db: TypedQueryClient): Promise<number> {
  const row = await db.get<{ n: string }>("SELECT COUNT(*)::text AS n FROM scenarios");
  return Number(row?.n ?? 0);
}

// ─── scenario bulk import (idempotent, id-keyed migration path) ──────────────

const SCENARIO_PRIORITIES = new Set<ScenarioPriority>(["low", "medium", "high", "critical"]);
const SCENARIO_TYPES = new Set(["browser", "eval", "api", "pipeline"]);

/** A JSON-string column that must always hold a value (defaults to `[]`/`{}`). */
function jsonColumn(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value; // already-serialized (from a source row)
  return JSON.stringify(value);
}
/** A JSON-string column that may be NULL. */
function nullableJsonColumn(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export interface ImportScenarioInput {
  id: string;
  shortId?: string | null;
  /** Local project *name* (project ids differ per store; we map by unique name). */
  projectName?: string | null;
  name: string;
  description?: string | null;
  steps?: unknown;
  tags?: unknown;
  priority?: string | null;
  model?: string | null;
  timeoutMs?: number | null;
  targetPath?: string | null;
  requiresAuth?: boolean | number | null;
  authConfig?: unknown;
  metadata?: unknown;
  assertions?: unknown;
  scenarioType?: string | null;
  requiredRole?: string | null;
  lastPassedAt?: string | null;
  lastPassedUrl?: string | null;
  parameters?: unknown;
  version?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ImportProjectInput {
  name: string;
  path?: string | null;
  description?: string | null;
  baseUrl?: string | null;
  port?: number | null;
  scenarioPrefix?: string | null;
  scenarioCounter?: number | null;
}

/** Normalized, ready-to-bind column values for one imported scenario. */
export interface NormalizedImportScenario {
  id: string;
  shortId: string | null;
  projectName: string | null;
  name: string;
  description: string;
  steps: string;
  tags: string;
  priority: ScenarioPriority;
  model: string | null;
  timeoutMs: number | null;
  targetPath: string | null;
  requiresAuth: boolean;
  authConfig: string | null;
  metadata: string | null;
  assertions: string;
  scenarioType: string;
  requiredRole: string | null;
  lastPassedAt: string | null;
  lastPassedUrl: string | null;
  parameters: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Pure validation/normalization for an imported scenario record. Clamps CHECK-
 * constrained columns, JSON-encodes structured columns, and fills defaults so
 * the row is safe to upsert. Preserves the source `id` (idempotency key) and
 * timestamps. Throws {@link ValidationError} on missing `id`/`name`.
 */
export function normalizeImportScenario(input: ImportScenarioInput): NormalizedImportScenario {
  if (!input || typeof input !== "object") throw new ValidationError("scenario must be an object");
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id) throw new ValidationError("scenario.id is required for import");
  if (!input.name || typeof input.name !== "string") throw new ValidationError(`scenario.name is required (id=${id})`);
  const priority = (
    typeof input.priority === "string" && SCENARIO_PRIORITIES.has(input.priority as ScenarioPriority)
      ? input.priority
      : "medium"
  ) as ScenarioPriority;
  const scenarioType =
    typeof input.scenarioType === "string" && SCENARIO_TYPES.has(input.scenarioType) ? input.scenarioType : "browser";
  const now = nowIso();
  const version = Number.isFinite(Number(input.version)) && Number(input.version) > 0 ? Math.trunc(Number(input.version)) : 1;
  return {
    id,
    shortId: typeof input.shortId === "string" && input.shortId.trim() ? input.shortId.trim() : null,
    projectName: typeof input.projectName === "string" && input.projectName ? input.projectName : null,
    name: input.name,
    description: typeof input.description === "string" ? input.description : "",
    steps: jsonColumn(input.steps, "[]"),
    tags: jsonColumn(input.tags, "[]"),
    priority,
    model: input.model ?? null,
    timeoutMs: input.timeoutMs ?? null,
    targetPath: input.targetPath ?? null,
    requiresAuth: asBool(input.requiresAuth),
    authConfig: nullableJsonColumn(input.authConfig),
    metadata: nullableJsonColumn(input.metadata),
    assertions: jsonColumn(input.assertions, "[]"),
    scenarioType,
    requiredRole: input.requiredRole ?? null,
    lastPassedAt: input.lastPassedAt ?? null,
    lastPassedUrl: input.lastPassedUrl ?? null,
    parameters: nullableJsonColumn(input.parameters),
    version,
    createdAt: typeof input.createdAt === "string" && input.createdAt ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === "string" && input.updatedAt ? input.updatedAt : now,
  };
}

export interface ImportResult {
  projects: { created: number; matched: number };
  scenarios: { inserted: number; updated: number; total: number };
}

/**
 * Idempotent bulk import of scenarios (and their projects) from another testers
 * store into the cloud. Scenarios are upserted **by primary-key `id`**, so
 * re-running never creates duplicate rows. Projects are matched/created by their
 * UNIQUE `name` (ids differ across stores), and each scenario's project is
 * resolved by `projectName`. On insert the source `short_id` is preserved when
 * globally free, otherwise a fresh unique one is minted (the `short_id` UNIQUE
 * constraint is never violated). Nothing is ever deleted.
 */
export async function importScenarios(
  dbc: PoolQueryClient,
  body: { projects?: ImportProjectInput[]; scenarios?: ImportScenarioInput[] },
): Promise<ImportResult> {
  const projectsIn = Array.isArray(body?.projects) ? body.projects : [];
  const scenariosIn = Array.isArray(body?.scenarios) ? body.scenarios : [];
  if (projectsIn.length === 0 && scenariosIn.length === 0) {
    throw new ValidationError("nothing to import: provide scenarios[] and/or projects[]");
  }
  // Validate/normalize all scenarios up front so a bad record fails the whole
  // batch before any write (keeps the batch atomic and predictable).
  const scenarios = scenariosIn.map(normalizeImportScenario);

  return dbc.transaction(async (db) => {
    // 1) Map project name -> id (existing rows first, then upsert incoming).
    const existing = await db.many<{ id: string; name: string }>("SELECT id, name FROM projects");
    const nameToId = new Map<string, string>();
    for (const p of existing) nameToId.set(p.name, p.id);

    let projCreated = 0;
    let projMatched = 0;
    for (const p of projectsIn) {
      if (!p?.name) continue;
      if (nameToId.has(p.name)) {
        projMatched++;
        continue;
      }
      // `path` is UNIQUE — only carry it over if it isn't already taken.
      let path = p.path ?? null;
      if (path && (await db.get("SELECT 1 FROM projects WHERE path = $1", [path]))) path = null;
      const ts = nowIso();
      const counter = Number.isFinite(Number(p.scenarioCounter)) ? Math.max(0, Math.trunc(Number(p.scenarioCounter))) : 0;
      const row = await db.get<{ id: string }>(
        `INSERT INTO projects (id, name, path, description, base_url, port, scenario_prefix, scenario_counter, settings, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{}',$9,$9)
         ON CONFLICT (name) DO UPDATE SET updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [uuid(), p.name, path, p.description ?? null, p.baseUrl ?? null, p.port ?? null, p.scenarioPrefix ?? "TST", counter, ts],
      );
      if (row?.id) {
        nameToId.set(p.name, row.id);
        projCreated++;
      }
    }

    // 2) Upsert scenarios by id.
    let inserted = 0;
    let updated = 0;
    for (const s of scenarios) {
      const projectId = s.projectName ? (nameToId.get(s.projectName) ?? null) : null;
      const prev = await db.get<{ id: string }>("SELECT id FROM scenarios WHERE id = $1", [s.id]);
      if (prev) {
        // Preserve the existing short_id on update (avoids UNIQUE churn).
        await db.execute(
          `UPDATE scenarios SET
             project_id=$2, name=$3, description=$4, steps=$5, tags=$6, priority=$7, model=$8,
             timeout_ms=$9, target_path=$10, requires_auth=$11, auth_config=$12, metadata=$13,
             assertions=$14, scenario_type=$15, required_role=$16, last_passed_at=$17,
             last_passed_url=$18, parameters=$19, version=$20, updated_at=$21
           WHERE id=$1`,
          [
            s.id, projectId, s.name, s.description, s.steps, s.tags, s.priority, s.model,
            s.timeoutMs, s.targetPath, s.requiresAuth, s.authConfig, s.metadata,
            s.assertions, s.scenarioType, s.requiredRole, s.lastPassedAt,
            s.lastPassedUrl, s.parameters, s.version, nowIso(),
          ],
        );
        updated++;
        continue;
      }
      // New row: keep the source short_id when globally free, else mint one.
      let shortId = s.shortId ?? shortUuid();
      while (await db.get("SELECT 1 FROM scenarios WHERE short_id = $1", [shortId])) {
        shortId = shortUuid();
      }
      await db.execute(
        `INSERT INTO scenarios
           (id, short_id, project_id, name, description, steps, tags, priority, model, timeout_ms,
            target_path, requires_auth, auth_config, metadata, assertions, scenario_type, required_role,
            last_passed_at, last_passed_url, parameters, version, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [
          s.id, shortId, projectId, s.name, s.description, s.steps, s.tags, s.priority, s.model, s.timeoutMs,
          s.targetPath, s.requiresAuth, s.authConfig, s.metadata, s.assertions, s.scenarioType, s.requiredRole,
          s.lastPassedAt, s.lastPassedUrl, s.parameters, s.version, s.createdAt, s.updatedAt,
        ],
      );
      inserted++;
    }

    return { projects: { created: projCreated, matched: projMatched }, scenarios: { inserted, updated, total: scenarios.length } };
  });
}

// ─── runs ─────────────────────────────────────────────────────────────────

export interface CreateRunBody {
  url: string;
  model?: string;
  projectId?: string | null;
  status?: string;
  metadata?: Record<string, unknown>;
}

export async function listRuns(
  db: TypedQueryClient,
  filter: { projectId?: string; limit?: number; offset?: number } = {},
): Promise<Run[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) {
    params.push(filter.projectId);
    clauses.push(`project_id = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  // Pagination MUST be honored: aggregate clients (cost reporting, visual
  // baselines) page the full set via limit+offset; ignoring offset would silently
  // cap results and undercount.
  const rows = await db.many(
    `SELECT * FROM runs ${where} ORDER BY started_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return rows.map(runRow);
}
export async function getRun(db: TypedQueryClient, id: string): Promise<Run | null> {
  const row = await db.get("SELECT * FROM runs WHERE id = $1", [id]);
  return row ? runRow(row) : null;
}

/**
 * Update mutable run columns. Accepts the same snake_case partial the local
 * `db/runs.updateRun` does (status, totals, timestamps, is_baseline, ...), so
 * the ApiStore transport can mirror the local write exactly.
 */
export async function updateRun(
  db: TypedQueryClient,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>,
): Promise<Run | null> {
  const existing = await getRun(db, id);
  if (!existing) return null;

  const columns = new Map<string, unknown>();
  const allowed: Record<string, (v: unknown) => unknown> = {
    status: (v) => v,
    url: (v) => v,
    model: (v) => v,
    headed: (v) => asBool(v),
    parallel: (v) => Number(v),
    total: (v) => Number(v),
    passed: (v) => Number(v),
    failed: (v) => Number(v),
    started_at: (v) => v,
    finished_at: (v) => v,
    metadata: (v) => (typeof v === "string" ? v : j(v)),
    is_baseline: (v) => asBool(v),
  };
  for (const [key, coerce] of Object.entries(allowed)) {
    if (body[key] !== undefined) columns.set(key, coerce(body[key]));
  }
  if (columns.size === 0) return existing;

  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [col, val] of columns) {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  }
  const row = await db.get(`UPDATE runs SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  return row ? runRow(row) : null;
}
export async function createRun(db: TypedQueryClient, body: CreateRunBody): Promise<Run> {
  if (!body?.url) throw new ValidationError("url is required");
  const id = uuid();
  const row = await db.get(
    `INSERT INTO runs (id, project_id, status, url, model, started_at, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, body.projectId ?? null, body.status ?? "pending", body.url, body.model ?? "unknown", nowIso(), body.metadata ? j(body.metadata) : "{}"],
  );
  return runRow(row);
}

// ─── results ────────────────────────────────────────────────────────────────

export async function listResultsByRun(db: TypedQueryClient, runId: string): Promise<Result[]> {
  const rows = await db.many("SELECT * FROM results WHERE run_id = $1 ORDER BY created_at ASC", [runId]);
  return rows.map(resultRow);
}
export async function getResult(db: TypedQueryClient, id: string): Promise<Result | null> {
  const row = await db.get("SELECT * FROM results WHERE id = $1", [id]);
  return row ? resultRow(row) : null;
}

export interface CreateResultBody {
  runId: string;
  scenarioId: string;
  model: string;
  stepsTotal?: number;
  personaId?: string | null;
  personaName?: string | null;
}

/**
 * Create a result row (status 'skipped', zeroed counters — the runner updates
 * it via updateResult as the scenario progresses). This is the missing write
 * half of the hosted results contract: the client's ApiStore.createResult has
 * POSTed /v1/results since 2026-07-08 (9b62324f5) but the server never routed
 * it, so sandboxed hosted-store runs 404'd on result recording (OPE21-00033).
 */
export async function createResult(db: TypedQueryClient, body: CreateResultBody): Promise<Result> {
  if (!body?.runId) throw new ValidationError("runId is required");
  if (!body?.scenarioId) throw new ValidationError("scenarioId is required");
  const id = uuid();
  const row = await db.get(
    `INSERT INTO results (id, run_id, scenario_id, status, reasoning, error, steps_completed, steps_total, duration_ms, model, tokens_used, cost_cents, metadata, created_at, persona_id, persona_name)
     VALUES ($1,$2,$3,'skipped',NULL,NULL,0,$4,0,$5,0,0,'{}',$6,$7,$8) RETURNING *`,
    [
      id,
      body.runId,
      body.scenarioId,
      body.stepsTotal ?? 0,
      body.model ?? "unknown",
      nowIso(),
      body.personaId ?? null,
      body.personaName ?? null,
    ],
  );
  return resultRow(row);
}

/**
 * Allowed update fields for a result row: camelCase client body key -> DB
 * column name, with a per-column coercion (mirrors updateRun's shape, plus the
 * pg-only failure_analysis/har_path columns resultRow already reads).
 */
const RESULT_UPDATE_COLUMNS: Record<string, { column: string; coerce: (v: unknown) => unknown }> = {
  status: { column: "status", coerce: (v) => v },
  reasoning: { column: "reasoning", coerce: (v) => v },
  error: { column: "error", coerce: (v) => v },
  stepsCompleted: { column: "steps_completed", coerce: (v) => asNum(v) },
  durationMs: { column: "duration_ms", coerce: (v) => asNum(v) },
  tokensUsed: { column: "tokens_used", coerce: (v) => asNum(v) },
  costCents: { column: "cost_cents", coerce: (v) => asNum(v) },
  metadata: { column: "metadata", coerce: (v) => (typeof v === "string" ? v : j(v)) },
  failureAnalysis: { column: "failure_analysis", coerce: (v) => (typeof v === "string" ? v : v === null ? null : j(v)) },
  harPath: { column: "har_path", coerce: (v) => (v === null ? null : String(v)) },
};

export async function updateResult(
  db: TypedQueryClient,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>,
): Promise<Result | null> {
  const existing = await getResult(db, id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [key, spec] of Object.entries(RESULT_UPDATE_COLUMNS)) {
    if (body[key] === undefined) continue;
    params.push(spec.coerce(body[key]));
    sets.push(`${spec.column} = $${params.length}`);
  }
  if (sets.length === 0) return existing;

  const row = await db.get(`UPDATE results SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  return row ? resultRow(row) : null;
}

export interface ScenarioResultStats {
  lastStatus: string | null;
  lastRunAt: string | null;
  total: number;
  passed: number;
}

/** All-time run stats for a scenario (last status + pass counts). */
export async function getScenarioResultStats(
  db: TypedQueryClient,
  scenarioId: string,
): Promise<ScenarioResultStats> {
  const last = await db.get<{ status: string; created_at: string }>(
    "SELECT status, created_at FROM results WHERE scenario_id = $1 ORDER BY created_at DESC LIMIT 1",
    [scenarioId],
  );
  const stats = await db.get<{ total: string; passed: string }>(
    "SELECT COUNT(*)::text AS total, SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END)::text AS passed FROM results WHERE scenario_id = $1",
    [scenarioId],
  );
  return {
    lastStatus: last?.status ?? null,
    lastRunAt: last?.created_at ?? null,
    total: Number(stats?.total ?? 0),
    passed: Number(stats?.passed ?? 0),
  };
}

// ─── personas ─────────────────────────────────────────────────────────────

export interface CreatePersonaBody {
  name: string;
  role: string;
  description?: string;
  instructions?: string;
  traits?: string[];
  goals?: string[];
  projectId?: string | null;
}

export async function listPersonas(
  db: TypedQueryClient,
  filter: { projectId?: string; limit?: number; offset?: number } = {},
): Promise<Persona[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) {
    params.push(filter.projectId);
    clauses.push(`project_id = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  // Pagination MUST be honored: aggregate clients (countPersonas,
  // getGlobalPersonas, listAuthenticatedPersonas) page the full set via
  // limit+offset; ignoring offset would silently cap results at the first page.
  const rows = await db.many(
    `SELECT * FROM personas ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return rows.map(personaRow);
}
export async function getPersona(db: TypedQueryClient, id: string): Promise<Persona | null> {
  const row = await db.get("SELECT * FROM personas WHERE id = $1 OR short_id = $1", [id]);
  return row ? personaRow(row) : null;
}
export async function createPersona(db: TypedQueryClient, body: CreatePersonaBody): Promise<Persona> {
  if (!body?.name) throw new ValidationError("name is required");
  if (!body?.role) throw new ValidationError("role is required");
  const id = uuid();
  const ts = nowIso();
  const row = await db.get(
    `INSERT INTO personas (id, short_id, project_id, name, description, role, instructions, traits, goals, enabled, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,1,$10,$10) RETURNING *`,
    [id, shortUuid(), body.projectId ?? null, body.name, body.description ?? "", body.role, body.instructions ?? "", j(body.traits ?? []), j(body.goals ?? []), ts],
  );
  return personaRow(row);
}
export async function updatePersona(
  db: TypedQueryClient,
  id: string,
  body: Partial<CreatePersonaBody>,
): Promise<Persona | null> {
  const existing = await getPersona(db, id);
  if (!existing) return null;
  const row = await db.get(
    `UPDATE personas SET name=$2, description=$3, role=$4, instructions=$5, traits=$6, goals=$7, version=version+1, updated_at=$8 WHERE id=$1 RETURNING *`,
    [
      existing.id,
      body.name ?? existing.name,
      body.description ?? existing.description,
      body.role ?? existing.role,
      body.instructions ?? existing.instructions,
      j(body.traits ?? existing.traits),
      j(body.goals ?? existing.goals),
      nowIso(),
    ],
  );
  return row ? personaRow(row) : null;
}
export async function deletePersona(db: TypedQueryClient, id: string): Promise<boolean> {
  const existing = await getPersona(db, id);
  if (!existing) return false;
  await db.execute("DELETE FROM personas WHERE id = $1", [existing.id]);
  return true;
}

// ─── scan issues ──────────────────────────────────────────────────────────────

function scanIssueRow(r: any): PersistedScanIssue {
  return {
    id: r.id,
    fingerprint: r.fingerprint,
    type: r.type,
    severity: r.severity,
    pageUrl: r.page_url,
    message: r.message,
    detail: r.detail ? parse<Record<string, unknown> | null>(r.detail, null) : null,
    status: r.status,
    occurrenceCount: asNum(r.occurrence_count),
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    resolvedAt: r.resolved_at ?? null,
    todoTaskId: r.todo_task_id ?? null,
    projectId: r.project_id ?? null,
  };
}

export type ScanIssueUpsertOutcome = "new" | "existing" | "regressed";

export interface ScanIssueInput {
  type: string;
  severity?: string;
  pageUrl: string;
  message: string;
  detail?: Record<string, unknown> | null;
  projectId?: string | null;
}

/**
 * djb2 fingerprint — MUST stay byte-for-byte identical to
 * src/db/scan-issues.ts::fingerprintIssue so an issue keeps ONE identity
 * whether it was first recorded through the local SQLite store or the cloud API.
 */
export function fingerprintScanIssue(issue: ScanIssueInput, projectId?: string | null): string {
  let pagePattern = issue.pageUrl;
  let scope = projectId ? `project:${projectId}` : "origin:unknown";
  try {
    const parsed = new URL(issue.pageUrl);
    pagePattern = parsed.pathname;
    if (!projectId) scope = `origin:${parsed.origin.toLowerCase()}`;
  } catch {
    // Not a valid URL — use as-is
  }
  const raw = `${scope}::${issue.type}::${issue.message.slice(0, 200)}::${pagePattern}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash) ^ raw.charCodeAt(i);
    hash = hash >>> 0;
  }
  return `${issue.type}-${hash.toString(16).padStart(8, "0")}`;
}

export async function upsertScanIssue(
  dbc: PoolQueryClient,
  input: ScanIssueInput,
): Promise<{ issue: PersistedScanIssue; outcome: ScanIssueUpsertOutcome }> {
  if (!input?.type || !input?.pageUrl || !input?.message) {
    throw new ValidationError("type, pageUrl, and message are required");
  }
  const projectId = input.projectId ?? null;
  const fingerprint = fingerprintScanIssue(input, projectId);
  const ts = nowIso();
  const severity = input.severity ?? "medium";
  const detail = input.detail ? j(input.detail) : null;
  return dbc.transaction(async (db) => {
    const existing = await db.get<{ status: string; detail: string | null }>(
      "SELECT * FROM scan_issues WHERE fingerprint = $1",
      [fingerprint],
    );
    if (!existing) {
      const row = await db.get(
        `INSERT INTO scan_issues
           (id, fingerprint, type, severity, page_url, message, detail, status, occurrence_count, first_seen_at, last_seen_at, project_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'open',1,$8,$8,$9) RETURNING *`,
        [uuid(), fingerprint, input.type, severity, input.pageUrl, input.message, detail, ts, projectId],
      );
      return { issue: scanIssueRow(row), outcome: "new" as const };
    }
    const wasResolved = existing.status === "resolved";
    const newStatus = wasResolved ? "regressed" : "open";
    const row = await db.get(
      `UPDATE scan_issues
         SET occurrence_count = occurrence_count + 1,
             last_seen_at = $2,
             status = $3,
             resolved_at = CASE WHEN $3 = 'regressed' THEN NULL ELSE resolved_at END,
             severity = $4,
             page_url = $5,
             message = $6,
             detail = $7
       WHERE fingerprint = $1 RETURNING *`,
      [fingerprint, ts, newStatus, severity, input.pageUrl, input.message, detail ?? existing.detail],
    );
    return { issue: scanIssueRow(row), outcome: wasResolved ? ("regressed" as const) : ("existing" as const) };
  });
}

export async function listScanIssues(
  db: TypedQueryClient,
  filter: { status?: string; type?: string; projectId?: string; limit?: number; offset?: number } = {},
): Promise<PersistedScanIssue[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.status) { params.push(filter.status); clauses.push(`status = $${params.length}`); }
  if (filter.type) { params.push(filter.type); clauses.push(`type = $${params.length}`); }
  if (filter.projectId) { params.push(filter.projectId); clauses.push(`project_id = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  const rows = await db.many(
    `SELECT * FROM scan_issues ${where} ORDER BY last_seen_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return rows.map(scanIssueRow);
}

export async function getScanIssue(db: TypedQueryClient, id: string): Promise<PersistedScanIssue | null> {
  const row = await db.get("SELECT * FROM scan_issues WHERE id = $1", [id]);
  return row ? scanIssueRow(row) : null;
}

export async function resolveScanIssue(db: TypedQueryClient, id: string): Promise<boolean> {
  const row = await db.get<{ id: string }>(
    "UPDATE scan_issues SET status = 'resolved', resolved_at = $2 WHERE id = $1 RETURNING id",
    [id, nowIso()],
  );
  return !!row;
}

export async function setScanIssueTodoTaskId(
  db: TypedQueryClient,
  id: string,
  todoTaskId: string,
): Promise<PersistedScanIssue | null> {
  const row = await db.get("UPDATE scan_issues SET todo_task_id = $2 WHERE id = $1 RETURNING *", [id, todoTaskId]);
  return row ? scanIssueRow(row) : null;
}

// ─── webhooks ─────────────────────────────────────────────────────────────────

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  projectId: string | null;
  secret: string | null;
  active: boolean;
  createdAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function webhookRow(r: any): Webhook {
  return {
    id: r.id,
    url: r.url,
    events: parse<string[]>(r.events, []),
    projectId: r.project_id ?? null,
    secret: r.secret ?? null,
    active: asBool(r.active),
    createdAt: r.created_at,
  };
}

export interface CreateWebhookBody {
  url: string;
  events?: string[];
  projectId?: string | null;
  secret?: string;
}

export async function listWebhooks(
  db: TypedQueryClient,
  filter: { projectId?: string; limit?: number; offset?: number } = {},
): Promise<Webhook[]> {
  const clauses: string[] = ["active = TRUE"];
  const params: unknown[] = [];
  if (filter.projectId) {
    params.push(filter.projectId);
    clauses.push(`(project_id = $${params.length} OR project_id IS NULL)`);
  }
  const limit = Math.min(Math.max(filter.limit ?? 500, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  const rows = await db.many(
    `SELECT * FROM webhooks WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return rows.map(webhookRow);
}

export async function getWebhook(db: TypedQueryClient, id: string): Promise<Webhook | null> {
  const row = await db.get("SELECT * FROM webhooks WHERE id = $1", [id]);
  return row ? webhookRow(row) : null;
}

export async function createWebhook(db: TypedQueryClient, body: CreateWebhookBody): Promise<Webhook> {
  if (!body?.url) throw new ValidationError("url is required");
  const id = uuid();
  const events = Array.isArray(body.events) && body.events.length ? body.events : ["failed"];
  const secret = body.secret ?? uuid().replace(/-/g, "");
  const row = await db.get(
    `INSERT INTO webhooks (id, url, events, project_id, secret, active, created_at)
     VALUES ($1,$2,$3,$4,$5,TRUE,$6) RETURNING *`,
    [id, body.url, j(events), body.projectId ?? null, secret, nowIso()],
  );
  return webhookRow(row);
}

export async function deleteWebhook(db: TypedQueryClient, id: string): Promise<boolean> {
  const existing = await getWebhook(db, id);
  if (!existing) return false;
  await db.execute("DELETE FROM webhooks WHERE id = $1", [existing.id]);
  return true;
}

// ─── agents ───────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function agentRow(r: any): Agent {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    role: r.role ?? null,
    metadata: r.metadata ? parse<Record<string, unknown>>(r.metadata, null as never) : null,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listAgents(db: TypedQueryClient): Promise<Agent[]> {
  const rows = await db.many("SELECT * FROM agents ORDER BY created_at DESC");
  return rows.map(agentRow);
}
export async function getAgent(db: TypedQueryClient, id: string): Promise<Agent | null> {
  const row = await db.get("SELECT * FROM agents WHERE id = $1", [id]);
  return row ? agentRow(row) : null;
}
export async function registerAgent(
  db: TypedQueryClient,
  body: { name?: string; description?: string | null; role?: string | null },
): Promise<Agent> {
  if (!body?.name) throw new ValidationError("name is required");
  const existing = await db.get("SELECT * FROM agents WHERE name = $1", [body.name]);
  if (existing) {
    const row = await db.get("UPDATE agents SET last_seen_at = $2 WHERE id = $1 RETURNING *", [
      (existing as { id: string }).id,
      nowIso(),
    ]);
    return agentRow(row);
  }
  const row = await db.get(
    `INSERT INTO agents (id, name, description, role, metadata, created_at, last_seen_at)
     VALUES ($1,$2,$3,$4,'{}',$5,$5) RETURNING *`,
    [uuid(), body.name, body.description ?? null, body.role ?? null, nowIso()],
  );
  return agentRow(row);
}
/** PATCH /v1/agents/:id — heartbeat (default) and optional focus update. */
export async function updateAgent(
  db: TypedQueryClient,
  id: string,
  body: { heartbeat?: boolean; focusScenarioId?: string | null },
): Promise<Agent | null> {
  const existing = await getAgent(db, id);
  if (!existing) return null;
  if (body.focusScenarioId !== undefined) {
    const metadata = { ...(existing.metadata ?? {}), focus: body.focusScenarioId };
    const row = await db.get("UPDATE agents SET metadata = $2, last_seen_at = $3 WHERE id = $1 RETURNING *", [
      id,
      j(metadata),
      nowIso(),
    ]);
    return row ? agentRow(row) : null;
  }
  const row = await db.get("UPDATE agents SET last_seen_at = $2 WHERE id = $1 RETURNING *", [id, nowIso()]);
  return row ? agentRow(row) : null;
}

// ─── environments (keyed on id; client resolves name client-side) ────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function environmentRow(r: any): Environment {
  const meta = parse<Record<string, unknown>>(r.metadata, {});
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    authPresetName: r.auth_preset_name ?? null,
    projectId: r.project_id ?? null,
    isDefault: asBool(r.is_default),
    variables: (meta.variables as Record<string, string>) ?? {},
    createdAt: r.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listEnvironments(db: TypedQueryClient, projectId?: string): Promise<Environment[]> {
  const rows = projectId
    ? await db.many("SELECT * FROM environments WHERE project_id = $1 ORDER BY is_default DESC, created_at DESC", [projectId])
    : await db.many("SELECT * FROM environments ORDER BY is_default DESC, created_at DESC");
  return rows.map(environmentRow);
}
export async function getEnvironment(db: TypedQueryClient, id: string): Promise<Environment | null> {
  const row = await db.get("SELECT * FROM environments WHERE id = $1", [id]);
  return row ? environmentRow(row) : null;
}
export async function createEnvironment(
  db: TypedQueryClient,
  body: {
    name?: string;
    url?: string;
    authPresetName?: string | null;
    projectId?: string | null;
    isDefault?: boolean;
    variables?: Record<string, string>;
  },
): Promise<Environment> {
  if (!body?.name) throw new ValidationError("name is required");
  if (!body?.url) throw new ValidationError("url is required");
  if (body.isDefault) await db.execute("UPDATE environments SET is_default = FALSE");
  const row = await db.get(
    `INSERT INTO environments (id, name, url, auth_preset_name, project_id, is_default, metadata, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [uuid(), body.name, body.url, body.authPresetName ?? null, body.projectId ?? null, Boolean(body.isDefault), j({ variables: body.variables ?? {} }), nowIso()],
  );
  return environmentRow(row);
}
export async function updateEnvironment(
  db: TypedQueryClient,
  id: string,
  body: { name?: string; url?: string; isDefault?: boolean; variables?: Record<string, string> },
): Promise<Environment | null> {
  const existing = await getEnvironment(db, id);
  if (!existing) return null;
  if (body.isDefault === true) await db.execute("UPDATE environments SET is_default = FALSE");
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (body.name !== undefined) { params.push(body.name); sets.push(`name = $${params.length}`); }
  if (body.url !== undefined) { params.push(body.url); sets.push(`url = $${params.length}`); }
  if (body.isDefault !== undefined) { params.push(Boolean(body.isDefault)); sets.push(`is_default = $${params.length}`); }
  if (body.variables !== undefined) { params.push(j({ variables: body.variables })); sets.push(`metadata = $${params.length}`); }
  if (sets.length === 0) return existing;
  const row = await db.get(`UPDATE environments SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  return row ? environmentRow(row) : null;
}
export async function deleteEnvironment(db: TypedQueryClient, id: string): Promise<boolean> {
  const existing = await getEnvironment(db, id);
  if (!existing) return false;
  await db.execute("DELETE FROM environments WHERE id = $1", [existing.id]);
  return true;
}

// ─── auth presets (get/delete keyed on name) ─────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function authPresetRow(r: any): AuthPreset {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    password: r.password,
    loginPath: r.login_path ?? "/login",
    metadata: parse<Record<string, unknown>>(r.metadata, {}),
    createdAt: r.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listAuthPresets(db: TypedQueryClient): Promise<AuthPreset[]> {
  const rows = await db.many("SELECT * FROM auth_presets ORDER BY created_at DESC");
  return rows.map(authPresetRow);
}
export async function getAuthPreset(db: TypedQueryClient, name: string): Promise<AuthPreset | null> {
  const row = await db.get("SELECT * FROM auth_presets WHERE name = $1 OR id = $1", [name]);
  return row ? authPresetRow(row) : null;
}
export async function createAuthPreset(
  db: TypedQueryClient,
  body: { name?: string; email?: string; password?: string; loginPath?: string },
): Promise<AuthPreset> {
  if (!body?.name) throw new ValidationError("name is required");
  if (!body?.email) throw new ValidationError("email is required");
  if (!body?.password) throw new ValidationError("password is required");
  const row = await db.get(
    `INSERT INTO auth_presets (id, name, email, password, login_path, metadata, created_at)
     VALUES ($1,$2,$3,$4,$5,'{}',$6) RETURNING *`,
    [uuid(), body.name, body.email, body.password, body.loginPath ?? "/login", nowIso()],
  );
  return authPresetRow(row);
}
export async function deleteAuthPreset(db: TypedQueryClient, name: string): Promise<boolean> {
  const existing = await getAuthPreset(db, name);
  if (!existing) return false;
  await db.execute("DELETE FROM auth_presets WHERE id = $1", [existing.id]);
  return true;
}

// ─── schedules ───────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function scheduleRow(r: any): Schedule {
  return {
    id: r.id,
    projectId: r.project_id ?? null,
    name: r.name,
    cronExpression: r.cron_expression,
    url: r.url,
    scenarioFilter: parse(r.scenario_filter, {}),
    model: r.model ?? null,
    headed: asBool(r.headed),
    parallel: asNum(r.parallel),
    timeoutMs: r.timeout_ms ?? null,
    enabled: asBool(r.enabled),
    lastRunId: r.last_run_id ?? null,
    lastRunAt: r.last_run_at ?? null,
    nextRunAt: r.next_run_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listSchedules(
  db: TypedQueryClient,
  filter: { projectId?: string; enabled?: boolean } = {},
): Promise<Schedule[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) { params.push(filter.projectId); clauses.push(`project_id = $${params.length}`); }
  if (filter.enabled !== undefined) { params.push(filter.enabled); clauses.push(`enabled = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.many(`SELECT * FROM schedules ${where} ORDER BY created_at DESC`, params);
  return rows.map(scheduleRow);
}
export async function getSchedule(db: TypedQueryClient, id: string): Promise<Schedule | null> {
  const row = await db.get("SELECT * FROM schedules WHERE id = $1", [id]);
  return row ? scheduleRow(row) : null;
}
export async function createSchedule(
  db: TypedQueryClient,
  body: {
    projectId?: string | null;
    name?: string;
    cronExpression?: string;
    url?: string;
    scenarioFilter?: Record<string, unknown>;
    model?: string | null;
    headed?: boolean;
    parallel?: number;
    timeoutMs?: number | null;
  },
): Promise<Schedule> {
  if (!body?.name) throw new ValidationError("name is required");
  if (!body?.cronExpression) throw new ValidationError("cronExpression is required");
  if (!body?.url) throw new ValidationError("url is required");
  // Persist the next fire time computed from the cron expression — the daemon
  // fires only when `nextRunAt && nextRunAt <= now`, so a schedule born with
  // next_run_at NULL would never fire.
  let nextRunAt: string | null = null;
  try {
    nextRunAt = getNextRunTime(body.cronExpression).toISOString();
  } catch {
    // Invalid cron or no next occurrence within the horizon: keep NULL, the
    // daemon gate skips schedules with no next run time.
  }
  const ts = nowIso();
  const row = await db.get(
    `INSERT INTO schedules (id, project_id, name, cron_expression, url, scenario_filter, model, headed, parallel, timeout_ms, enabled, next_run_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,$12,$13) RETURNING *`,
    [uuid(), body.projectId ?? null, body.name, body.cronExpression, body.url, j(body.scenarioFilter ?? {}), body.model ?? null, Boolean(body.headed), body.parallel ?? 1, body.timeoutMs ?? null, nextRunAt, ts, ts],
  );
  return scheduleRow(row);
}
export async function updateSchedule(
  db: TypedQueryClient,
  id: string,
  body: {
    name?: string;
    cronExpression?: string;
    url?: string;
    scenarioFilter?: Record<string, unknown>;
    model?: string | null;
    headed?: boolean;
    parallel?: number;
    timeoutMs?: number | null;
    enabled?: boolean;
    lastRunId?: string;
    nextRunAt?: string;
  },
): Promise<Schedule | null> {
  const existing = await getSchedule(db, id);
  if (!existing) return null;
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (body.name !== undefined) { params.push(body.name); sets.push(`name = $${params.length}`); }
  if (body.cronExpression !== undefined) { params.push(body.cronExpression); sets.push(`cron_expression = $${params.length}`); }
  if (body.url !== undefined) { params.push(body.url); sets.push(`url = $${params.length}`); }
  if (body.scenarioFilter !== undefined) { params.push(j(body.scenarioFilter)); sets.push(`scenario_filter = $${params.length}`); }
  if (body.model !== undefined) { params.push(body.model); sets.push(`model = $${params.length}`); }
  if (body.headed !== undefined) { params.push(Boolean(body.headed)); sets.push(`headed = $${params.length}`); }
  if (body.parallel !== undefined) { params.push(body.parallel); sets.push(`parallel = $${params.length}`); }
  if (body.timeoutMs !== undefined) { params.push(body.timeoutMs); sets.push(`timeout_ms = $${params.length}`); }
  if (body.enabled !== undefined) { params.push(Boolean(body.enabled)); sets.push(`enabled = $${params.length}`); }
  if (body.lastRunId !== undefined) {
    params.push(body.lastRunId); sets.push(`last_run_id = $${params.length}`);
    params.push(nowIso()); sets.push(`last_run_at = $${params.length}`);
  }
  if (body.nextRunAt !== undefined) { params.push(body.nextRunAt); sets.push(`next_run_at = $${params.length}`); }
  if (sets.length === 0) return existing;
  params.push(nowIso()); sets.push(`updated_at = $${params.length}`);
  const row = await db.get(`UPDATE schedules SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  return row ? scheduleRow(row) : null;
}
export async function deleteSchedule(db: TypedQueryClient, id: string): Promise<boolean> {
  const existing = await getSchedule(db, id);
  if (!existing) return false;
  await db.execute("DELETE FROM schedules WHERE id = $1", [existing.id]);
  return true;
}

// ─── flows + scenario dependencies ───────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function flowRow(r: any): Flow {
  return {
    id: r.id,
    projectId: r.project_id ?? null,
    name: r.name,
    description: r.description ?? null,
    scenarioIds: parse<string[]>(r.scenario_ids, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listFlows(db: TypedQueryClient, projectId?: string): Promise<Flow[]> {
  const rows = projectId
    ? await db.many("SELECT * FROM flows WHERE project_id = $1 ORDER BY created_at DESC", [projectId])
    : await db.many("SELECT * FROM flows ORDER BY created_at DESC");
  return rows.map(flowRow);
}
export async function getFlow(db: TypedQueryClient, id: string): Promise<Flow | null> {
  const row = await db.get("SELECT * FROM flows WHERE id = $1", [id]);
  return row ? flowRow(row) : null;
}
export async function createFlow(
  db: TypedQueryClient,
  body: { name?: string; description?: string | null; scenarioIds?: string[]; projectId?: string | null },
): Promise<Flow> {
  if (!body?.name) throw new ValidationError("name is required");
  const ts = nowIso();
  const row = await db.get(
    `INSERT INTO flows (id, project_id, name, description, scenario_ids, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
    [uuid(), body.projectId ?? null, body.name, body.description ?? null, j(body.scenarioIds ?? []), ts],
  );
  return flowRow(row);
}
export async function deleteFlow(db: TypedQueryClient, id: string): Promise<boolean> {
  const existing = await getFlow(db, id);
  if (!existing) return false;
  await db.execute("DELETE FROM flows WHERE id = $1", [existing.id]);
  return true;
}

export interface FlowDependency {
  scenarioId: string;
  dependsOn: string;
}
export async function listFlowDependencies(
  db: TypedQueryClient,
  filter: { scenarioId?: string; dependsOn?: string } = {},
): Promise<FlowDependency[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.scenarioId) { params.push(filter.scenarioId); clauses.push(`scenario_id = $${params.length}`); }
  if (filter.dependsOn) { params.push(filter.dependsOn); clauses.push(`depends_on = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.many(`SELECT scenario_id, depends_on FROM scenario_dependencies ${where}`, params);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => ({ scenarioId: r.scenario_id, dependsOn: r.depends_on }));
}
export async function createFlowDependency(
  db: TypedQueryClient,
  body: { scenarioId?: string; dependsOn?: string },
): Promise<FlowDependency> {
  if (!body?.scenarioId || !body?.dependsOn) throw new ValidationError("scenarioId and dependsOn are required");
  await db.execute(
    `INSERT INTO scenario_dependencies (scenario_id, depends_on) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [body.scenarioId, body.dependsOn],
  );
  return { scenarioId: body.scenarioId, dependsOn: body.dependsOn };
}
export async function deleteFlowDependency(db: TypedQueryClient, scenarioId: string, dependsOn: string): Promise<boolean> {
  await db.execute("DELETE FROM scenario_dependencies WHERE scenario_id = $1 AND depends_on = $2", [scenarioId, dependsOn]);
  return true;
}

// ─── sessions ────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function sessionRow(r: any): Session {
  return {
    id: r.id,
    tabId: asNum(r.tab_id),
    url: r.url ?? null,
    title: r.title ?? null,
    entries: parse<unknown[]>(r.entries, []),
    entryCount: asNum(r.entry_count),
    errorCount: asNum(r.error_count),
    consoleCount: asNum(r.console_count),
    navCount: asNum(r.nav_count),
    status: r.status,
    startTime: r.start_time,
    endTime: r.end_time ?? null,
    createdAt: r.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listSessions(db: TypedQueryClient, limit = 50, offset = 0): Promise<Session[]> {
  const lim = Math.min(Math.max(limit, 1), 500);
  const off = Math.max(offset, 0);
  const rows = await db.many(`SELECT * FROM sessions ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`);
  return rows.map(sessionRow);
}
export async function getSession(db: TypedQueryClient, id: string): Promise<Session | null> {
  const row = await db.get("SELECT * FROM sessions WHERE id = $1", [id]);
  return row ? sessionRow(row) : null;
}
export async function createSession(
  db: TypedQueryClient,
  body: {
    sessionId?: string;
    tabId?: number;
    url?: string | null;
    title?: string | null;
    entries?: string;
    entryCount?: number;
    errorCount?: number;
    consoleCount?: number;
    navCount?: number;
    status?: string;
    startTime?: string;
    endTime?: string | null;
  },
): Promise<Session> {
  const entries = typeof body.entries === "string" ? body.entries : j(body.entries ?? []);
  const row = await db.get(
    `INSERT INTO sessions (id, tab_id, url, title, entries, entry_count, error_count, console_count, nav_count, status, start_time, end_time, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      body.sessionId ?? uuid(),
      body.tabId ?? 0,
      body.url ?? null,
      body.title ?? null,
      entries,
      body.entryCount ?? 0,
      body.errorCount ?? 0,
      body.consoleCount ?? 0,
      body.navCount ?? 0,
      body.status ?? "exported",
      body.startTime ?? nowIso(),
      body.endTime ?? null,
      nowIso(),
    ],
  );
  return sessionRow(row);
}
export async function deleteSession(db: TypedQueryClient, id: string): Promise<boolean> {
  const existing = await getSession(db, id);
  if (!existing) return false;
  await db.execute("DELETE FROM sessions WHERE id = $1", [existing.id]);
  return true;
}

// ─── api checks + results ────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function apiCheckRow(r: any): ApiCheck {
  return {
    id: r.id,
    shortId: r.short_id,
    projectId: r.project_id ?? null,
    name: r.name,
    description: r.description ?? "",
    method: r.method,
    url: r.url,
    headers: parse<Record<string, string>>(r.headers, {}),
    body: r.body ?? null,
    expectedStatus: asNum(r.expected_status),
    expectedBodyContains: r.expected_body_contains ?? null,
    expectedResponseTimeMs: r.expected_response_time_ms ?? null,
    timeoutMs: asNum(r.timeout_ms),
    tags: parse<string[]>(r.tags, []),
    enabled: asBool(r.enabled),
    version: asNum(r.version),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function apiCheckResultRow(r: any): ApiCheckResult {
  return {
    id: r.id,
    checkId: r.check_id,
    runId: r.run_id ?? null,
    status: r.status,
    statusCode: r.status_code ?? null,
    responseTimeMs: r.response_time_ms ?? null,
    responseBody: r.response_body ?? null,
    responseHeaders: parse<Record<string, string>>(r.response_headers, {}),
    error: r.error ?? null,
    assertionsPassed: parse<string[]>(r.assertions_passed, []),
    assertionsFailed: parse<string[]>(r.assertions_failed, []),
    metadata: r.metadata ? parse<Record<string, unknown>>(r.metadata, null as never) : null,
    createdAt: r.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listApiChecks(
  db: TypedQueryClient,
  filter: { projectId?: string; enabled?: boolean } = {},
): Promise<ApiCheck[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) { params.push(filter.projectId); clauses.push(`project_id = $${params.length}`); }
  if (filter.enabled !== undefined) { params.push(filter.enabled); clauses.push(`enabled = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.many(`SELECT * FROM api_checks ${where} ORDER BY created_at DESC`, params);
  return rows.map(apiCheckRow);
}
export async function getApiCheck(db: TypedQueryClient, id: string): Promise<ApiCheck | null> {
  const row = await db.get("SELECT * FROM api_checks WHERE id = $1 OR short_id = $1", [id]);
  return row ? apiCheckRow(row) : null;
}
export async function createApiCheck(
  db: TypedQueryClient,
  body: {
    projectId?: string | null;
    name?: string;
    description?: string;
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string | null;
    expectedStatus?: number;
    expectedBodyContains?: string | null;
    expectedResponseTimeMs?: number | null;
    timeoutMs?: number;
    tags?: string[];
    enabled?: boolean;
  },
): Promise<ApiCheck> {
  if (!body?.name) throw new ValidationError("name is required");
  if (!body?.url) throw new ValidationError("url is required");
  const ts = nowIso();
  const row = await db.get(
    `INSERT INTO api_checks (id, short_id, project_id, name, description, method, url, headers, body, expected_status, expected_body_contains, expected_response_time_ms, timeout_ms, tags, enabled, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,1,$16,$16) RETURNING *`,
    [
      uuid(), shortUuid(), body.projectId ?? null, body.name, body.description ?? "", body.method ?? "GET", body.url,
      j(body.headers ?? {}), body.body ?? null, body.expectedStatus ?? 200, body.expectedBodyContains ?? null,
      body.expectedResponseTimeMs ?? null, body.timeoutMs ?? 10000, j(body.tags ?? []), body.enabled !== false, ts,
    ],
  );
  return apiCheckRow(row);
}
export async function updateApiCheck(
  db: TypedQueryClient,
  id: string,
  body: Record<string, unknown>,
): Promise<ApiCheck | null> {
  const existing = await getApiCheck(db, id);
  if (!existing) return null;
  const map: Record<string, string> = {
    name: "name", description: "description", method: "method", url: "url",
    expectedStatus: "expected_status", expectedBodyContains: "expected_body_contains",
    expectedResponseTimeMs: "expected_response_time_ms", timeoutMs: "timeout_ms",
  };
  const sets: string[] = [];
  const params: unknown[] = [existing.id];
  for (const [key, col] of Object.entries(map)) {
    if (body[key] !== undefined) { params.push(body[key]); sets.push(`${col} = $${params.length}`); }
  }
  if (body.headers !== undefined) { params.push(j(body.headers)); sets.push(`headers = $${params.length}`); }
  if (body.tags !== undefined) { params.push(j(body.tags)); sets.push(`tags = $${params.length}`); }
  if (body.body !== undefined) { params.push(body.body ?? null); sets.push(`body = $${params.length}`); }
  if (body.enabled !== undefined) { params.push(Boolean(body.enabled)); sets.push(`enabled = $${params.length}`); }
  params.push(existing.version + 1); sets.push(`version = $${params.length}`);
  params.push(nowIso()); sets.push(`updated_at = $${params.length}`);
  const row = await db.get(`UPDATE api_checks SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  return row ? apiCheckRow(row) : null;
}
export async function deleteApiCheck(db: TypedQueryClient, id: string): Promise<boolean> {
  const existing = await getApiCheck(db, id);
  if (!existing) return false;
  await db.execute("DELETE FROM api_checks WHERE id = $1", [existing.id]);
  return true;
}
export async function listApiCheckResults(db: TypedQueryClient, checkId: string): Promise<ApiCheckResult[]> {
  const rows = await db.many("SELECT * FROM api_check_results WHERE check_id = $1 ORDER BY created_at DESC", [checkId]);
  return rows.map(apiCheckResultRow);
}
export async function createApiCheckResult(
  db: TypedQueryClient,
  body: {
    checkId?: string;
    runId?: string | null;
    status?: string;
    statusCode?: number | null;
    responseTimeMs?: number | null;
    responseBody?: string | null;
    responseHeaders?: Record<string, string>;
    error?: string | null;
    assertionsPassed?: string[];
    assertionsFailed?: string[];
    metadata?: Record<string, unknown>;
  },
): Promise<ApiCheckResult> {
  if (!body?.checkId) throw new ValidationError("checkId is required");
  if (!body?.status) throw new ValidationError("status is required");
  const row = await db.get(
    `INSERT INTO api_check_results (id, check_id, run_id, status, status_code, response_time_ms, response_body, response_headers, error, assertions_passed, assertions_failed, metadata, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      uuid(), body.checkId, body.runId ?? null, body.status, body.statusCode ?? null, body.responseTimeMs ?? null,
      body.responseBody ?? null, j(body.responseHeaders ?? {}), body.error ?? null,
      j(body.assertionsPassed ?? []), j(body.assertionsFailed ?? []), body.metadata ? j(body.metadata) : null, nowIso(),
    ],
  );
  return apiCheckResultRow(row);
}

// ─── screenshots ─────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function screenshotRow(r: any): Screenshot {
  return {
    id: r.id,
    resultId: r.result_id,
    stepNumber: asNum(r.step_number),
    action: r.action,
    filePath: r.file_path,
    width: asNum(r.width),
    height: asNum(r.height),
    timestamp: r.timestamp,
    description: r.description ?? null,
    pageUrl: r.page_url ?? null,
    thumbnailPath: r.thumbnail_path ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listScreenshots(db: TypedQueryClient, resultId: string): Promise<Screenshot[]> {
  const rows = await db.many("SELECT * FROM screenshots WHERE result_id = $1 ORDER BY step_number ASC", [resultId]);
  return rows.map(screenshotRow);
}
export async function createScreenshot(
  db: TypedQueryClient,
  body: {
    resultId?: string;
    stepNumber?: number;
    action?: string;
    filePath?: string;
    width?: number;
    height?: number;
    description?: string | null;
    pageUrl?: string | null;
    thumbnailPath?: string | null;
  },
): Promise<Screenshot> {
  if (!body?.resultId) throw new ValidationError("resultId is required");
  if (!body?.filePath) throw new ValidationError("filePath is required");
  const row = await db.get(
    `INSERT INTO screenshots (id, result_id, step_number, action, file_path, width, height, timestamp, description, page_url, thumbnail_path)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      uuid(), body.resultId, body.stepNumber ?? 0, body.action ?? "", body.filePath, body.width ?? 0, body.height ?? 0,
      nowIso(), body.description ?? null, body.pageUrl ?? null, body.thumbnailPath ?? null,
    ],
  );
  return screenshotRow(row);
}

// ─── step results ────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function stepResultRow(r: any): StepResult {
  return {
    id: r.id,
    resultId: r.result_id,
    stepNumber: asNum(r.step_number),
    action: r.action,
    status: r.status,
    toolName: r.tool_name ?? null,
    toolInput: r.tool_input ? parse<Record<string, unknown>>(r.tool_input, null as never) : null,
    toolResult: r.tool_result ?? null,
    thinking: r.thinking ?? null,
    error: r.error ?? null,
    durationMs: r.duration_ms ?? null,
    screenshotId: r.screenshot_id ?? null,
    createdAt: r.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listStepResults(db: TypedQueryClient, resultId: string): Promise<StepResult[]> {
  const rows = await db.many("SELECT * FROM step_results WHERE result_id = $1 ORDER BY step_number ASC", [resultId]);
  return rows.map(stepResultRow);
}
export async function getStepResult(db: TypedQueryClient, id: string): Promise<StepResult | null> {
  const row = await db.get("SELECT * FROM step_results WHERE id = $1", [id]);
  return row ? stepResultRow(row) : null;
}
export async function createStepResult(
  db: TypedQueryClient,
  body: {
    resultId?: string;
    stepNumber?: number;
    action?: string;
    toolName?: string | null;
    toolInput?: Record<string, unknown> | null;
    thinking?: string | null;
  },
): Promise<StepResult> {
  if (!body?.resultId) throw new ValidationError("resultId is required");
  const row = await db.get(
    `INSERT INTO step_results (id, result_id, step_number, action, status, tool_name, tool_input, thinking, created_at)
     VALUES ($1,$2,$3,$4,'running',$5,$6,$7,$8) RETURNING *`,
    [
      uuid(), body.resultId, body.stepNumber ?? 0, body.action ?? "", body.toolName ?? null,
      body.toolInput ? j(body.toolInput) : null, body.thinking ?? null, nowIso(),
    ],
  );
  return stepResultRow(row);
}
export async function updateStepResult(
  db: TypedQueryClient,
  id: string,
  body: Record<string, unknown>,
): Promise<StepResult | null> {
  const existing = await getStepResult(db, id);
  if (!existing) return null;
  const map: Record<string, string> = {
    status: "status", action: "action", toolName: "tool_name", thinking: "thinking",
    error: "error", durationMs: "duration_ms", screenshotId: "screenshot_id",
  };
  const sets: string[] = [];
  const params: unknown[] = [existing.id];
  for (const [key, col] of Object.entries(map)) {
    if (body[key] !== undefined) { params.push(body[key]); sets.push(`${col} = $${params.length}`); }
  }
  if (body.toolInput !== undefined) { params.push(body.toolInput ? j(body.toolInput) : null); sets.push(`tool_input = $${params.length}`); }
  if (body.toolResult !== undefined) { params.push(body.toolResult ?? null); sets.push(`tool_result = $${params.length}`); }
  if (sets.length === 0) return existing;
  const row = await db.get(`UPDATE step_results SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  return row ? stepResultRow(row) : null;
}

// ─── testing workflows ───────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function workflowRow(r: any): TestingWorkflow {
  return {
    id: r.id,
    projectId: r.project_id ?? null,
    name: r.name,
    description: r.description ?? null,
    scenarioFilter: parse(r.scenario_filter, {}),
    personaIds: parse<string[]>(r.persona_ids, []),
    goal: r.goal ? parse(r.goal, null) : null,
    execution: workflowExecutionFromValue(parse(r.execution, { target: "local" })),
    settings: parse(r.settings, {}),
    enabled: asBool(r.enabled),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listTestingWorkflows(
  db: TypedQueryClient,
  filter: { projectId?: string; enabled?: boolean } = {},
): Promise<TestingWorkflow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) { params.push(filter.projectId); clauses.push(`project_id = $${params.length}`); }
  if (filter.enabled !== undefined) { params.push(filter.enabled); clauses.push(`enabled = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.many(`SELECT * FROM testing_workflows ${where} ORDER BY created_at DESC`, params);
  return rows.map(workflowRow);
}
export async function getTestingWorkflow(db: TypedQueryClient, id: string): Promise<TestingWorkflow | null> {
  const row = await db.get("SELECT * FROM testing_workflows WHERE id = $1 OR name = $1", [id]);
  return row ? workflowRow(row) : null;
}
export async function createTestingWorkflow(
  db: TypedQueryClient,
  body: {
    projectId?: string | null;
    name?: string;
    description?: string | null;
    scenarioFilter?: Record<string, unknown>;
    personaIds?: string[];
    goal?: Record<string, unknown> | null;
    execution?: unknown;
    settings?: Record<string, unknown>;
    enabled?: boolean;
  },
): Promise<TestingWorkflow> {
  if (!body?.name) throw new ValidationError("name is required");
  const ts = nowIso();
  const row = await db.get(
    `INSERT INTO testing_workflows (id, project_id, name, description, scenario_filter, persona_ids, goal, execution, settings, enabled, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`,
    [
      uuid(), body.projectId ?? null, body.name, body.description ?? null, j(body.scenarioFilter ?? {}),
      j(body.personaIds ?? []), j(body.goal ?? null), j(workflowExecutionFromValue(body.execution ?? { target: "local" })),
      j(body.settings ?? {}), body.enabled !== false, ts,
    ],
  );
  return workflowRow(row);
}
export async function updateTestingWorkflow(
  db: TypedQueryClient,
  id: string,
  body: Record<string, unknown>,
): Promise<TestingWorkflow | null> {
  const existing = await getTestingWorkflow(db, id);
  if (!existing) return null;
  const sets: string[] = [];
  const params: unknown[] = [existing.id];
  if (body.name !== undefined) { params.push(body.name); sets.push(`name = $${params.length}`); }
  if (body.description !== undefined) { params.push(body.description ?? null); sets.push(`description = $${params.length}`); }
  if (body.scenarioFilter !== undefined) { params.push(j(body.scenarioFilter)); sets.push(`scenario_filter = $${params.length}`); }
  if (body.personaIds !== undefined) { params.push(j(body.personaIds)); sets.push(`persona_ids = $${params.length}`); }
  if (body.goal !== undefined) { params.push(j(body.goal ?? null)); sets.push(`goal = $${params.length}`); }
  if (body.execution !== undefined) { params.push(j(workflowExecutionFromValue(body.execution))); sets.push(`execution = $${params.length}`); }
  if (body.settings !== undefined) { params.push(j(body.settings)); sets.push(`settings = $${params.length}`); }
  if (body.enabled !== undefined) { params.push(Boolean(body.enabled)); sets.push(`enabled = $${params.length}`); }
  if (sets.length === 0) return existing;
  params.push(nowIso()); sets.push(`updated_at = $${params.length}`);
  const row = await db.get(`UPDATE testing_workflows SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
  return row ? workflowRow(row) : null;
}
export async function deleteTestingWorkflow(db: TypedQueryClient, id: string): Promise<boolean> {
  const existing = await getTestingWorkflow(db, id);
  if (!existing) return false;
  await db.execute("DELETE FROM testing_workflows WHERE id = $1", [existing.id]);
  return true;
}

// ─── golden answers + check results ──────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
function goldenRow(r: any): GoldenAnswer {
  return {
    id: r.id,
    shortId: r.short_id,
    projectId: r.project_id ?? null,
    question: r.question,
    goldenAnswer: r.golden_answer,
    constraints: parse<string[]>(r.constraints, []),
    endpoint: r.endpoint,
    judgeModel: r.judge_model ?? null,
    enabled: asBool(r.enabled),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function goldenCheckResultRow(r: any): GoldenCheckResult {
  return {
    id: r.id,
    goldenId: r.golden_id,
    response: r.response,
    similarityScore: r.similarity_score ?? null,
    passed: asBool(r.passed),
    driftDetected: asBool(r.drift_detected),
    judgeModel: r.judge_model ?? null,
    provider: r.provider ?? null,
    createdAt: r.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function listGoldenAnswers(
  db: TypedQueryClient,
  filter: { projectId?: string; enabled?: boolean } = {},
): Promise<GoldenAnswer[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) { params.push(filter.projectId); clauses.push(`project_id = $${params.length}`); }
  if (filter.enabled !== undefined) { params.push(filter.enabled); clauses.push(`enabled = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.many(`SELECT * FROM golden_answers ${where} ORDER BY created_at DESC`, params);
  return rows.map(goldenRow);
}
export async function getGoldenAnswer(db: TypedQueryClient, id: string): Promise<GoldenAnswer | null> {
  const row = await db.get("SELECT * FROM golden_answers WHERE id = $1 OR short_id = $1", [id]);
  return row ? goldenRow(row) : null;
}
export async function createGoldenAnswer(
  db: TypedQueryClient,
  body: {
    projectId?: string | null;
    question?: string;
    goldenAnswer?: string;
    constraints?: string[];
    endpoint?: string;
    judgeModel?: string | null;
    enabled?: boolean;
  },
): Promise<GoldenAnswer> {
  if (!body?.question) throw new ValidationError("question is required");
  if (!body?.goldenAnswer) throw new ValidationError("goldenAnswer is required");
  if (!body?.endpoint) throw new ValidationError("endpoint is required");
  const ts = nowIso();
  const row = await db.get(
    `INSERT INTO golden_answers (id, short_id, project_id, question, golden_answer, constraints, endpoint, judge_model, enabled, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
    [
      uuid(), shortUuid(), body.projectId ?? null, body.question, body.goldenAnswer, j(body.constraints ?? []),
      body.endpoint, body.judgeModel ?? null, body.enabled !== false, ts,
    ],
  );
  return goldenRow(row);
}
export async function listGoldenCheckResults(db: TypedQueryClient, goldenId: string): Promise<GoldenCheckResult[]> {
  const rows = await db.many("SELECT * FROM golden_check_results WHERE golden_id = $1 ORDER BY created_at DESC", [goldenId]);
  return rows.map(goldenCheckResultRow);
}
export async function createGoldenCheckResult(
  db: TypedQueryClient,
  body: {
    goldenId?: string;
    response?: string;
    similarityScore?: number | null;
    passed?: boolean;
    driftDetected?: boolean;
    judgeModel?: string | null;
    provider?: string | null;
  },
): Promise<GoldenCheckResult> {
  if (!body?.goldenId) throw new ValidationError("goldenId is required");
  const row = await db.get(
    `INSERT INTO golden_check_results (id, golden_id, response, similarity_score, passed, drift_detected, judge_model, provider, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      uuid(), body.goldenId, body.response ?? "", body.similarityScore ?? null, Boolean(body.passed),
      Boolean(body.driftDetected), body.judgeModel ?? null, body.provider ?? null, nowIso(),
    ],
  );
  return goldenCheckResultRow(row);
}

// ─── errors ─────────────────────────────────────────────────────────────────

export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
