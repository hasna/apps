import { z } from "zod";
import type { TrialBalance } from "../../adapters/accounting.js";
import type { CoaMapping, Elimination, GlImport, Run, Statement } from "../../types/index.js";
import { InvalidRunStateError, NotFoundError, ValidationError } from "../../types/index.js";
import { flags } from "../cli-args.js";
import { consolidate } from "../consolidate.js";
import { newId } from "../ids.js";
import type { OpContext, OpDef } from "../op-types.js";
import { canAccessElimination, requireEliminationAccess, toDomain, writeAudit } from "../ops-common.js";

const kindSchema = z.enum(["intercompany_balance", "intercompany_revenue", "investment"]);

async function loadRun(ctx: OpContext, id: string): Promise<{ row: import("../../db/store.js").Row; run: Run }> {
  const row = await ctx.store.get("runs", id);
  if (!row) throw new NotFoundError(`Run ${id} not found.`);
  return { row, run: toDomain<Run>(row) };
}

async function computeRun(ctx: OpContext, id: string): Promise<unknown> {
  const { run } = await loadRun(ctx, id);
  ctx.requireAllEntities(run.entity_ids);
  if (run.status === "finalized") throw new InvalidRunStateError(`Run ${id} is finalized and immutable.`);

  const trialBalances: TrialBalance[] = [];
  for (const entityId of run.entity_ids) {
    const imports = await ctx.store.list("gl_imports", { entity_id: entityId, period: run.period });
    const latest = imports.at(-1);
    if (!latest) throw new ValidationError(`No GL import for entity ${entityId} in ${run.period}. Import it first.`);
    const gl = toDomain<GlImport>(latest);
    trialBalances.push({ entity_id: entityId, period: run.period, currency: gl.currency, lines: gl.lines });
  }

  const allMappings = (await ctx.store.list("coa_mappings"))
    .map((r) => toDomain<CoaMapping>(r))
    .filter((m) => run.entity_ids.includes(m.entity_id));
  const rates = (await ctx.store.list("fx_rates", { period: run.period })).map((r) => toDomain<import("../../types/index.js").FxRate>(r));

  const result = consolidate({
    period: run.period,
    reporting_currency: run.reporting_currency,
    trialBalances,
    mappings: allMappings,
    rates,
  });

  // Idempotent recompute: clear prior outputs for this run.
  for (const s of await ctx.store.list("statements", { run_id: id })) await ctx.store.remove("statements", s.id);
  for (const e of await ctx.store.list("eliminations", { run_id: id })) await ctx.store.remove("eliminations", e.id);

  const statements: Statement[] = [];
  for (const s of result.statements) {
    const sid = newId();
    const data = { run_id: id, statement_type: s.statement_type, currency: s.currency, lines: s.lines, total: s.total };
    const stored = await ctx.store.insert("statements", { id: sid, run_id: id, period: run.period, data });
    statements.push(toDomain<Statement>(stored));
  }
  const eliminations: Elimination[] = [];
  for (const e of result.eliminations) {
    const eid = newId();
    const data = { run_id: id, ...e };
    const stored = await ctx.store.insert("eliminations", { id: eid, run_id: id, period: run.period, data });
    eliminations.push(toDomain<Elimination>(stored));
  }

  const updated = { ...runData(run), status: "computed", computed_at: new Date().toISOString() };
  const runRow = await ctx.store.update("runs", id, updated);
  await writeAudit(ctx, "run.computed", null, `Computed run ${id} (${run.period}); net_income=${result.net_income}, cta=${result.translation_adjustment}`);
  return {
    run: toDomain<Run>(runRow),
    statements,
    eliminations,
    net_income: result.net_income,
    translation_adjustment: result.translation_adjustment,
  };
}

function runData(run: Run): Record<string, unknown> {
  return {
    period: run.period,
    reporting_currency: run.reporting_currency,
    entity_ids: run.entity_ids,
    status: run.status,
    computed_at: run.computed_at,
    finalized_at: run.finalized_at,
  };
}

export const runOps: OpDef[] = [
  {
    op: "run.list",
    summary: "List consolidation runs the caller may access.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({ period: z.string().optional() }).strip(),
    http: { method: "GET", pathTemplate: "/v1/runs", toPath: () => "/v1/runs", queryKeys: ["period"] },
    cli: { path: ["runs", "list"], toArgs: (i) => flags(i, ["period"]) },
    mcpTool: "list_runs",
    profiles: ["minimal", "standard", "full"],
    mutating: false,
    async handler(ctx, input) {
      const rows = await ctx.store.list("runs", input.period ? { period: String(input.period) } : {});
      const runs = rows
        .map((r) => toDomain<Run>(r))
        .filter((run) => ctx.principal.bypass || run.entity_ids.every((e) => (ctx.principal.entity_ids ?? []).includes(e)));
      return { runs };
    },
  },
  {
    op: "run.get",
    summary: "Get a single consolidation run by id.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({ id: z.string().min(1) }).strip(),
    http: { method: "GET", pathTemplate: "/v1/runs/:id", toPath: (i) => `/v1/runs/${i.id}` },
    cli: { path: ["runs", "get"], toArgs: (i) => [String(i.id)] },
    mcpTool: "get_run",
    profiles: ["standard", "full"],
    mutating: false,
    async handler(ctx, input) {
      const { run } = await loadRun(ctx, String(input.id));
      ctx.requireAllEntities(run.entity_ids);
      return run;
    },
  },
  {
    op: "run.create",
    summary: "Create a draft consolidation run for a period over a set of entities.",
    action: "write",
    scope: "consolidations:write",
    input: z
      .object({
        period: z.string().min(1),
        reporting_currency: z.string().min(1),
        entity_ids: z.union([z.array(z.string().min(1)).min(1), z.string().min(1)]),
      })
      .strip(),
    http: {
      method: "POST",
      pathTemplate: "/v1/runs",
      toPath: () => "/v1/runs",
      bodyKeys: ["period", "reporting_currency", "entity_ids"],
    },
    cli: { path: ["runs", "create"], toArgs: (i) => flags(i, ["period", "reporting_currency", "entity_ids"]) },
    mcpTool: "create_run",
    profiles: ["minimal", "standard", "full"],
    mutating: true,
    async handler(ctx, input) {
      const entityIds = Array.isArray(input.entity_ids)
        ? (input.entity_ids as string[])
        : String(input.entity_ids).split(",").map((s) => s.trim()).filter(Boolean);
      ctx.requireAllEntities(entityIds);
      const id = newId();
      const data = {
        period: String(input.period),
        reporting_currency: String(input.reporting_currency),
        entity_ids: entityIds,
        status: "draft" as const,
        computed_at: null,
        finalized_at: null,
      };
      const row = await ctx.store.insert("runs", { id, period: data.period, data });
      await writeAudit(ctx, "run.created", null, `Created run ${id} (${data.period}) over ${entityIds.length} entities`);
      return toDomain<Run>(row);
    },
  },
  {
    op: "run.compute",
    summary: "Compute a run: normalize COA, translate FX, net eliminations, produce statements.",
    action: "run",
    scope: "consolidations:run",
    input: z.object({ id: z.string().min(1) }).strip(),
    http: { method: "POST", pathTemplate: "/v1/runs/:id/compute", toPath: (i) => `/v1/runs/${i.id}/compute` },
    cli: { path: ["runs", "compute"], toArgs: (i) => [String(i.id)] },
    mcpTool: "compute_run",
    profiles: ["minimal", "standard", "full"],
    mutating: true,
    async handler(ctx, input) {
      return computeRun(ctx, String(input.id));
    },
  },
  {
    op: "run.finalize",
    summary: "Finalize a computed run, making its statements immutable.",
    action: "finalize",
    scope: "consolidations:finalize",
    input: z.object({ id: z.string().min(1) }).strip(),
    http: { method: "POST", pathTemplate: "/v1/runs/:id/finalize", toPath: (i) => `/v1/runs/${i.id}/finalize` },
    cli: { path: ["runs", "finalize"], toArgs: (i) => [String(i.id)] },
    mcpTool: "finalize_run",
    profiles: ["standard", "full"],
    mutating: true,
    async handler(ctx, input) {
      const { run } = await loadRun(ctx, String(input.id));
      ctx.requireAllEntities(run.entity_ids);
      if (run.status !== "computed") {
        throw new InvalidRunStateError(`Run must be 'computed' before finalize (is '${run.status}').`);
      }
      const updated = { ...runData(run), status: "finalized", finalized_at: new Date().toISOString() };
      const row = await ctx.store.update("runs", String(input.id), updated);
      await writeAudit(ctx, "run.finalized", null, `Finalized run ${input.id}`);
      return toDomain<Run>(row);
    },
  },
  {
    op: "statement.list",
    summary: "List consolidated statements for a run.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({ run_id: z.string().min(1) }).strip(),
    http: { method: "GET", pathTemplate: "/v1/statements", toPath: () => "/v1/statements", queryKeys: ["run_id"] },
    cli: { path: ["statements", "list"], toArgs: (i) => flags(i, ["run_id"]) },
    mcpTool: "list_statements",
    profiles: ["minimal", "standard", "full"],
    mutating: false,
    async handler(ctx, input) {
      const { run } = await loadRun(ctx, String(input.run_id));
      ctx.requireAllEntities(run.entity_ids);
      const rows = await ctx.store.list("statements", { run_id: String(input.run_id) });
      return { statements: rows.map((r) => toDomain<Statement>(r)) };
    },
  },
  {
    op: "statement.get",
    summary: "Get a single consolidated statement by id.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({ id: z.string().min(1) }).strip(),
    http: { method: "GET", pathTemplate: "/v1/statements/:id", toPath: (i) => `/v1/statements/${i.id}` },
    cli: { path: ["statements", "get"], toArgs: (i) => [String(i.id)] },
    mcpTool: "get_statement",
    profiles: ["full"],
    mutating: false,
    async handler(ctx, input) {
      const row = await ctx.store.get("statements", String(input.id));
      if (!row) throw new NotFoundError(`Statement ${input.id} not found.`);
      if (row.run_id) {
        const { run } = await loadRun(ctx, row.run_id);
        ctx.requireAllEntities(run.entity_ids);
      }
      return toDomain<Statement>(row);
    },
  },
  {
    op: "elimination.list",
    summary: "List intercompany elimination entries.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({ run_id: z.string().optional(), period: z.string().optional() }).strip(),
    http: {
      method: "GET",
      pathTemplate: "/v1/eliminations",
      toPath: () => "/v1/eliminations",
      queryKeys: ["run_id", "period"],
    },
    cli: { path: ["eliminations", "list"], toArgs: (i) => flags(i, ["run_id", "period"]) },
    mcpTool: "list_eliminations",
    profiles: ["standard", "full"],
    mutating: false,
    async handler(ctx, input) {
      const filter: { run_id?: string; period?: string } = {};
      if (input.run_id) filter.run_id = String(input.run_id);
      if (input.period) filter.period = String(input.period);
      const rows = await ctx.store.list("eliminations", filter);
      // Eliminations are authorized against their real entities, never their
      // NULL top-level column (§1c: an id is not authorization). Computed rows
      // store the synthetic "group"/"group" sentinel and MUST be gated behind
      // access to their run's FULL entity group; a row that resolves to no
      // authorizable entity is denied by default (never treated as public).
      const domain = rows.map((r) => toDomain<Elimination>(r));
      const allowed = await Promise.all(domain.map((e) => canAccessElimination(ctx, e)));
      const eliminations = domain.filter((_, i) => allowed[i]);
      return { eliminations };
    },
  },
  {
    op: "elimination.get",
    summary: "Get a single elimination entry by id.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({ id: z.string().min(1) }).strip(),
    http: { method: "GET", pathTemplate: "/v1/eliminations/:id", toPath: (i) => `/v1/eliminations/${i.id}` },
    cli: { path: ["eliminations", "get"], toArgs: (i) => [String(i.id)] },
    mcpTool: "get_elimination",
    profiles: ["full"],
    mutating: false,
    async handler(ctx, input) {
      const row = await ctx.store.get("eliminations", String(input.id));
      if (!row) throw new NotFoundError(`Elimination ${input.id} not found.`);
      const elimination = toDomain<Elimination>(row);
      // Authorize against the elimination's real entities, or — for computed
      // group/group rows — the FULL entity group of its run. Knowing the id is
      // not authorization (§1c); a row with no authorizable entity is denied.
      await requireEliminationAccess(ctx, elimination);
      return elimination;
    },
  },
  {
    op: "elimination.create",
    summary: "Record a manual intercompany elimination entry.",
    action: "write",
    scope: "consolidations:write",
    input: z
      .object({
        period: z.string().min(1),
        entity_id_from: z.string().min(1),
        entity_id_to: z.string().min(1),
        group_account_code: z.string().min(1),
        amount: z.coerce.number(),
        currency: z.string().min(1),
        kind: kindSchema,
        description: z.string().optional(),
        run_id: z.string().optional(),
      })
      .strip(),
    http: {
      method: "POST",
      pathTemplate: "/v1/eliminations",
      toPath: () => "/v1/eliminations",
      bodyKeys: ["period", "entity_id_from", "entity_id_to", "group_account_code", "amount", "currency", "kind", "description", "run_id"],
    },
    cli: {
      path: ["eliminations", "create"],
      toArgs: (i) => flags(i, ["period", "entity_id_from", "entity_id_to", "group_account_code", "amount", "currency", "kind", "description", "run_id"]),
    },
    mcpTool: "create_elimination",
    profiles: ["standard", "full"],
    mutating: true,
    async handler(ctx, input) {
      const from = String(input.entity_id_from);
      const to = String(input.entity_id_to);
      const realEntities = [from, to].filter((e) => e !== "group");
      if (realEntities.length > 0) ctx.requireAllEntities(realEntities);
      const id = newId();
      const data = {
        run_id: (input.run_id as string | undefined) ?? null,
        period: String(input.period),
        entity_id_from: from,
        entity_id_to: to,
        group_account_code: String(input.group_account_code),
        amount: Number(input.amount),
        currency: String(input.currency),
        kind: input.kind,
        description: (input.description as string | undefined) ?? "",
        matched: false,
      };
      const insert: { id: string; period: string; data: Record<string, unknown>; run_id?: string } = {
        id,
        period: data.period,
        data,
      };
      if (data.run_id) insert.run_id = data.run_id;
      const row = await ctx.store.insert("eliminations", insert);
      await writeAudit(ctx, "elimination.created", from === "group" ? null : from, `Manual elimination ${data.group_account_code} ${data.amount} ${data.currency}`);
      return toDomain<Elimination>(row);
    },
  },
];
