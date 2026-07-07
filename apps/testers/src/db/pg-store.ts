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
} from "../types/index.js";

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
       (id, short_id, project_id, name, description, steps, tags, priority, model, timeout_ms, target_path, requires_auth, metadata, assertions, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'[]',1,$14,$14) RETURNING *`,
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
  filter: { projectId?: string; limit?: number } = {},
): Promise<Run[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) {
    params.push(filter.projectId);
    clauses.push(`project_id = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const rows = await db.many(`SELECT * FROM runs ${where} ORDER BY started_at DESC LIMIT ${limit}`, params);
  return rows.map(runRow);
}
export async function getRun(db: TypedQueryClient, id: string): Promise<Run | null> {
  const row = await db.get("SELECT * FROM runs WHERE id = $1", [id]);
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
  filter: { projectId?: string; limit?: number } = {},
): Promise<Persona[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.projectId) {
    params.push(filter.projectId);
    clauses.push(`project_id = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const rows = await db.many(`SELECT * FROM personas ${where} ORDER BY created_at DESC LIMIT ${limit}`, params);
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

// ─── errors ─────────────────────────────────────────────────────────────────

export class ValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
