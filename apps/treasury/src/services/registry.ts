import type { RunContext } from "./context.js";
import type { ApiScope } from "../server/auth.js";
import type { AuthorizationAction } from "./authorization.js";
import { createEntity, getEntity, listEntities } from "./entities.js";
import { consolidatedBalances, listBalances, recordBalance } from "./balances.js";
import { fxExposure, listFxRates, recordFxRate } from "./fx.js";
import { entityRunway, groupRunway, listCostFeeds, recordCostFeed } from "./runway.js";
import { cashForecast } from "./forecast.js";
import { generateSweeps, getSweep, listSweeps, updateSweepStatus } from "./sweeps.js";
import { ingestFromAdapters } from "./ingest.js";
import { buildFixtureAdapters } from "../adapters/fixtures.js";

export type FieldType = "string" | "int" | "number" | "bool";
export type FieldLocation = "path" | "query" | "body";

export interface OpField {
  name: string;
  type: FieldType;
  required?: boolean;
  location: FieldLocation;
  description?: string;
}

export type Profile = "minimal" | "standard" | "full";

export interface OpDef {
  name: string;
  description: string;
  scope: ApiScope;
  action: AuthorizationAction;
  mutating: boolean;
  http: { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string };
  operationId: string;
  cli: string[];
  fields: OpField[];
  profiles: Profile[];
  run(rc: RunContext, input: Record<string, unknown>): Promise<unknown>;
}

const R: Profile[] = ["minimal", "standard", "full"];
const SF: Profile[] = ["standard", "full"];
const F: Profile[] = ["full"];

export const OPS: OpDef[] = [
  {
    name: "list_entities",
    description: "List entities the caller is authorized to see.",
    scope: "treasury:read",
    action: "read",
    mutating: false,
    http: { method: "GET", path: "/v1/entities" },
    operationId: "listEntities",
    cli: ["entities", "list"],
    fields: [],
    profiles: R,
    run: (rc) => listEntities(rc),
  },
  {
    name: "get_entity",
    description: "Get a single entity by entity_id.",
    scope: "treasury:read",
    action: "read",
    mutating: false,
    http: { method: "GET", path: "/v1/entities/:entity_id" },
    operationId: "getEntity",
    cli: ["entities", "get"],
    fields: [{ name: "entity_id", type: "string", required: true, location: "path" }],
    profiles: R,
    run: (rc, i) => getEntity(rc, i as { entity_id: string }),
  },
  {
    name: "create_entity",
    description: "Create (cache) an entity anchor.",
    scope: "treasury:admin",
    action: "admin",
    mutating: true,
    http: { method: "POST", path: "/v1/entities" },
    operationId: "createEntity",
    cli: ["entities", "create"],
    fields: [
      { name: "name", type: "string", required: true, location: "body" },
      { name: "base_currency", type: "string", required: true, location: "body" },
      { name: "entity_slug", type: "string", location: "body" },
    ],
    profiles: R,
    run: (rc, i) => createEntity(rc, i as never),
  },
  {
    name: "list_balances",
    description: "List cached balance snapshots (optionally for one entity).",
    scope: "treasury:read",
    action: "read",
    mutating: false,
    http: { method: "GET", path: "/v1/balances" },
    operationId: "listBalances",
    cli: ["balances", "list"],
    fields: [{ name: "entity_id", type: "string", location: "query" }],
    profiles: R,
    run: (rc, i) => listBalances(rc, i as never),
  },
  {
    name: "record_balance",
    description: "Cache a balance snapshot with provenance.",
    scope: "treasury:write",
    action: "write",
    mutating: true,
    http: { method: "POST", path: "/v1/balances" },
    operationId: "recordBalance",
    cli: ["balances", "record"],
    fields: [
      { name: "entity_id", type: "string", required: true, location: "body" },
      { name: "account_ref", type: "string", required: true, location: "body" },
      { name: "account_kind", type: "string", required: true, location: "body" },
      { name: "currency", type: "string", required: true, location: "body" },
      { name: "amount_minor", type: "int", required: true, location: "body" },
      { name: "source", type: "string", location: "body" },
    ],
    profiles: R,
    run: (rc, i) => recordBalance(rc, i as never),
  },
  {
    name: "consolidated_balances",
    description: "Consolidated balances across visible entities, converted to a base.",
    scope: "treasury:read",
    action: "read",
    mutating: false,
    http: { method: "GET", path: "/v1/balances/consolidated" },
    operationId: "consolidatedBalances",
    cli: ["balances", "consolidated"],
    fields: [{ name: "base", type: "string", location: "query" }],
    profiles: R,
    run: (rc, i) => consolidatedBalances(rc, i as never),
  },
  {
    name: "list_fx_rates",
    description: "List cached FX rates.",
    scope: "treasury:read",
    action: "read",
    mutating: false,
    http: { method: "GET", path: "/v1/fx-rates" },
    operationId: "listFxRates",
    cli: ["fx", "list"],
    fields: [],
    profiles: SF,
    run: (rc) => listFxRates(rc),
  },
  {
    name: "record_fx_rate",
    description: "Cache an FX rate (1 base = rate quote).",
    scope: "treasury:write",
    action: "write",
    mutating: true,
    http: { method: "POST", path: "/v1/fx-rates" },
    operationId: "recordFxRate",
    cli: ["fx", "record"],
    fields: [
      { name: "base_currency", type: "string", required: true, location: "body" },
      { name: "quote_currency", type: "string", required: true, location: "body" },
      { name: "rate", type: "number", required: true, location: "body" },
      { name: "source", type: "string", location: "body" },
    ],
    profiles: SF,
    run: (rc, i) => recordFxRate(rc, i as never),
  },
  {
    name: "fx_exposure",
    description: "FX exposure across visible balances, converted to a base.",
    scope: "treasury:read",
    action: "read",
    mutating: false,
    http: { method: "GET", path: "/v1/exposure" },
    operationId: "fxExposure",
    cli: ["fx", "exposure"],
    fields: [{ name: "base", type: "string", location: "query" }],
    profiles: SF,
    run: (rc, i) => fxExposure(rc, i as never),
  },
  {
    name: "record_cost_feed",
    description: "Record an entity's monthly net cash burn.",
    scope: "treasury:write",
    action: "write",
    mutating: true,
    http: { method: "POST", path: "/v1/cost-feeds" },
    operationId: "recordCostFeed",
    cli: ["cost", "record"],
    fields: [
      { name: "entity_id", type: "string", required: true, location: "body" },
      { name: "currency", type: "string", required: true, location: "body" },
      { name: "monthly_burn_minor", type: "int", required: true, location: "body" },
      { name: "source", type: "string", location: "body" },
    ],
    profiles: SF,
    run: (rc, i) => recordCostFeed(rc, i as never),
  },
  {
    name: "list_cost_feeds",
    description: "List cached cost feeds (optionally for one entity).",
    scope: "treasury:read",
    action: "read",
    mutating: false,
    http: { method: "GET", path: "/v1/cost-feeds" },
    operationId: "listCostFeeds",
    cli: ["cost", "list"],
    fields: [{ name: "entity_id", type: "string", location: "query" }],
    profiles: SF,
    run: (rc, i) => listCostFeeds(rc, i as never),
  },
  {
    name: "entity_runway",
    description: "Runway (months) for a single entity.",
    scope: "treasury:read",
    action: "read",
    mutating: false,
    http: { method: "GET", path: "/v1/runway/:entity_id" },
    operationId: "entityRunway",
    cli: ["runway", "entity"],
    fields: [
      { name: "entity_id", type: "string", required: true, location: "path" },
      { name: "base", type: "string", location: "query" },
    ],
    profiles: R,
    run: (rc, i) => entityRunway(rc, i as never),
  },
  {
    name: "group_runway",
    description: "Consolidated group runway (months).",
    scope: "treasury:read",
    action: "read",
    mutating: false,
    http: { method: "GET", path: "/v1/runway" },
    operationId: "groupRunway",
    cli: ["runway", "group"],
    fields: [{ name: "base", type: "string", location: "query" }],
    profiles: R,
    run: (rc, i) => groupRunway(rc, i as never),
  },
  {
    name: "cash_forecast",
    description: "Short-horizon cash projection (entity or group).",
    scope: "treasury:read",
    action: "read",
    mutating: false,
    http: { method: "GET", path: "/v1/forecast" },
    operationId: "cashForecast",
    cli: ["forecast", "run"],
    fields: [
      { name: "entity_id", type: "string", location: "query" },
      { name: "base", type: "string", location: "query" },
      { name: "horizon_months", type: "int", location: "query" },
    ],
    profiles: SF,
    run: (rc, i) => cashForecast(rc, i as never),
  },
  {
    name: "list_sweeps",
    description: "List sweep / intercompany-funding recommendations.",
    scope: "treasury:read",
    action: "read",
    mutating: false,
    http: { method: "GET", path: "/v1/sweeps" },
    operationId: "listSweeps",
    cli: ["sweeps", "list"],
    fields: [{ name: "status", type: "string", location: "query" }],
    profiles: SF,
    run: (rc, i) => listSweeps(rc, i as never),
  },
  {
    name: "get_sweep",
    description: "Get a single sweep recommendation.",
    scope: "treasury:read",
    action: "read",
    mutating: false,
    http: { method: "GET", path: "/v1/sweeps/:id" },
    operationId: "getSweep",
    cli: ["sweeps", "get"],
    fields: [{ name: "id", type: "string", required: true, location: "path" }],
    profiles: SF,
    run: (rc, i) => getSweep(rc, i as never),
  },
  {
    name: "generate_sweeps",
    description: "Generate intercompany-funding recommendations (advisory only).",
    scope: "treasury:recommend",
    action: "recommend",
    mutating: true,
    http: { method: "POST", path: "/v1/sweeps/generate" },
    operationId: "generateSweeps",
    cli: ["sweeps", "generate"],
    fields: [
      { name: "base", type: "string", location: "body" },
      { name: "min_runway_months", type: "number", location: "body" },
      { name: "healthy_runway_months", type: "number", location: "body" },
    ],
    profiles: F,
    run: (rc, i) => generateSweeps(rc, i as never),
  },
  {
    name: "update_sweep_status",
    description: "Acknowledge or dismiss a sweep recommendation (advisory only).",
    scope: "treasury:recommend",
    action: "recommend",
    mutating: true,
    http: { method: "PATCH", path: "/v1/sweeps/:id" },
    operationId: "updateSweepStatus",
    cli: ["sweeps", "update"],
    fields: [
      { name: "id", type: "string", required: true, location: "path" },
      { name: "status", type: "string", required: true, location: "body" },
    ],
    profiles: F,
    run: (rc, i) => updateSweepStatus(rc, i as never),
  },
  {
    name: "ingest_fixtures",
    description: "Ingest balances/FX/cost from the v0 fixture adapters for two demo entities.",
    scope: "treasury:write",
    action: "write",
    mutating: true,
    http: { method: "POST", path: "/v1/ingest" },
    operationId: "ingestFixtures",
    cli: ["ingest", "fixtures"],
    fields: [
      { name: "us_entity_id", type: "string", required: true, location: "body" },
      { name: "ro_entity_id", type: "string", required: true, location: "body" },
    ],
    profiles: F,
    run: (rc, i) => {
      const input = i as { us_entity_id: string; ro_entity_id: string };
      return ingestFromAdapters(rc, buildFixtureAdapters(input.us_entity_id, input.ro_entity_id));
    },
  },
];

export function opByName(name: string): OpDef | undefined {
  return OPS.find((o) => o.name === name);
}

export function coerceField(field: OpField, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === "") return undefined;
  switch (field.type) {
    case "int": {
      const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
      return Number.isFinite(n) ? n : raw;
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
      return Number.isFinite(n) ? n : raw;
    }
    case "bool":
      return raw === true || raw === "true" || raw === "1";
    default:
      return String(raw);
  }
}
