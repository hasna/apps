import { z, type ZodRawShape } from "zod";
import type { ApiScope } from "../server/auth.js";
import { authorize, hasEntityAccess } from "./authorization.js";
import { EntityAccessDeniedError } from "../types/index.js";
import type { OpContext } from "./config-service.js";
import * as config from "./config-service.js";
import * as rollup from "./rollup-service.js";

export type { OpContext } from "./config-service.js";

// The SINGLE operation registry. CLI, MCP, and /v1 are all GENERATED from it, so
// interface parity is structural: every op declares its surfaces once, and all
// three call the same service function. (§7 — the harness is identical/copied;
// this per-app op table is the generated part.)

export type Profile = "minimal" | "standard" | "full";
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface OpDescriptor {
  op: string;
  summary: string;
  kind: "config" | "fused";
  mutates: boolean;
  method: HttpMethod;
  path: string; // /v1/... with :param segments
  scopes: ApiScope[];
  minProfile: Profile;
  cli: { namespace: string; command: string; positional?: string[] };
  mcpTool: string;
  inputShape: ZodRawShape;
  run: (ctx: OpContext, input: Record<string, unknown>) => unknown;
}

// --- coercion helpers (CLI flags + HTTP query arrive as strings) ---
const numeric = z.coerce.number();
const optNumeric = z.coerce.number().optional();
const jsonObj = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? JSON.parse(v) : v),
  z.record(z.unknown()),
);
const boolish = z.preprocess(
  (v) => (typeof v === "string" ? ["1", "true", "yes", "on"].includes(v.toLowerCase()) : v),
  z.boolean(),
);
const entityId = z.string().uuid();
const idField = z.string().min(1);

export function validateInput(op: OpDescriptor, raw: Record<string, unknown>): Record<string, unknown> {
  return z.object(op.inputShape).parse(raw) as Record<string, unknown>;
}

// --- fused read wrapper: authorize read + entity access before delegating ---
function fused<T>(fn: (ctx: OpContext, input: Record<string, unknown>) => T) {
  return (ctx: OpContext, input: Record<string, unknown>): T => {
    const eid = input["entity_id"] as string | undefined;
    authorize("read", ctx.principal, { resource: "observability" });
    if (eid && !hasEntityAccess(ctx.principal, eid)) throw new EntityAccessDeniedError(eid);
    return fn(ctx, input);
  };
}

function str(input: Record<string, unknown>, key: string): string {
  return input[key] as string;
}
function optStr(input: Record<string, unknown>, key: string): string | undefined {
  return input[key] as string | undefined;
}
function num(input: Record<string, unknown>, key: string, fallback: number): number {
  const v = input[key];
  return typeof v === "number" ? v : fallback;
}

// --- config CRUD factory ---
interface ConfigResourceCfg {
  namespace: string;
  plural: string;
  mcpPrefix: string;
  createShape: ZodRawShape;
  updateShape: ZodRawShape;
  service: {
    create: (ctx: OpContext, input: Record<string, unknown>) => unknown;
    get: (ctx: OpContext, id: string) => unknown;
    list: (ctx: OpContext) => unknown;
    update: (ctx: OpContext, id: string, patch: Record<string, unknown>) => unknown;
    remove: (ctx: OpContext, id: string) => unknown;
  };
}

function configResource(cfg: ConfigResourceCfg): OpDescriptor[] {
  const base = `/v1/${cfg.plural}`;
  return [
    {
      op: `${cfg.namespace}.create`,
      summary: `Create a ${cfg.namespace}`,
      kind: "config",
      mutates: true,
      method: "POST",
      path: base,
      scopes: ["fleet:write"],
      minProfile: cfg.namespace === "saved-view" ? "minimal" : "standard",
      cli: { namespace: cfg.namespace, command: "create" },
      mcpTool: `fleet_${cfg.mcpPrefix}_create`,
      inputShape: cfg.createShape,
      run: (ctx, input) => cfg.service.create(ctx, input),
    },
    {
      op: `${cfg.namespace}.list`,
      summary: `List ${cfg.namespace}s`,
      kind: "config",
      mutates: false,
      method: "GET",
      path: base,
      scopes: ["fleet:read"],
      minProfile: "standard",
      cli: { namespace: cfg.namespace, command: "list" },
      mcpTool: `fleet_${cfg.mcpPrefix}_list`,
      inputShape: {},
      run: (ctx) => cfg.service.list(ctx),
    },
    {
      op: `${cfg.namespace}.get`,
      summary: `Get a ${cfg.namespace} by id`,
      kind: "config",
      mutates: false,
      method: "GET",
      path: `${base}/:id`,
      scopes: ["fleet:read"],
      minProfile: "standard",
      cli: { namespace: cfg.namespace, command: "get", positional: ["id"] },
      mcpTool: `fleet_${cfg.mcpPrefix}_get`,
      inputShape: { id: idField },
      run: (ctx, input) => cfg.service.get(ctx, str(input, "id")),
    },
    {
      op: `${cfg.namespace}.update`,
      summary: `Update a ${cfg.namespace}`,
      kind: "config",
      mutates: true,
      method: "PATCH",
      path: `${base}/:id`,
      scopes: ["fleet:write"],
      minProfile: "standard",
      cli: { namespace: cfg.namespace, command: "update", positional: ["id"] },
      mcpTool: `fleet_${cfg.mcpPrefix}_update`,
      inputShape: { id: idField, ...cfg.updateShape },
      run: (ctx, input) => {
        const { id, ...patch } = input;
        return cfg.service.update(ctx, id as string, patch);
      },
    },
    {
      op: `${cfg.namespace}.delete`,
      summary: `Delete a ${cfg.namespace}`,
      kind: "config",
      mutates: true,
      method: "DELETE",
      path: `${base}/:id`,
      scopes: ["fleet:write"],
      minProfile: "full",
      cli: { namespace: cfg.namespace, command: "delete", positional: ["id"] },
      mcpTool: `fleet_${cfg.mcpPrefix}_delete`,
      inputShape: { id: idField },
      run: (ctx, input) => cfg.service.remove(ctx, str(input, "id")),
    },
  ];
}

const configOps: OpDescriptor[] = [
  ...configResource({
    namespace: "saved-view",
    plural: "saved-views",
    mcpPrefix: "saved_view",
    createShape: {
      entity_id: entityId,
      entity_slug: z.string().optional(),
      name: z.string().min(1),
      kind: z.enum(["dashboard", "trace", "burn", "slo"]),
      spec: jsonObj.optional(),
    },
    updateShape: {
      name: z.string().min(1).optional(),
      kind: z.enum(["dashboard", "trace", "burn", "slo"]).optional(),
      spec: jsonObj.optional(),
      entity_slug: z.string().optional(),
    },
    service: {
      create: (ctx, i) => config.createSavedView(ctx, i as never),
      get: (ctx, id) => config.getSavedView(ctx, id),
      list: (ctx) => config.listSavedViews(ctx),
      update: (ctx, id, patch) => config.updateSavedView(ctx, id, patch as never),
      remove: (ctx, id) => config.deleteSavedView(ctx, id),
    },
  }),
  ...configResource({
    namespace: "slo",
    plural: "slos",
    mcpPrefix: "slo",
    createShape: {
      entity_id: entityId,
      entity_slug: z.string().optional(),
      target_type: z.enum(["agent", "company"]),
      target_ref: z.string().min(1),
      name: z.string().min(1),
      objective: z.enum(["availability", "success_rate", "error_rate", "latency_p95"]),
      target_value: numeric,
      window_days: optNumeric,
    },
    updateShape: {
      name: z.string().min(1).optional(),
      objective: z.enum(["availability", "success_rate", "error_rate", "latency_p95"]).optional(),
      target_value: optNumeric,
      window_days: optNumeric,
      target_ref: z.string().optional(),
      target_type: z.enum(["agent", "company"]).optional(),
      entity_slug: z.string().optional(),
    },
    service: {
      create: (ctx, i) => config.createSlo(ctx, i as never),
      get: (ctx, id) => config.getSlo(ctx, id),
      list: (ctx) => config.listSlos(ctx),
      update: (ctx, id, patch) => config.updateSlo(ctx, id, patch as never),
      remove: (ctx, id) => config.deleteSlo(ctx, id),
    },
  }),
  ...configResource({
    namespace: "error-budget",
    plural: "error-budget-policies",
    mcpPrefix: "error_budget",
    createShape: {
      slo_id: idField,
      entity_id: entityId,
      budget_percent: numeric,
      burn_alert_threshold: optNumeric,
      window_days: optNumeric,
    },
    updateShape: {
      budget_percent: optNumeric,
      burn_alert_threshold: optNumeric,
      window_days: optNumeric,
    },
    service: {
      create: (ctx, i) => config.createErrorBudgetPolicy(ctx, i as never),
      get: (ctx, id) => config.getErrorBudgetPolicy(ctx, id),
      list: (ctx) => config.listErrorBudgetPolicies(ctx),
      update: (ctx, id, patch) => config.updateErrorBudgetPolicy(ctx, id, patch as never),
      remove: (ctx, id) => config.deleteErrorBudgetPolicy(ctx, id),
    },
  }),
  ...configResource({
    namespace: "alert-threshold",
    plural: "alert-thresholds",
    mcpPrefix: "alert_threshold",
    createShape: {
      entity_id: entityId,
      slo_id: z.string().optional(),
      metric: z.string().min(1),
      comparator: z.enum(["gt", "gte", "lt", "lte"]),
      threshold_value: numeric,
      severity: z.enum(["info", "warning", "critical"]).optional(),
      enabled: boolish.optional(),
    },
    updateShape: {
      metric: z.string().optional(),
      comparator: z.enum(["gt", "gte", "lt", "lte"]).optional(),
      threshold_value: optNumeric,
      severity: z.enum(["info", "warning", "critical"]).optional(),
      enabled: boolish.optional(),
      slo_id: z.string().optional(),
    },
    service: {
      create: (ctx, i) => config.createAlertThreshold(ctx, i as never),
      get: (ctx, id) => config.getAlertThreshold(ctx, id),
      list: (ctx) => config.listAlertThresholds(ctx),
      update: (ctx, id, patch) => config.updateAlertThreshold(ctx, id, patch as never),
      remove: (ctx, id) => config.deleteAlertThreshold(ctx, id),
    },
  }),
  ...configResource({
    namespace: "annotation",
    plural: "annotations",
    mcpPrefix: "annotation",
    createShape: {
      entity_id: entityId,
      target_ref: z.string().min(1),
      at: z.string().optional(),
      text: z.string().min(1),
      author: z.string().optional(),
    },
    updateShape: {
      text: z.string().optional(),
      target_ref: z.string().optional(),
      at: z.string().optional(),
    },
    service: {
      create: (ctx, i) => config.createAnnotation(ctx, i as never),
      get: (ctx, id) => config.getAnnotation(ctx, id),
      list: (ctx) => config.listAnnotations(ctx),
      update: (ctx, id, patch) => config.updateAnnotation(ctx, id, patch as never),
      remove: (ctx, id) => config.deleteAnnotation(ctx, id),
    },
  }),
];

// --- fused (read-only) observability ops (GET-only across all surfaces) ---
const fusedOps: OpDescriptor[] = [
  {
    op: "health.agents",
    summary: "Fused per-agent health rollup for an entity",
    kind: "fused",
    mutates: false,
    method: "GET",
    path: "/v1/health/agents",
    scopes: ["fleet:read"],
    minProfile: "minimal",
    cli: { namespace: "health", command: "agents" },
    mcpTool: "fleet_health_agents",
    inputShape: { entity_id: entityId, window_days: optNumeric, target_ref: z.string().optional() },
    run: fused((ctx, i) => rollup.agentHealth(ctx.adapters, str(i, "entity_id"), num(i, "window_days", 30), optStr(i, "target_ref"))),
  },
  {
    op: "health.company",
    summary: "Fused company-level health rollup",
    kind: "fused",
    mutates: false,
    method: "GET",
    path: "/v1/health/company",
    scopes: ["fleet:read"],
    minProfile: "minimal",
    cli: { namespace: "health", command: "company" },
    mcpTool: "fleet_health_company",
    inputShape: { entity_id: entityId, window_days: optNumeric },
    run: fused((ctx, i) => rollup.companyHealth(ctx.adapters, str(i, "entity_id"), num(i, "window_days", 30))),
  },
  {
    op: "token-burn.list",
    summary: "Token burn per agent (from economy)",
    kind: "fused",
    mutates: false,
    method: "GET",
    path: "/v1/token-burn",
    scopes: ["fleet:read"],
    minProfile: "minimal",
    cli: { namespace: "burn", command: "list" },
    mcpTool: "fleet_token_burn",
    inputShape: { entity_id: entityId, window_days: optNumeric, target_ref: z.string().optional() },
    run: fused((ctx, i) => rollup.tokenBurn(ctx.adapters, str(i, "entity_id"), num(i, "window_days", 30), optStr(i, "target_ref"))),
  },
  {
    op: "cost.list",
    summary: "Cost summary per agent (from economy)",
    kind: "fused",
    mutates: false,
    method: "GET",
    path: "/v1/cost",
    scopes: ["fleet:read"],
    minProfile: "minimal",
    cli: { namespace: "cost", command: "list" },
    mcpTool: "fleet_cost",
    inputShape: { entity_id: entityId, window_days: optNumeric, target_ref: z.string().optional() },
    run: fused((ctx, i) => rollup.costSummary(ctx.adapters, str(i, "entity_id"), num(i, "window_days", 30), optStr(i, "target_ref"))),
  },
  {
    op: "traces.list",
    summary: "List traces for an entity (from sessions)",
    kind: "fused",
    mutates: false,
    method: "GET",
    path: "/v1/traces",
    scopes: ["fleet:read"],
    minProfile: "minimal",
    cli: { namespace: "trace", command: "list" },
    mcpTool: "fleet_traces_list",
    inputShape: { entity_id: entityId, target_ref: z.string().optional() },
    run: fused((ctx, i) => rollup.listTraces(ctx.adapters, str(i, "entity_id"), optStr(i, "target_ref"))),
  },
  {
    op: "traces.get",
    summary: "Trace drill-down (spans) for a trace id",
    kind: "fused",
    mutates: false,
    method: "GET",
    path: "/v1/traces/:trace_id",
    scopes: ["fleet:read"],
    minProfile: "minimal",
    cli: { namespace: "trace", command: "get", positional: ["trace_id"] },
    mcpTool: "fleet_traces_get",
    inputShape: { entity_id: entityId, trace_id: idField },
    run: fused((ctx, i) => rollup.getTrace(ctx.adapters, str(i, "entity_id"), str(i, "trace_id"))),
  },
  {
    op: "slo-status.list",
    summary: "Evaluate SLO status + error budgets for an entity",
    kind: "fused",
    mutates: false,
    method: "GET",
    path: "/v1/slo-status",
    scopes: ["fleet:read"],
    minProfile: "minimal",
    cli: { namespace: "slo-status", command: "list" },
    mcpTool: "fleet_slo_status",
    inputShape: { entity_id: entityId },
    run: fused((ctx, i) => rollup.listSloStatus(ctx.db, ctx.adapters, [str(i, "entity_id")])),
  },
  {
    op: "alerts.list",
    summary: "Current SLO/threshold breach alerts for an entity",
    kind: "fused",
    mutates: false,
    method: "GET",
    path: "/v1/alerts",
    scopes: ["fleet:read"],
    minProfile: "minimal",
    cli: { namespace: "alert", command: "list" },
    mcpTool: "fleet_alerts",
    inputShape: { entity_id: entityId },
    run: fused((ctx, i) => rollup.listAlerts(ctx.db, ctx.adapters, [str(i, "entity_id")])),
  },
];

export const REGISTRY: OpDescriptor[] = [...configOps, ...fusedOps];

export function opByCli(namespace: string, command: string): OpDescriptor | undefined {
  return REGISTRY.find((o) => o.cli.namespace === namespace && o.cli.command === command);
}

export function opByMcpTool(tool: string): OpDescriptor | undefined {
  return REGISTRY.find((o) => o.mcpTool === tool);
}

const PROFILE_ORDER: Record<Profile, number> = { minimal: 0, standard: 1, full: 2 };

export function opInProfile(op: OpDescriptor, profile: Profile): boolean {
  return PROFILE_ORDER[op.minProfile] <= PROFILE_ORDER[profile];
}

/** Match an HTTP request to a registry op, extracting path params. */
export function matchHttpRoute(
  method: string,
  pathname: string,
): { op: OpDescriptor; params: Record<string, string> } | null {
  for (const op of REGISTRY) {
    if (op.method !== method.toUpperCase()) continue;
    const params = matchPath(op.path, pathname);
    if (params) return { op, params };
  }
  return null;
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const pSeg = pattern.split("/").filter(Boolean);
  const uSeg = pathname.split("/").filter(Boolean);
  if (pSeg.length !== uSeg.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pSeg.length; i++) {
    const p = pSeg[i]!;
    const u = uSeg[i]!;
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(u);
    else if (p !== u) return null;
  }
  return params;
}
