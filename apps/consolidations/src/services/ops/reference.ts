import { z } from "zod";
import { entitySource } from "../../adapters/entities.js";
import type { Entity, FxRate } from "../../types/index.js";
import { NotFoundError } from "../../types/index.js";
import { flags } from "../cli-args.js";
import { newId } from "../ids.js";
import type { OpDef } from "../op-types.js";
import { filterByEntityAccess, toDomain, writeAudit } from "../ops-common.js";

const rateTypeSchema = z.enum(["closing", "average"]);

export const referenceOps: OpDef[] = [
  {
    op: "entity.list",
    summary: "List cached group entities the caller may access.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({}).strip(),
    http: { method: "GET", pathTemplate: "/v1/entities", toPath: () => "/v1/entities" },
    cli: { path: ["entities", "list"], toArgs: () => [] },
    mcpTool: "list_entities",
    profiles: ["minimal", "standard", "full"],
    mutating: false,
    async handler(ctx) {
      const rows = await ctx.store.list("entities");
      return { entities: filterByEntityAccess(ctx.principal, rows).map((r) => toDomain<Entity>(r)) };
    },
  },
  {
    op: "entity.get",
    summary: "Get a single cached group entity by id.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({ id: z.string().min(1) }).strip(),
    http: { method: "GET", pathTemplate: "/v1/entities/:id", toPath: (i) => `/v1/entities/${i.id}` },
    cli: { path: ["entities", "get"], toArgs: (i) => [String(i.id)] },
    mcpTool: "get_entity",
    profiles: ["standard", "full"],
    mutating: false,
    async handler(ctx, input) {
      const row = await ctx.store.get("entities", String(input.id));
      if (!row) throw new NotFoundError(`Entity ${input.id} not found.`);
      ctx.requireEntity(row.id);
      return toDomain<Entity>(row);
    },
  },
  {
    op: "entity.sync",
    summary: "Refresh the local entity cache from the @hasna/entities adapter.",
    action: "write",
    scope: "consolidations:write",
    input: z.object({}).strip(),
    http: { method: "POST", pathTemplate: "/v1/entities/sync", toPath: () => "/v1/entities/sync" },
    cli: { path: ["entities", "sync"], toArgs: () => [] },
    mcpTool: "sync_entities",
    profiles: ["standard", "full"],
    mutating: true,
    async handler(ctx) {
      const entities = await entitySource().list();
      let synced = 0;
      for (const entity of entities) {
        const data = {
          entity_id: entity.id,
          slug: entity.slug,
          name: entity.name,
          functional_currency: entity.functional_currency,
          country: entity.country,
        };
        const existing = await ctx.store.get("entities", entity.id);
        if (existing) {
          await ctx.store.update("entities", entity.id, data);
        } else {
          await ctx.store.insert("entities", { id: entity.id, entity_id: entity.id, data });
        }
        synced += 1;
      }
      return { synced };
    },
  },
  {
    op: "fx_rate.list",
    summary: "List FX translation rates, optionally filtered by period.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({ period: z.string().optional() }).strip(),
    http: {
      method: "GET",
      pathTemplate: "/v1/fx-rates",
      toPath: () => "/v1/fx-rates",
      queryKeys: ["period"],
    },
    cli: { path: ["fx-rates", "list"], toArgs: (i) => flags(i, ["period"]) },
    mcpTool: "list_fx_rates",
    profiles: ["standard", "full"],
    mutating: false,
    async handler(ctx, input) {
      const rows = await ctx.store.list("fx_rates", input.period ? { period: String(input.period) } : {});
      return { fx_rates: rows.map((r) => toDomain<FxRate>(r)) };
    },
  },
  {
    op: "fx_rate.get",
    summary: "Get a single FX rate by id.",
    action: "read",
    scope: "consolidations:read",
    input: z.object({ id: z.string().min(1) }).strip(),
    http: { method: "GET", pathTemplate: "/v1/fx-rates/:id", toPath: (i) => `/v1/fx-rates/${i.id}` },
    cli: { path: ["fx-rates", "get"], toArgs: (i) => [String(i.id)] },
    mcpTool: "get_fx_rate",
    profiles: ["full"],
    mutating: false,
    async handler(ctx, input) {
      const row = await ctx.store.get("fx_rates", String(input.id));
      if (!row) throw new NotFoundError(`FX rate ${input.id} not found.`);
      return toDomain<FxRate>(row);
    },
  },
  {
    op: "fx_rate.create",
    summary: "Record a period FX rate for currency translation.",
    action: "write",
    scope: "consolidations:write",
    input: z
      .object({
        period: z.string().min(1),
        from_currency: z.string().min(1),
        to_currency: z.string().min(1),
        rate: z.coerce.number().positive(),
        rate_type: rateTypeSchema,
      })
      .strip(),
    http: {
      method: "POST",
      pathTemplate: "/v1/fx-rates",
      toPath: () => "/v1/fx-rates",
      bodyKeys: ["period", "from_currency", "to_currency", "rate", "rate_type"],
    },
    cli: {
      path: ["fx-rates", "create"],
      toArgs: (i) => flags(i, ["period", "from_currency", "to_currency", "rate", "rate_type"]),
    },
    mcpTool: "create_fx_rate",
    profiles: ["standard", "full"],
    mutating: true,
    async handler(ctx, input) {
      const id = newId();
      const data = {
        period: String(input.period),
        from_currency: String(input.from_currency),
        to_currency: String(input.to_currency),
        rate: Number(input.rate),
        rate_type: input.rate_type,
      };
      const row = await ctx.store.insert("fx_rates", { id, period: data.period, data });
      await writeAudit(ctx, "fx_rate.created", null, `${data.from_currency}->${data.to_currency} ${data.rate} (${data.rate_type})`);
      return toDomain<FxRate>(row);
    },
  },
  {
    op: "fx_rate.delete",
    summary: "Delete an FX rate.",
    action: "write",
    scope: "consolidations:write",
    input: z.object({ id: z.string().min(1) }).strip(),
    http: { method: "DELETE", pathTemplate: "/v1/fx-rates/:id", toPath: (i) => `/v1/fx-rates/${i.id}` },
    cli: { path: ["fx-rates", "delete"], toArgs: (i) => [String(i.id)] },
    mcpTool: "delete_fx_rate",
    profiles: ["full"],
    mutating: true,
    async handler(ctx, input) {
      const removed = await ctx.store.remove("fx_rates", String(input.id));
      if (!removed) throw new NotFoundError(`FX rate ${input.id} not found.`);
      return { deleted: true, id: input.id };
    },
  },
];
