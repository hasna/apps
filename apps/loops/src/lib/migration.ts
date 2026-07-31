import { createHash } from "node:crypto";
import { hostname } from "node:os";
import type { Loop, LoopRun, WorkflowSpec } from "../types.js";
import { validateAgentTarget } from "./agent-adapter.js";
import { ValidationError } from "./errors.js";
import { publicLoop, publicRun, publicWorkflow } from "./format.js";
import { loopControlPlaneConfig } from "./mode.js";
import { scrubSecretsDeep } from "./redact.js";
import type { Store, StoreMigrationChecks } from "./store.js";
import { packageVersion } from "./version.js";

export const LOOPS_MIGRATION_SCHEMA = "open-loops.migration/v1";
export const LOOPS_SELF_HOSTED_PUSH_MANIFEST_SCHEMA = "open-loops.self-hosted-push-manifest/v1";

export type LoopsMigrationResource = "workflow" | "loop" | "run" | "remote";
export type LoopsMigrationAction = "insert" | "update" | "skip" | "conflict" | "blocked";

export interface LoopsMigrationBundle {
  schema: typeof LOOPS_MIGRATION_SCHEMA;
  packageVersion: string;
  exportedAt: string;
  source: {
    backend: "sqlite";
    schemaVersion: number;
    hostname: string;
  };
  checks: StoreMigrationChecks;
  importable: boolean;
  counts: {
    workflows: number;
    loops: number;
    runs: number;
  };
  data: {
    workflows: WorkflowSpec[];
    loops: Loop[];
    runs: LoopRun[];
  };
  blockers: LoopsMigrationPlanRow[];
  warnings: string[];
  hash: string;
}

export interface ExportLoopsMigrationOptions {
  includeRuns?: boolean;
}

export interface ImportLoopsMigrationOptions {
  includeRuns?: boolean;
  replace?: boolean;
  dryRun?: boolean;
}

export interface LoopsMigrationPlanRow {
  resource: LoopsMigrationResource;
  id: string;
  name?: string;
  action: LoopsMigrationAction;
  reason?: string;
  incomingHash?: string;
  currentHash?: string;
}

export interface LoopsMigrationPlanSummary {
  dryRun: boolean;
  replace: boolean;
  importable: boolean;
  workflows: number;
  loops: number;
  runs: number;
  insert: number;
  update: number;
  skip: number;
  conflict: number;
  blocked: number;
}

export interface LoopsMigrationPlan {
  schema: typeof LOOPS_MIGRATION_SCHEMA;
  operation: "import" | "self-hosted-push" | "self-hosted-pull" | "self-hosted-migrate";
  dryRun: boolean;
  replace: boolean;
  importable: boolean;
  summary: LoopsMigrationPlanSummary;
  rows: LoopsMigrationPlanRow[];
  warnings: string[];
  manifest?: SelfHostedPushManifest;
}

export interface ApplyLoopsMigrationResult {
  plan: LoopsMigrationPlan;
  applied: {
    workflows: number;
    loops: number;
    runs: number;
  };
}

export interface SelfHostedPlanOptions {
  operation: "self-hosted-push" | "self-hosted-pull" | "self-hosted-migrate";
  apiUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  includeRuns?: boolean;
  replace?: boolean;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function migrationHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function pushBlocker(rows: LoopsMigrationPlanRow[], resource: LoopsMigrationResource, id: string, reason: string, name?: string): void {
  rows.push({ resource, id, name, action: "blocked", reason });
}

function checksToBlockers(checks: StoreMigrationChecks, prefix: "source" | "destination", warnings: string[] = []): LoopsMigrationPlanRow[] {
  const rows: LoopsMigrationPlanRow[] = [];
  for (const [name, count] of Object.entries(checks.unsupportedCounts)) {
    if (count > 0) {
      pushBlocker(rows, "remote", `${prefix}:unsupported:${name}`, `${prefix} ${name} has ${count} rows; this migration bundle does not preserve that table yet`);
    }
  }
  for (const [name, count] of Object.entries(checks.volatileCounts)) {
    if (name === "daemonLeases") {
      if (count > 0) warnings.push(`${prefix} daemon_lease has ${count} volatile rows; they are intentionally not exported as authority`);
      continue;
    }
    if (count > 0) {
      pushBlocker(rows, "remote", `${prefix}:volatile:${name}`, `${prefix} ${name} has ${count} rows; stop or finish active work before no-loss migration`);
    }
  }
  return rows;
}

// Both target kinds that can carry an `env` map (command and agent) are
// treated identically for migration export: env values are live-run
// secrets exactly the same way for either, so neither can round-trip as a
// no-loss row.
const TARGET_KINDS_WITH_ENV = new Set(["command", "agent"]);

function sanitizeCommandEnv<T extends { target?: unknown }>(value: T, blockers: LoopsMigrationPlanRow[], resource: LoopsMigrationResource, id: string, name?: string): T {
  const copy = structuredClone(value) as T;
  const target = (copy as { target?: unknown }).target;
  if (target && typeof target === "object" && !Array.isArray(target) && TARGET_KINDS_WITH_ENV.has((target as { type?: unknown }).type as string)) {
    const kind = (target as { type: string }).type;
    const envTarget = target as { env?: Record<string, string> };
    if (envTarget.env && Object.keys(envTarget.env).length > 0) {
      envTarget.env = Object.fromEntries(Object.keys(envTarget.env).map((key) => [key, "[redacted]"]));
      pushBlocker(blockers, resource, id, `${kind} target env values are redacted and cannot be imported as a no-loss row`, name);
    }
  }
  return copy;
}

function sanitizeWorkflow(workflow: WorkflowSpec, blockers: LoopsMigrationPlanRow[]): WorkflowSpec {
  const copy = structuredClone(workflow) as WorkflowSpec;
  copy.steps = copy.steps.map((step) => {
    if (!TARGET_KINDS_WITH_ENV.has(step.target.type) || !step.target.env || Object.keys(step.target.env).length === 0) return step;
    pushBlocker(blockers, "workflow", workflow.id, `workflow step ${step.id} ${step.target.type} target env values are redacted and cannot be imported as a no-loss row`, workflow.name);
    return {
      ...step,
      target: {
        ...step.target,
        env: Object.fromEntries(Object.keys(step.target.env).map((key) => [key, "[redacted]"])),
      },
    };
  });
  return copy;
}

function sanitizeExportRows(rows: {
  workflows: WorkflowSpec[];
  loops: Loop[];
  runs: LoopRun[];
  checks: StoreMigrationChecks;
}): { data: LoopsMigrationBundle["data"]; blockers: LoopsMigrationPlanRow[]; warnings: string[] } {
  const blockers: LoopsMigrationPlanRow[] = [];
  const warnings: string[] = [];
  blockers.push(...checksToBlockers(rows.checks, "source", warnings));
  const workflows = rows.workflows.map((workflow) => sanitizeWorkflow(workflow, blockers));
  const loops = rows.loops.map((loop) => sanitizeCommandEnv(loop, blockers, "loop", loop.id, loop.name));
  const beforeScrub = JSON.stringify({ workflows, loops, runs: rows.runs });
  const data = scrubSecretsDeep({ workflows, loops, runs: rows.runs });
  if (JSON.stringify(data) !== beforeScrub) {
    warnings.push("secret-looking strings were scrubbed from the export bundle; treat this as non-importable unless every scrub is expected");
    pushBlocker(blockers, "remote", "secret-scrub", "secret-looking strings were scrubbed from the export bundle");
  }
  return { data, blockers, warnings };
}

export function exportLoopsMigrationBundle(store: Store, opts: ExportLoopsMigrationOptions = {}): LoopsMigrationBundle {
  const rows = store.exportMigrationRows({ includeRuns: opts.includeRuns ?? true });
  const sanitized = sanitizeExportRows(rows);
  const bundleBody = {
    schema: LOOPS_MIGRATION_SCHEMA as typeof LOOPS_MIGRATION_SCHEMA,
    packageVersion: packageVersion(),
    exportedAt: new Date().toISOString(),
    source: {
      backend: "sqlite" as const,
      schemaVersion: rows.schemaVersion,
      hostname: hostname(),
    },
    checks: rows.checks,
    importable: sanitized.blockers.length === 0,
    counts: {
      workflows: sanitized.data.workflows.length,
      loops: sanitized.data.loops.length,
      runs: sanitized.data.runs.length,
    },
    data: sanitized.data,
    blockers: sanitized.blockers,
    warnings: sanitized.warnings,
  };
  return {
    ...bundleBody,
    hash: migrationHash(bundleBody),
  };
}

export function validateLoopsMigrationBundle(value: unknown): LoopsMigrationBundle {
  if (!value || typeof value !== "object") throw new ValidationError("migration bundle must be a JSON object");
  const bundle = value as Partial<LoopsMigrationBundle>;
  if (bundle.schema !== LOOPS_MIGRATION_SCHEMA) throw new ValidationError(`unsupported migration bundle schema: ${String(bundle.schema)}`);
  if (!bundle.data || !Array.isArray(bundle.data.workflows) || !Array.isArray(bundle.data.loops) || !Array.isArray(bundle.data.runs)) {
    throw new ValidationError("migration bundle data must include workflows, loops, and runs arrays");
  }
  if (!bundle.checks || !bundle.counts || !bundle.source || !bundle.hash) throw new ValidationError("migration bundle is missing required metadata");
  const typed = bundle as LoopsMigrationBundle;
  assertMigrationBundleIntegrity(typed);
  validateMigrationAgentTargets(typed);
  return typed;
}

function validateMigrationAgentTargets(bundle: LoopsMigrationBundle): void {
  for (const [workflowIndex, workflow] of bundle.data.workflows.entries()) {
    for (const [stepIndex, step] of workflow.steps.entries()) {
      if (step.target.type === "agent") {
        validateAgentTarget(step.target, `migration workflows[${workflowIndex}].steps[${stepIndex}].target`);
      }
    }
  }
  for (const [loopIndex, loop] of bundle.data.loops.entries()) {
    if (loop.target.type === "agent") validateAgentTarget(loop.target, `migration loops[${loopIndex}].target`);
  }
}

function assertMigrationBundleIntegrity(bundle: LoopsMigrationBundle): void {
  const { hash: _hash, ...body } = bundle;
  const expectedHash = migrationHash(body);
  if (bundle.hash !== expectedHash) throw new ValidationError("migration bundle hash mismatch");
}

function rowPlanSummary(plan: Omit<LoopsMigrationPlan, "summary">): LoopsMigrationPlanSummary {
  const count = (action: LoopsMigrationAction) => plan.rows.filter((row) => row.action === action).length;
  return {
    dryRun: plan.dryRun,
    replace: plan.replace,
    importable: plan.importable,
    workflows: plan.rows.filter((row) => row.resource === "workflow").length,
    loops: plan.rows.filter((row) => row.resource === "loop").length,
    runs: plan.rows.filter((row) => row.resource === "run").length,
    insert: count("insert"),
    update: count("update"),
    skip: count("skip"),
    conflict: count("conflict"),
    blocked: count("blocked"),
  };
}

function finalizePlan(plan: Omit<LoopsMigrationPlan, "summary">): LoopsMigrationPlan {
  return { ...plan, summary: rowPlanSummary(plan) };
}

function compareResource(
  current: unknown | undefined,
  incoming: unknown,
  opts: { replace: boolean; resource: LoopsMigrationResource; id: string; name?: string },
): LoopsMigrationPlanRow {
  const incomingHash = migrationHash(incoming);
  if (!current) return { resource: opts.resource, id: opts.id, name: opts.name, action: "insert", incomingHash };
  const currentHash = migrationHash(current);
  if (currentHash === incomingHash) return { resource: opts.resource, id: opts.id, name: opts.name, action: "skip", incomingHash, currentHash };
  return {
    resource: opts.resource,
    id: opts.id,
    name: opts.name,
    action: opts.replace ? "update" : "conflict",
    reason: opts.replace ? "existing row differs and --replace was requested" : "existing row differs; rerun with --replace to update",
    incomingHash,
    currentHash,
  };
}

function remoteRepresentationRow(
  current: unknown | undefined,
  incoming: unknown,
  opts: { resource: LoopsMigrationResource; id: string; name?: string },
): LoopsMigrationPlanRow {
  const incomingHash = migrationHash(incoming);
  if (!current) return { resource: opts.resource, id: opts.id, name: opts.name, action: "insert", incomingHash };
  return {
    resource: opts.resource,
    id: opts.id,
    name: opts.name,
    action: "skip",
    reason: "remote id is represented; self-hosted list payload is public/redacted, so exact byte comparison is reserved for import apply",
    incomingHash,
    currentHash: migrationHash(current),
  };
}

export function buildImportMigrationPlan(
  store: Store,
  bundle: LoopsMigrationBundle,
  opts: ImportLoopsMigrationOptions = {},
): LoopsMigrationPlan {
  assertMigrationBundleIntegrity(bundle);
  validateMigrationAgentTargets(bundle);
  const includeRuns = opts.includeRuns ?? true;
  const replace = opts.replace ?? false;
  const rows: LoopsMigrationPlanRow[] = [];
  const warnings = [...(bundle.warnings ?? [])];
  rows.push(...checksToBlockers(store.exportMigrationRows({ includeRuns: false }).checks, "destination", warnings));
  if (!bundle.importable || bundle.blockers.length > 0) {
    rows.push(...bundle.blockers.map((row) => ({ ...row, action: "blocked" as const })));
  }

  const workflowIds = new Set(bundle.data.workflows.map((workflow) => workflow.id));
  const loopIds = new Set(bundle.data.loops.map((loop) => loop.id));

  for (const workflow of bundle.data.workflows) {
    const redactedStep = workflow.steps.find((step) => TARGET_KINDS_WITH_ENV.has(step.target.type) && step.target.env && Object.values(step.target.env).includes("[redacted]"));
    if (redactedStep) {
      rows.push({
        resource: "workflow",
        id: workflow.id,
        name: workflow.name,
        action: "blocked",
        reason: `workflow step ${redactedStep.id} has redacted ${redactedStep.target.type} env values`,
        incomingHash: migrationHash(workflow),
      });
      continue;
    }
    const activeNameCollision = store.listWorkflows({ status: "active" }).find((current) => current.name === workflow.name && current.id !== workflow.id);
    if (workflow.status === "active" && activeNameCollision) {
      rows.push({
        resource: "workflow",
        id: workflow.id,
        name: workflow.name,
        action: "conflict",
        reason: `active workflow name collides with existing workflow ${activeNameCollision.id}`,
        incomingHash: migrationHash(workflow),
        currentHash: migrationHash(activeNameCollision),
      });
      continue;
    }
    rows.push(compareResource(store.getWorkflow(workflow.id), workflow, { replace, resource: "workflow", id: workflow.id, name: workflow.name }));
  }

  for (const loop of bundle.data.loops) {
    if (
      (loop.target.type === "command" || loop.target.type === "agent") &&
      loop.target.env &&
      Object.values(loop.target.env).includes("[redacted]")
    ) {
      rows.push({
        resource: "loop",
        id: loop.id,
        name: loop.name,
        action: "blocked",
        reason: `loop has redacted ${loop.target.type} env values`,
        incomingHash: migrationHash(loop),
      });
      continue;
    }
    if (loop.target.type === "workflow" && !workflowIds.has(loop.target.workflowId) && !store.getWorkflow(loop.target.workflowId)) {
      rows.push({
        resource: "loop",
        id: loop.id,
        name: loop.name,
        action: "blocked",
        reason: `workflow target ${loop.target.workflowId} is not present in bundle or destination store`,
        incomingHash: migrationHash(loop),
      });
      continue;
    }
    rows.push(compareResource(store.getLoop(loop.id), loop, { replace, resource: "loop", id: loop.id, name: loop.name }));
  }

  if (includeRuns) {
    for (const run of bundle.data.runs) {
      if (run.status === "running") {
        rows.push({
          resource: "run",
          id: run.id,
          name: run.loopName,
          action: "blocked",
          reason: "running rows carry volatile lease/process ownership and must finish before import",
          incomingHash: migrationHash(run),
        });
        continue;
      }
      if (!loopIds.has(run.loopId) && !store.getLoop(run.loopId)) {
        rows.push({
          resource: "run",
          id: run.id,
          name: run.loopName,
          action: "blocked",
          reason: `loop ${run.loopId} is not present in bundle or destination store`,
          incomingHash: migrationHash(run),
        });
        continue;
      }
      const slot = store.getRunBySlot(run.loopId, run.scheduledFor);
      if (slot && slot.id !== run.id) {
        rows.push({
          resource: "run",
          id: run.id,
          name: run.loopName,
          action: "conflict",
          reason: `scheduled slot already belongs to run ${slot.id}`,
          incomingHash: migrationHash(run),
          currentHash: migrationHash(slot),
        });
        continue;
      }
      rows.push(compareResource(store.getRun(run.id), run, { replace, resource: "run", id: run.id, name: run.loopName }));
    }
  } else if (bundle.data.runs.length > 0) {
    warnings.push("run history is present in the bundle but --no-runs was requested");
  }

  const plan = finalizePlan({
    schema: LOOPS_MIGRATION_SCHEMA,
    operation: "import",
    dryRun: opts.dryRun ?? true,
    replace,
    importable: bundle.importable && rows.every((row) => row.action !== "blocked" && row.action !== "conflict"),
    rows,
    warnings,
  });
  return { ...plan, importable: plan.summary.blocked === 0 && plan.summary.conflict === 0 };
}

export function applyImportMigrationBundle(
  store: Store,
  bundle: LoopsMigrationBundle,
  opts: ImportLoopsMigrationOptions = {},
): ApplyLoopsMigrationResult {
  const plan = buildImportMigrationPlan(store, bundle, { ...opts, dryRun: false });
  if (plan.summary.blocked > 0 || plan.summary.conflict > 0 || !plan.importable) {
    throw new ValidationError(`migration import is not safe to apply: blocked=${plan.summary.blocked} conflict=${plan.summary.conflict}`);
  }
  const applied = { workflows: 0, loops: 0, runs: 0 };
  let appliedPlan = plan;
  store.writeTransaction(() => {
    appliedPlan = buildImportMigrationPlan(store, bundle, { ...opts, dryRun: false });
    if (appliedPlan.summary.blocked > 0 || appliedPlan.summary.conflict > 0 || !appliedPlan.importable) {
      throw new ValidationError(`destination store changed before import apply: blocked=${appliedPlan.summary.blocked} conflict=${appliedPlan.summary.conflict}`);
    }
    for (const workflow of bundle.data.workflows) {
      const row = appliedPlan.rows.find((entry) => entry.resource === "workflow" && entry.id === workflow.id);
      if (row?.action === "insert" || row?.action === "update") {
        store.upsertMigrationWorkflow(workflow, { replace: opts.replace });
        applied.workflows += 1;
      }
    }
    for (const loop of bundle.data.loops) {
      const row = appliedPlan.rows.find((entry) => entry.resource === "loop" && entry.id === loop.id);
      if (row?.action === "insert" || row?.action === "update") {
        store.upsertMigrationLoop(loop, { replace: opts.replace });
        applied.loops += 1;
      }
    }
    if (opts.includeRuns ?? true) {
      for (const run of bundle.data.runs) {
        const row = appliedPlan.rows.find((entry) => entry.resource === "run" && entry.id === run.id);
        if (row?.action === "insert" || row?.action === "update") {
          store.upsertMigrationRun(run, { replace: opts.replace });
          applied.runs += 1;
        }
      }
    }
  });
  return { plan: appliedPlan, applied };
}

function envValue(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

// Bounds every control-plane HTTP request so a slow/unreachable self-hosted host
// can never hang the CLI indefinitely. Override with HASNA_LOOPS_API_TIMEOUT_MS
// or the `timeoutMs` option.
const DEFAULT_CONTROL_PLANE_TIMEOUT_MS = 15_000;
const CONTROL_PLANE_TIMEOUT_ENV_KEYS = ["HASNA_LOOPS_API_TIMEOUT_MS"] as const;

function resolveTimeoutMs(opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv }): number {
  if (typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0) {
    return opts.timeoutMs;
  }
  const raw = envValue(opts.env ?? process.env, CONTROL_PLANE_TIMEOUT_ENV_KEYS);
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_CONTROL_PLANE_TIMEOUT_MS;
}

function resolveApiConfig(opts: { apiUrl?: string; apiKey?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }): { apiUrl?: string; token?: string; timeoutMs: number } {
  const env = opts.env ?? process.env;
  return {
    apiUrl: opts.apiUrl ?? envValue(env, ["HASNA_LOOPS_API_URL"]),
    token: opts.apiKey ?? envValue(env, ["HASNA_LOOPS_API_KEY"]),
    timeoutMs: resolveTimeoutMs(opts),
  };
}

function endpoint(base: string, path: string): string {
  return new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`).toString();
}

async function requestJson(
  fetchImpl: typeof fetch,
  config: { apiUrl: string; token?: string; timeoutMs?: number },
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const url = endpoint(config.apiUrl, path);
  const timeoutMs = config.timeoutMs ?? DEFAULT_CONTROL_PLANE_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal,
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (timeoutSignal.aborted) {
      throw Object.assign(
        new Error(`loops control-plane request to ${url} timed out after ${timeoutMs}ms`),
        { code: "ETIMEDOUT", timeoutMs },
      );
    }
    throw error;
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw Object.assign(
      new Error(typeof payload.error === "string" ? payload.error : `loops-api request failed: ${response.status}`),
      { status: response.status, payload },
    );
  }
  return payload;
}

interface RemotePreview {
  workflows: unknown[];
  loops: unknown[];
  runs: unknown[];
  counts: { workflows?: number; loops?: number; runs?: number };
  unsupported: string[];
  warnings: string[];
}

async function fetchPagedRows(
  fetchImpl: typeof fetch,
  config: { apiUrl: string; token?: string; timeoutMs?: number },
  path: string,
  key: "workflows" | "loops" | "runs",
  opts: { unsupported: string[]; warnings: string[] },
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    try {
      const separator = path.includes("?") ? "&" : "?";
      const payload = await requestJson(fetchImpl, config, `${path}${separator}limit=${limit}&offset=${offset}`);
      const page = Array.isArray(payload[key]) ? payload[key] as unknown[] : [];
      rows.push(...page);
      if (page.length < limit) break;
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        opts.unsupported.push(path);
        opts.warnings.push(`self-hosted control plane does not expose ${path}; exact ${key} comparison is unavailable`);
        break;
      }
      throw error;
    }
  }
  return rows;
}

async function fetchOptionalCount(
  fetchImpl: typeof fetch,
  config: { apiUrl: string; token?: string; timeoutMs?: number },
  path: string,
  opts: { unsupported: string[]; warnings: string[] },
): Promise<number | undefined> {
  try {
    const payload = await requestJson(fetchImpl, config, path);
    return typeof payload.count === "number" ? payload.count : undefined;
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      opts.unsupported.push(path);
      opts.warnings.push(`self-hosted control plane does not expose ${path}; count comparison is unavailable`);
      return undefined;
    }
    throw error;
  }
}

async function fetchRemotePreview(opts: SelfHostedPlanOptions): Promise<RemotePreview> {
  const config = resolveApiConfig(opts);
  const warnings: string[] = [];
  const unsupported: string[] = [];
  if (!config.apiUrl) {
    warnings.push("HASNA_LOOPS_API_URL is required to inspect a self-hosted control plane");
    return { workflows: [], loops: [], runs: [], counts: {}, unsupported, warnings };
  }
  if (!config.token) {
    warnings.push("self-hosted APIs require HASNA_LOOPS_API_KEY");
    return { workflows: [], loops: [], runs: [], counts: {}, unsupported, warnings };
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const api = { apiUrl: config.apiUrl, token: config.token, timeoutMs: config.timeoutMs };
  const requestOpts = { unsupported, warnings };
  const workflows = await fetchPagedRows(fetchImpl, api, "/v1/workflows", "workflows", requestOpts);
  const loops = await fetchPagedRows(fetchImpl, api, "/v1/loops?includeArchived=true", "loops", requestOpts);
  // Never enumerate remote run bodies for a preview: on a busy host `/v1/runs`
  // with output is hundreds of MB across thousands of pages, which is what made
  // `self-hosted migrate/pull/push --dry-run` hang. Run history is compared by
  // count here; `self-hosted push --apply` streams runs id-preserving instead.
  const runs: unknown[] = [];
  return {
    workflows,
    loops,
    runs,
    counts: {
      workflows: await fetchOptionalCount(fetchImpl, api, "/v1/workflows/count", requestOpts),
      loops: await fetchOptionalCount(fetchImpl, api, "/v1/loops/count?includeArchived=true", requestOpts),
      runs: opts.includeRuns === false ? undefined : await fetchOptionalCount(fetchImpl, api, "/v1/runs/count", requestOpts),
    },
    unsupported,
    warnings,
  };
}

function disabledWorkflowForSelfHostedImport(workflow: WorkflowSpec): WorkflowSpec {
  return { ...workflow, status: "archived" };
}

function pausedLoopForSelfHostedImport(loop: Loop): Loop {
  return {
    ...loop,
    status: "paused",
    nextRunAt: undefined,
    retryScheduledFor: undefined,
  };
}

function selfHostedDefinitionBundle(bundle: LoopsMigrationBundle): LoopsMigrationBundle {
  const body = {
    ...bundle,
    data: {
      workflows: bundle.data.workflows.map(disabledWorkflowForSelfHostedImport),
      loops: bundle.data.loops.map(pausedLoopForSelfHostedImport),
      runs: bundle.data.runs,
    },
  };
  const { hash: _hash, ...hashBody } = body;
  return { ...body, hash: migrationHash(hashBody) };
}

function typedRows<T extends { id: string }>(rows: unknown[]): T[] {
  return rows.filter((row): row is T => Boolean(row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"));
}

function rowsById<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function rowsByName<T extends { id?: unknown; name?: unknown }>(rows: T[]): Map<string, T> {
  return new Map(rows.filter((row) => typeof row.name === "string").map((row) => [String(row.name), row]));
}

function rowIds(rows: LoopsMigrationPlanRow[], resource: LoopsMigrationResource, action: LoopsMigrationAction): string[] {
  return rows.filter((row) => row.resource === resource && row.action === action).map((row) => row.id);
}

function existingRowIds(rows: LoopsMigrationPlanRow[], resource: LoopsMigrationResource): string[] {
  return rows.filter((row) => row.resource === resource && (row.action === "skip" || row.action === "update")).map((row) => row.id);
}

function buildSelfHostedManifest(args: {
  apiUrl?: string;
  dryRun: boolean;
  replace: boolean;
  includeRuns: boolean;
  bundle: LoopsMigrationBundle;
  remote: RemotePreview;
  plan: LoopsMigrationPlan;
  applied?: { workflows: number; loops: number; runs: number };
  skipped?: { runningRuns: number; orphanRuns: number };
  requests?: number;
  remoteAfter?: { workflows?: number; loops?: number; runs?: number };
}): SelfHostedPushManifest {
  return {
    schema: LOOPS_SELF_HOSTED_PUSH_MANIFEST_SCHEMA,
    generatedAt: new Date().toISOString(),
    apiUrl: args.apiUrl,
    dryRun: args.dryRun,
    replace: args.replace,
    includeRuns: args.includeRuns,
    safety: {
      forcedLoopStatus: "paused",
      clearedLoopRunPointers: true,
      forcedWorkflowStatus: "archived",
      resumesLoops: false,
    },
    counts: {
      source: args.bundle.counts,
      remoteBefore: args.remote.counts,
      remoteAfter: args.remoteAfter,
      plan: args.plan.summary,
      applied: args.applied,
      skipped: args.skipped,
      requests: args.requests,
    },
    missingIds: {
      workflows: rowIds(args.plan.rows, "workflow", "insert"),
      loops: rowIds(args.plan.rows, "loop", "insert"),
      runs: rowIds(args.plan.rows, "run", "insert"),
    },
    existingIds: {
      workflows: existingRowIds(args.plan.rows, "workflow"),
      loops: existingRowIds(args.plan.rows, "loop"),
      runs: existingRowIds(args.plan.rows, "run"),
    },
    unsafe: {
      blocked: args.plan.rows.filter((row) => row.action === "blocked"),
      conflicts: args.plan.rows.filter((row) => row.action === "conflict"),
      unsupported: args.remote.unsupported,
      warnings: args.plan.warnings,
    },
    rollback: {
      notes: [
        "self-hosted push imports through id-preserving upserts; no local loops are resumed or mutated",
        "imported loops are forced to paused with nextRunAt/retryScheduledFor cleared before upload",
        "imported workflows are forced to archived before upload",
        "rollback is manual: archive or delete imported ids from the self-hosted control plane after reviewing this manifest",
      ],
      commands: [
        "loops self-hosted push --dry-run --no-runs --manifest-file <post-rollback-check.json>",
      ],
    },
  };
}

export async function buildSelfHostedMigrationPlan(store: Store, opts: SelfHostedPlanOptions): Promise<LoopsMigrationPlan> {
  const includeRuns = opts.includeRuns ?? true;
  // Definitions only: loading every run's stdout/stderr into memory (a full
  // `includeRuns: true` export) is what made the preview hang on a busy host.
  // Run history is summarised by count below instead of enumerated row by row.
  const bundle = selfHostedDefinitionBundle(exportLoopsMigrationBundle(store, { includeRuns: false }));
  const localRunCount = includeRuns ? store.countRuns() : 0;
  bundle.counts = { ...bundle.counts, runs: localRunCount };
  const remote = await fetchRemotePreview(opts);
  const rows: LoopsMigrationPlanRow[] = [...bundle.blockers.map((row) => ({ ...row, action: "blocked" as const }))];
  const warnings = [
    ...bundle.warnings,
    ...remote.warnings,
    "self-hosted push forces imported loops to paused and imported workflows to archived until activation is explicitly approved",
  ];
  const config = resolveApiConfig(opts);
  const apiUrl = config.apiUrl;
  if (!apiUrl) {
    pushBlocker(rows, "remote", "self-hosted-api-url", "HASNA_LOOPS_API_URL is required to compare a self-hosted control plane");
  } else if (!config.token) {
    pushBlocker(rows, "remote", "self-hosted-api-key", "self-hosted APIs require HASNA_LOOPS_API_KEY");
  }
  const replace = opts.replace ?? false;
  if (opts.operation === "self-hosted-pull") {
    for (const entry of remote.loops) {
      const value = entry && typeof entry === "object" ? entry as { id?: unknown; name?: unknown } : {};
      const id = typeof value.id === "string" ? value.id : `remote-loop:${rows.length}`;
      rows.push({
        resource: "loop",
        id,
        name: typeof value.name === "string" ? value.name : undefined,
        action: "blocked",
        reason: "remote loop pull needs a full id-preserving export/import endpoint; /v1/loops returns public redacted rows only",
        currentHash: migrationHash(entry),
      });
    }
    if (includeRuns && typeof remote.counts.runs === "number" && remote.counts.runs > 0) {
      rows.push({
        resource: "run",
        id: "remote:run-history",
        action: "blocked",
        reason: `remote run-history pull needs an id-preserving export/import endpoint; ${remote.counts.runs} remote runs are exposed by /v1/runs as public redacted rows only`,
      });
    }
    const plan = finalizePlan({
      schema: LOOPS_MIGRATION_SCHEMA,
      operation: opts.operation,
      dryRun: true,
      replace,
      importable: false,
      rows,
      warnings,
    });
    return {
      ...plan,
      importable: false,
      manifest: buildSelfHostedManifest({
        apiUrl,
        dryRun: true,
        replace,
        includeRuns,
        bundle,
        remote,
        plan,
      }),
    };
  }
  const remoteWorkflows = typedRows<WorkflowSpec>(remote.workflows);
  const remoteLoops = typedRows<Loop>(remote.loops);
  const remoteWorkflowsById = rowsById(remoteWorkflows);
  const remoteLoopsById = rowsById(remoteLoops);
  const remoteLoopsByName = rowsByName(remoteLoops);

  for (const workflow of bundle.data.workflows) {
    if (remote.unsupported.some((entry) => entry.startsWith("/v1/workflows"))) {
      rows.push({
        resource: "workflow",
        id: workflow.id,
        name: workflow.name,
        action: "blocked",
        reason: "self-hosted API does not expose workflow list/count endpoints for safe comparison",
        incomingHash: migrationHash(workflow),
      });
      continue;
    }
    rows.push(remoteRepresentationRow(remoteWorkflowsById.get(workflow.id), workflow, {
      resource: "workflow",
      id: workflow.id,
      name: workflow.name,
    }));
  }
  for (const loop of bundle.data.loops) {
    const remoteLoop = remoteLoopsById.get(loop.id);
    if (!remoteLoop) {
      const nameCollision = remoteLoopsByName.get(loop.name);
      if (nameCollision && nameCollision.id !== loop.id) {
        rows.push({
          resource: "loop",
          id: loop.id,
          name: loop.name,
          action: "insert",
          reason: `remote loop name exists under different id ${String(nameCollision.id ?? "unknown id")}; id-preserving import will add the missing source id paused`,
          incomingHash: migrationHash(loop),
          currentHash: migrationHash(nameCollision),
        });
        continue;
      }
    }
    rows.push(remoteRepresentationRow(remoteLoop, loop, { resource: "loop", id: loop.id, name: loop.name }));
  }
  if (includeRuns && localRunCount > 0) {
    // Run history is summarised by count instead of enumerated: per-run rows
    // would require loading every local/remote run body (the original hang).
    // Volatile `running` runs, if any, are already surfaced as blockers above
    // via the source migration checks, so apply-time safety is preserved.
    const remoteRunNote = typeof remote.counts.runs === "number" ? `, remote=${remote.counts.runs}` : "";
    warnings.push(
      `run history is compared by count for preview performance: local=${localRunCount}${remoteRunNote}; ` +
        "`self-hosted push --apply` streams individual runs id-preserving",
    );
  }

  let plan = finalizePlan({
    schema: LOOPS_MIGRATION_SCHEMA,
    operation: opts.operation,
    dryRun: true,
    replace,
    importable: bundle.importable && rows.every((row) => row.action !== "blocked" && row.action !== "conflict"),
    rows,
    warnings,
  });
  plan = { ...plan, importable: plan.summary.blocked === 0 && plan.summary.conflict === 0 };
  return {
    ...plan,
    manifest: buildSelfHostedManifest({
      apiUrl,
      dryRun: true,
      replace,
      includeRuns,
      bundle,
      remote,
      plan,
    }),
  };
}

export interface SelfHostedPushOptions {
  apiUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  includeRuns?: boolean;
  replace?: boolean;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Max rows per workflow/loop batch (default 200). */
  batchRows?: number;
  /** Approx max JSON bytes per run batch (default 4 MiB). */
  runBatchBytes?: number;
  onProgress?: (event: { phase: "workflows" | "loops" | "runs"; sent: number; requests: number }) => void;
}

export interface SelfHostedPushResult {
  ok: boolean;
  apiUrl: string;
  applied: { workflows: number; loops: number; runs: number };
  skipped: { runningRuns: number; orphanRuns: number };
  requests: number;
  manifest: SelfHostedPushManifest;
}

export interface SelfHostedPushManifest {
  schema: typeof LOOPS_SELF_HOSTED_PUSH_MANIFEST_SCHEMA;
  generatedAt: string;
  apiUrl?: string;
  dryRun: boolean;
  replace: boolean;
  includeRuns: boolean;
  safety: {
    forcedLoopStatus: "paused";
    clearedLoopRunPointers: true;
    forcedWorkflowStatus: "archived";
    resumesLoops: false;
  };
  counts: {
    source: { workflows: number; loops: number; runs: number };
    remoteBefore: { workflows?: number; loops?: number; runs?: number };
    remoteAfter?: { workflows?: number; loops?: number; runs?: number };
    plan: LoopsMigrationPlanSummary;
    applied?: { workflows: number; loops: number; runs: number };
    skipped?: { runningRuns: number; orphanRuns: number };
    requests?: number;
  };
  missingIds: { workflows: string[]; loops: string[]; runs: string[] };
  existingIds: { workflows: string[]; loops: string[]; runs: string[] };
  unsafe: {
    blocked: LoopsMigrationPlanRow[];
    conflicts: LoopsMigrationPlanRow[];
    unsupported: string[];
    warnings: string[];
  };
  rollback: {
    notes: string[];
    commands: string[];
  };
}

interface ImportCounts {
  workflows: number;
  loops: number;
  runs: number;
}

async function postImportBatch(
  fetchImpl: typeof fetch,
  config: { apiUrl: string; token?: string; timeoutMs?: number },
  payload: { workflows?: unknown[]; loops?: unknown[]; runs?: unknown[]; replace?: boolean; preserveWorkflowActivation?: boolean; preserveLoopScheduling?: boolean },
): Promise<{ imported: ImportCounts; skippedRunning: number }> {
  const body = await requestJson(fetchImpl, config, "/v1/import", { method: "POST", body: JSON.stringify(payload) });
  const imported = (body.imported ?? {}) as Partial<ImportCounts>;
  return {
    imported: { workflows: imported.workflows ?? 0, loops: imported.loops ?? 0, runs: imported.runs ?? 0 },
    skippedRunning: typeof body.skippedRunning === "number" ? body.skippedRunning : 0,
  };
}

/**
 * Apply a local->self-hosted backfill through the control plane's id-preserving
 * `/v1/import` endpoint. Rows are pushed FK-safe (workflows, loops, then runs).
 * Runs are streamed in bounded pages so a busy host's multi-hundred-MB run
 * history never loads into memory at once; volatile `running` runs and orphan
 * runs (whose parent loop is absent) are dropped and counted. Idempotent: the
 * endpoint upserts by id, so re-running never duplicates rows.
 */
export async function applySelfHostedPush(store: Store, opts: SelfHostedPushOptions): Promise<SelfHostedPushResult> {
  const resolved = resolveApiConfig(opts);
  if (!resolved.apiUrl) throw new ValidationError("HASNA_LOOPS_API_URL or --api-url is required for self-hosted push");
  if (!resolved.token) {
    throw new ValidationError("self-hosted APIs require HASNA_LOOPS_API_KEY");
  }
  const config = { apiUrl: resolved.apiUrl, token: resolved.token, timeoutMs: resolved.timeoutMs };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const includeRuns = opts.includeRuns ?? true;
  const replace = opts.replace ?? false;
  const plan = await buildSelfHostedMigrationPlan(store, { ...opts, operation: "self-hosted-push", includeRuns, replace });
  if (plan.summary.blocked > 0 || plan.summary.conflict > 0 || !plan.importable) {
    throw new ValidationError(`self-hosted push is not safe to apply: blocked=${plan.summary.blocked} conflict=${plan.summary.conflict}`);
  }
  const batchRows = Math.max(1, opts.batchRows ?? 200);
  const runBatchBytes = Math.max(64 * 1024, opts.runBatchBytes ?? 4 * 1024 * 1024);

  const applied: ImportCounts = { workflows: 0, loops: 0, runs: 0 };
  const skipped = { runningRuns: 0, orphanRuns: 0 };
  let requests = 0;

  // Definitions only: exportMigrationRows({includeRuns:false}) never loads run
  // output, so workflows+loops stay cheap even on a busy host.
  const base = store.exportMigrationRows({ includeRuns: false });
  const workflows = base.workflows.map(disabledWorkflowForSelfHostedImport);
  const loops = base.loops.map(pausedLoopForSelfHostedImport);
  const loopIds = new Set(base.loops.map((loop) => loop.id));

  for (let i = 0; i < workflows.length; i += batchRows) {
    const batch = workflows.slice(i, i + batchRows);
    const result = await postImportBatch(fetchImpl, config, { workflows: batch, replace, preserveWorkflowActivation: false, preserveLoopScheduling: false });
    applied.workflows += result.imported.workflows;
    requests += 1;
    opts.onProgress?.({ phase: "workflows", sent: applied.workflows, requests });
  }

  for (let i = 0; i < loops.length; i += batchRows) {
    const batch = loops.slice(i, i + batchRows);
    const result = await postImportBatch(fetchImpl, config, { loops: batch, replace, preserveLoopScheduling: false });
    applied.loops += result.imported.loops;
    requests += 1;
    opts.onProgress?.({ phase: "loops", sent: applied.loops, requests });
  }

  if (includeRuns) {
    const pageSize = 500;
    let pending: LoopRun[] = [];
    let pendingBytes = 0;
    const flush = async (): Promise<void> => {
      if (pending.length === 0) return;
      const result = await postImportBatch(fetchImpl, config, { runs: pending, replace, preserveLoopScheduling: false });
      applied.runs += result.imported.runs;
      skipped.runningRuns += result.skippedRunning;
      requests += 1;
      opts.onProgress?.({ phase: "runs", sent: applied.runs, requests });
      pending = [];
      pendingBytes = 0;
    };
    for (let offset = 0; ; offset += pageSize) {
      const page = store.exportMigrationRunPage({ limit: pageSize, offset });
      if (page.length === 0) break;
      for (const run of page) {
        // Skip orphan runs whose parent loop is absent: loop_runs.loop_id has a
        // FK to loops, so importing one would fail the whole batch.
        if (!loopIds.has(run.loopId)) {
          skipped.orphanRuns += 1;
          continue;
        }
        const encoded = JSON.stringify(run).length;
        if (pending.length > 0 && pendingBytes + encoded > runBatchBytes) await flush();
        pending.push(run);
        pendingBytes += encoded;
        if (pending.length >= batchRows * 4) await flush();
      }
      if (page.length < pageSize) break;
    }
    await flush();
  }

  const remoteAfter = await fetchRemotePreview({ ...opts, operation: "self-hosted-push", includeRuns: false });
  const bundle = selfHostedDefinitionBundle(exportLoopsMigrationBundle(store, { includeRuns }));
  const remoteBefore: RemotePreview = plan.manifest
    ? {
        workflows: [],
        loops: [],
        runs: [],
        counts: plan.manifest.counts.remoteBefore,
        unsupported: plan.manifest.unsafe.unsupported,
        warnings: [],
      }
    : await fetchRemotePreview({ ...opts, operation: "self-hosted-push", includeRuns });
  return {
    ok: true,
    apiUrl: config.apiUrl,
    applied,
    skipped,
    requests,
    manifest: buildSelfHostedManifest({
      apiUrl: config.apiUrl,
      dryRun: false,
      replace,
      includeRuns,
      bundle,
      remote: remoteBefore,
      plan,
      applied,
      skipped,
      requests,
      remoteAfter: remoteAfter.counts,
    }),
  };
}

export function publicMigrationBundle(bundle: LoopsMigrationBundle): Record<string, unknown> {
  return {
    ...bundle,
    data: {
      workflows: bundle.data.workflows.map(publicWorkflow),
      loops: bundle.data.loops.map(publicLoop),
      runs: bundle.data.runs.map((run) => publicRun(run, false, { redactError: true })),
    },
  };
}

export function selfHostedControlPlaneSummary(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const config = loopControlPlaneConfig(env);
  return {
    apiUrl: config.apiUrl,
    databaseUrlPresent: config.databaseUrlPresent,
    apiKeyPresent: config.apiKeyPresent,
  };
}
