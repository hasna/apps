import type { ApiScope } from "../server/auth.js";
import type { ServiceContext } from "./runtime.js";
import { createAsset, deleteAssetService, getAssetById, listAssetsService, updateAssetService } from "./assets.js";
import {
  createRegistration,
  deleteRegistrationService,
  getRegistrationById,
  listRegistrationsService,
  updateRegistrationService,
} from "./registrations.js";
import {
  createRenewal,
  deleteRenewalService,
  getRenewalById,
  listRenewalsService,
  updateRenewalService,
  upcomingRenewals,
} from "./renewals.js";
import { createClass, deleteClassService, getClassById, listClassesService } from "./classes.js";
import { createDocument, deleteDocumentService, getDocumentById, listDocumentsService } from "./documents.js";
import { getEntityRef, listEntityRefs, seedEntity } from "./entities.js";

// Single op registry driving interface parity. Every op is invoked identically
// from CLI, MCP, and /v1 via `invokeOp`, so the three surfaces cannot diverge.
// The interface-parity test generates its table from OP_REGISTRY.

export type OpInput = Record<string, unknown>;
export type OpHandler = (ctx: ServiceContext, input: OpInput) => unknown;

export interface OpDef {
  op: string;
  resource: string;
  scope: ApiScope;
  mutates: boolean;
  /** REST binding. */
  api: { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string };
  /** MCP domain tool name. */
  mcpTool: string;
  /** CLI namespace + command. */
  cli: [string, string];
  /** Profiles that include this op's MCP tool. */
  profiles: Array<"minimal" | "standard" | "full">;
  handler: OpHandler;
}

const str = (v: unknown): string => (typeof v === "string" ? v : String(v));

export const OP_REGISTRY: OpDef[] = [
  // entities
  {
    op: "entity.seed",
    resource: "entity",
    scope: "holdings:admin",
    mutates: true,
    api: { method: "POST", path: "/v1/entities" },
    mcpTool: "seed_entity",
    cli: ["entity", "seed"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => seedEntity(ctx, input as never),
  },
  {
    op: "entity.get",
    resource: "entity",
    scope: "holdings:read",
    mutates: false,
    api: { method: "GET", path: "/v1/entities/:id" },
    mcpTool: "get_entity",
    cli: ["entity", "get"],
    profiles: ["minimal", "standard", "full"],
    handler: (ctx, input) => getEntityRef(ctx, str(input.id)),
  },
  {
    op: "entity.list",
    resource: "entity",
    scope: "holdings:read",
    mutates: false,
    api: { method: "GET", path: "/v1/entities" },
    mcpTool: "list_entities",
    cli: ["entity", "list"],
    profiles: ["minimal", "standard", "full"],
    handler: (ctx) => listEntityRefs(ctx),
  },
  // assets
  {
    op: "asset.create",
    resource: "asset",
    scope: "holdings:write",
    mutates: true,
    api: { method: "POST", path: "/v1/assets" },
    mcpTool: "create_asset",
    cli: ["asset", "create"],
    profiles: ["minimal", "standard", "full"],
    handler: (ctx, input) => createAsset(ctx, input as never),
  },
  {
    op: "asset.get",
    resource: "asset",
    scope: "holdings:read",
    mutates: false,
    api: { method: "GET", path: "/v1/assets/:id" },
    mcpTool: "get_asset",
    cli: ["asset", "get"],
    profiles: ["minimal", "standard", "full"],
    handler: (ctx, input) => getAssetById(ctx, str(input.id)),
  },
  {
    op: "asset.list",
    resource: "asset",
    scope: "holdings:read",
    mutates: false,
    api: { method: "GET", path: "/v1/assets" },
    mcpTool: "list_assets",
    cli: ["asset", "list"],
    profiles: ["minimal", "standard", "full"],
    handler: (ctx, input) => listAssetsService(ctx, input as never),
  },
  {
    op: "asset.update",
    resource: "asset",
    scope: "holdings:write",
    mutates: true,
    api: { method: "PATCH", path: "/v1/assets/:id" },
    mcpTool: "update_asset",
    cli: ["asset", "update"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => updateAssetService(ctx, input as never),
  },
  {
    op: "asset.delete",
    resource: "asset",
    scope: "holdings:write",
    mutates: true,
    api: { method: "DELETE", path: "/v1/assets/:id" },
    mcpTool: "delete_asset",
    cli: ["asset", "delete"],
    profiles: ["full"],
    handler: (ctx, input) => deleteAssetService(ctx, str(input.id)),
  },
  // registrations
  {
    op: "registration.create",
    resource: "registration",
    scope: "holdings:register",
    mutates: true,
    api: { method: "POST", path: "/v1/registrations" },
    mcpTool: "create_registration",
    cli: ["registration", "create"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => createRegistration(ctx, input as never),
  },
  {
    op: "registration.get",
    resource: "registration",
    scope: "holdings:read",
    mutates: false,
    api: { method: "GET", path: "/v1/registrations/:id" },
    mcpTool: "get_registration",
    cli: ["registration", "get"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => getRegistrationById(ctx, str(input.id)),
  },
  {
    op: "registration.list",
    resource: "registration",
    scope: "holdings:read",
    mutates: false,
    api: { method: "GET", path: "/v1/registrations" },
    mcpTool: "list_registrations",
    cli: ["registration", "list"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => listRegistrationsService(ctx, input as never),
  },
  {
    op: "registration.update",
    resource: "registration",
    scope: "holdings:register",
    mutates: true,
    api: { method: "PATCH", path: "/v1/registrations/:id" },
    mcpTool: "update_registration",
    cli: ["registration", "update"],
    profiles: ["full"],
    handler: (ctx, input) => updateRegistrationService(ctx, input as never),
  },
  {
    op: "registration.delete",
    resource: "registration",
    scope: "holdings:register",
    mutates: true,
    api: { method: "DELETE", path: "/v1/registrations/:id" },
    mcpTool: "delete_registration",
    cli: ["registration", "delete"],
    profiles: ["full"],
    handler: (ctx, input) => deleteRegistrationService(ctx, str(input.id)),
  },
  // renewals
  {
    op: "renewal.create",
    resource: "renewal",
    scope: "holdings:renew",
    mutates: true,
    api: { method: "POST", path: "/v1/renewals" },
    mcpTool: "create_renewal",
    cli: ["renewal", "create"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => createRenewal(ctx, input as never),
  },
  {
    op: "renewal.get",
    resource: "renewal",
    scope: "holdings:read",
    mutates: false,
    api: { method: "GET", path: "/v1/renewals/:id" },
    mcpTool: "get_renewal",
    cli: ["renewal", "get"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => getRenewalById(ctx, str(input.id)),
  },
  {
    op: "renewal.list",
    resource: "renewal",
    scope: "holdings:read",
    mutates: false,
    api: { method: "GET", path: "/v1/renewals" },
    mcpTool: "list_renewals",
    cli: ["renewal", "list"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => listRenewalsService(ctx, input as never),
  },
  {
    op: "renewal.upcoming",
    resource: "renewal",
    scope: "holdings:read",
    mutates: false,
    api: { method: "GET", path: "/v1/renewals/upcoming" },
    mcpTool: "upcoming_renewals",
    cli: ["renewal", "upcoming"],
    profiles: ["minimal", "standard", "full"],
    handler: (ctx, input) => upcomingRenewals(ctx, input as never),
  },
  {
    op: "renewal.update",
    resource: "renewal",
    scope: "holdings:renew",
    mutates: true,
    api: { method: "PATCH", path: "/v1/renewals/:id" },
    mcpTool: "update_renewal",
    cli: ["renewal", "update"],
    profiles: ["full"],
    handler: (ctx, input) => updateRenewalService(ctx, input as never),
  },
  {
    op: "renewal.delete",
    resource: "renewal",
    scope: "holdings:renew",
    mutates: true,
    api: { method: "DELETE", path: "/v1/renewals/:id" },
    mcpTool: "delete_renewal",
    cli: ["renewal", "delete"],
    profiles: ["full"],
    handler: (ctx, input) => deleteRenewalService(ctx, str(input.id)),
  },
  // classes
  {
    op: "class.create",
    resource: "class",
    scope: "holdings:write",
    mutates: true,
    api: { method: "POST", path: "/v1/classes" },
    mcpTool: "create_class",
    cli: ["class", "create"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => createClass(ctx, input as never),
  },
  {
    op: "class.get",
    resource: "class",
    scope: "holdings:read",
    mutates: false,
    api: { method: "GET", path: "/v1/classes/:id" },
    mcpTool: "get_class",
    cli: ["class", "get"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => getClassById(ctx, str(input.id)),
  },
  {
    op: "class.list",
    resource: "class",
    scope: "holdings:read",
    mutates: false,
    api: { method: "GET", path: "/v1/classes" },
    mcpTool: "list_classes",
    cli: ["class", "list"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => listClassesService(ctx, input as never),
  },
  {
    op: "class.delete",
    resource: "class",
    scope: "holdings:write",
    mutates: true,
    api: { method: "DELETE", path: "/v1/classes/:id" },
    mcpTool: "delete_class",
    cli: ["class", "delete"],
    profiles: ["full"],
    handler: (ctx, input) => deleteClassService(ctx, str(input.id)),
  },
  // documents
  {
    op: "document.create",
    resource: "document",
    scope: "holdings:write",
    mutates: true,
    api: { method: "POST", path: "/v1/documents" },
    mcpTool: "create_document",
    cli: ["document", "create"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => createDocument(ctx, input as never),
  },
  {
    op: "document.get",
    resource: "document",
    scope: "holdings:read",
    mutates: false,
    api: { method: "GET", path: "/v1/documents/:id" },
    mcpTool: "get_document",
    cli: ["document", "get"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => getDocumentById(ctx, str(input.id)),
  },
  {
    op: "document.list",
    resource: "document",
    scope: "holdings:read",
    mutates: false,
    api: { method: "GET", path: "/v1/documents" },
    mcpTool: "list_documents",
    cli: ["document", "list"],
    profiles: ["standard", "full"],
    handler: (ctx, input) => listDocumentsService(ctx, input as never),
  },
  {
    op: "document.delete",
    resource: "document",
    scope: "holdings:write",
    mutates: true,
    api: { method: "DELETE", path: "/v1/documents/:id" },
    mcpTool: "delete_document",
    cli: ["document", "delete"],
    profiles: ["full"],
    handler: (ctx, input) => deleteDocumentService(ctx, str(input.id)),
  },
];

const BY_OP = new Map(OP_REGISTRY.map((def) => [def.op, def]));
const BY_TOOL = new Map(OP_REGISTRY.map((def) => [def.mcpTool, def]));

export function getOp(op: string): OpDef | undefined {
  return BY_OP.get(op);
}

export function getOpByTool(tool: string): OpDef | undefined {
  return BY_TOOL.get(tool);
}

/** Invoke an op through the shared service layer. The single dispatch used by all surfaces. */
export function invokeOp(ctx: ServiceContext, op: string, input: OpInput = {}): unknown {
  const def = BY_OP.get(op);
  if (!def) throw new Error(`Unknown op: ${op}`);
  return def.handler(ctx, input);
}
