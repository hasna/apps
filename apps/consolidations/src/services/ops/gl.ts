import { z } from "zod";
import { glSource } from "../../adapters/accounting.js";
import type { CoaMapping, GlImport } from "../../types/index.js";
import { NotFoundError, ValidationError } from "../../types/index.js";
import { flags } from "../cli-args.js";
import { groupAccount } from "../group-coa.js";
import { newId } from "../ids.js";
import type { OpDef } from "../op-types.js";
import { filterByEntityAccess, toDomain, writeAudit } from "../ops-common.js";

const statementSchema = z.enum(["pl", "bs", "cf"]);

export const glOps: OpDef[] = [
  {
    op: "gl_import.list",
    summary: "List GL/trial-balance imports the caller may access.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({ entity_id: z.string().optional(), period: z.string().optional() }).strip(),
    http: {
      method: "GET",
      pathTemplate: "/v1/gl-imports",
      toPath: () => "/v1/gl-imports",
      queryKeys: ["entity_id", "period"],
    },
    cli: { path: ["gl-imports", "list"], toArgs: (i) => flags(i, ["entity_id", "period"]) },
    mcpTool: "list_gl_imports",
    profiles: ["standard", "full"],
    mutating: false,
    async handler(ctx, input) {
      const filter: { entity_id?: string; period?: string } = {};
      if (input.entity_id) filter.entity_id = String(input.entity_id);
      if (input.period) filter.period = String(input.period);
      const rows = await ctx.store.list("gl_imports", filter);
      return { gl_imports: filterByEntityAccess(ctx.principal, rows).map((r) => toDomain<GlImport>(r)) };
    },
  },
  {
    op: "gl_import.get",
    summary: "Get a single GL import by id.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({ id: z.string().min(1) }).strip(),
    http: { method: "GET", pathTemplate: "/v1/gl-imports/:id", toPath: (i) => `/v1/gl-imports/${i.id}` },
    cli: { path: ["gl-imports", "get"], toArgs: (i) => [String(i.id)] },
    mcpTool: "get_gl_import",
    profiles: ["full"],
    mutating: false,
    async handler(ctx, input) {
      const row = await ctx.store.get("gl_imports", String(input.id));
      if (!row) throw new NotFoundError(`GL import ${input.id} not found.`);
      if (row.entity_id) ctx.requireEntity(row.entity_id);
      return toDomain<GlImport>(row);
    },
  },
  {
    op: "gl_import.create",
    summary: "Pull an entity's trial balance for a period via the accounting adapter.",
    action: "write",
    scope: "consolidations:write",
    input: z.object({ entity_id: z.string().min(1), period: z.string().min(1) }).strip(),
    http: {
      method: "POST",
      pathTemplate: "/v1/gl-imports",
      toPath: () => "/v1/gl-imports",
      bodyKeys: ["entity_id", "period"],
    },
    cli: { path: ["gl-imports", "create"], toArgs: (i) => flags(i, ["entity_id", "period"]) },
    mcpTool: "import_gl",
    profiles: ["minimal", "standard", "full"],
    mutating: true,
    async handler(ctx, input) {
      const entityId = String(input.entity_id);
      const period = String(input.period);
      ctx.requireEntity(entityId);
      const { source, provenance } = glSource();
      const tb = await source.fetchTrialBalance(entityId, period);
      if (!tb) throw new NotFoundError(`No trial balance for entity ${entityId} in ${period}.`);
      const id = newId();
      const data = {
        entity_id: entityId,
        period,
        source: provenance,
        currency: tb.currency,
        status: "imported" as const,
        lines: tb.lines,
        imported_at: new Date().toISOString(),
      };
      const row = await ctx.store.insert("gl_imports", { id, entity_id: entityId, period, data });
      await writeAudit(ctx, "gl_import.created", entityId, `Imported ${tb.lines.length} lines (${tb.currency}) for ${period}`);
      return toDomain<GlImport>(row);
    },
  },
  {
    op: "gl_import.delete",
    summary: "Delete a GL import.",
    action: "write",
    scope: "consolidations:write",
    input: z.object({ id: z.string().min(1) }).strip(),
    http: { method: "DELETE", pathTemplate: "/v1/gl-imports/:id", toPath: (i) => `/v1/gl-imports/${i.id}` },
    cli: { path: ["gl-imports", "delete"], toArgs: (i) => [String(i.id)] },
    mcpTool: "delete_gl_import",
    profiles: ["full"],
    mutating: true,
    async handler(ctx, input) {
      const row = await ctx.store.get("gl_imports", String(input.id));
      if (!row) throw new NotFoundError(`GL import ${input.id} not found.`);
      if (row.entity_id) ctx.requireEntity(row.entity_id);
      await ctx.store.remove("gl_imports", String(input.id));
      return { deleted: true, id: input.id };
    },
  },
  {
    op: "coa_mapping.list",
    summary: "List chart-of-accounts mappings the caller may access.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({ entity_id: z.string().optional() }).strip(),
    http: {
      method: "GET",
      pathTemplate: "/v1/coa-mappings",
      toPath: () => "/v1/coa-mappings",
      queryKeys: ["entity_id"],
    },
    cli: { path: ["coa-mappings", "list"], toArgs: (i) => flags(i, ["entity_id"]) },
    mcpTool: "list_coa_mappings",
    profiles: ["standard", "full"],
    mutating: false,
    async handler(ctx, input) {
      const rows = await ctx.store.list("coa_mappings", input.entity_id ? { entity_id: String(input.entity_id) } : {});
      return { coa_mappings: filterByEntityAccess(ctx.principal, rows).map((r) => toDomain<CoaMapping>(r)) };
    },
  },
  {
    op: "coa_mapping.get",
    summary: "Get a single COA mapping by id.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({ id: z.string().min(1) }).strip(),
    http: { method: "GET", pathTemplate: "/v1/coa-mappings/:id", toPath: (i) => `/v1/coa-mappings/${i.id}` },
    cli: { path: ["coa-mappings", "get"], toArgs: (i) => [String(i.id)] },
    mcpTool: "get_coa_mapping",
    profiles: ["full"],
    mutating: false,
    async handler(ctx, input) {
      const row = await ctx.store.get("coa_mappings", String(input.id));
      if (!row) throw new NotFoundError(`COA mapping ${input.id} not found.`);
      if (row.entity_id) ctx.requireEntity(row.entity_id);
      return toDomain<CoaMapping>(row);
    },
  },
  {
    op: "coa_mapping.create",
    summary: "Map an entity's local account code onto the group chart-of-accounts.",
    action: "write",
    scope: "consolidations:write",
    input: z
      .object({
        entity_id: z.string().min(1),
        local_account_code: z.string().min(1),
        group_account_code: z.string().min(1),
        group_account_name: z.string().optional(),
        statement: statementSchema.optional(),
        section: z.string().optional(),
      })
      .strip(),
    http: {
      method: "POST",
      pathTemplate: "/v1/coa-mappings",
      toPath: () => "/v1/coa-mappings",
      bodyKeys: ["entity_id", "local_account_code", "group_account_code", "group_account_name", "statement", "section"],
    },
    cli: {
      path: ["coa-mappings", "create"],
      toArgs: (i) => flags(i, ["entity_id", "local_account_code", "group_account_code", "group_account_name", "statement", "section"]),
    },
    mcpTool: "create_coa_mapping",
    profiles: ["standard", "full"],
    mutating: true,
    async handler(ctx, input) {
      const entityId = String(input.entity_id);
      ctx.requireEntity(entityId);
      const groupCode = String(input.group_account_code);
      const ga = groupAccount(groupCode);
      const name = (input.group_account_name as string | undefined) ?? ga?.name;
      const statement = (input.statement as "pl" | "bs" | "cf" | undefined) ?? ga?.statement;
      const section = (input.section as string | undefined) ?? ga?.section;
      if (!name || !statement || !section) {
        throw new ValidationError(
          `Unknown group account '${groupCode}'; supply group_account_name, statement and section explicitly.`,
        );
      }
      const id = newId();
      const data = {
        entity_id: entityId,
        local_account_code: String(input.local_account_code),
        group_account_code: groupCode,
        group_account_name: name,
        statement,
        section,
      };
      const row = await ctx.store.insert("coa_mappings", { id, entity_id: entityId, data });
      return toDomain<CoaMapping>(row);
    },
  },
  {
    op: "coa_mapping.delete",
    summary: "Delete a COA mapping.",
    action: "write",
    scope: "consolidations:write",
    input: z.object({ id: z.string().min(1) }).strip(),
    http: { method: "DELETE", pathTemplate: "/v1/coa-mappings/:id", toPath: (i) => `/v1/coa-mappings/${i.id}` },
    cli: { path: ["coa-mappings", "delete"], toArgs: (i) => [String(i.id)] },
    mcpTool: "delete_coa_mapping",
    profiles: ["full"],
    mutating: true,
    async handler(ctx, input) {
      const row = await ctx.store.get("coa_mappings", String(input.id));
      if (!row) throw new NotFoundError(`COA mapping ${input.id} not found.`);
      if (row.entity_id) ctx.requireEntity(row.entity_id);
      await ctx.store.remove("coa_mappings", String(input.id));
      return { deleted: true, id: input.id };
    },
  },
];
