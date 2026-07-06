import { z, type ZodRawShape } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Database } from "bun:sqlite";
import { ASSET_KINDS, ASSET_STATUSES, DOCUMENT_TYPES, REGISTRATION_KINDS, REGISTRATION_STATUSES, RENEWAL_STATUSES, toErrorEnvelope } from "../../types/index.js";
import { invokeOp, OP_REGISTRY } from "../../services/registry.js";
import { principalToAuthContext } from "../../server/principal.js";
import type { ApiPrincipal } from "../../server/auth.js";
import { mcpError, mcpText } from "../compact.js";

// Domain MCP tools, one per registry op. Every handler dispatches through the
// shared service layer (invokeOp) with the caller's principal, so the MCP surface
// enforces the same scope + entity authorization as /v1 and the CLI (§5.1a).

const id = z.string().uuid().describe("Resource id (UUID)");
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date YYYY-MM-DD");

export const SCHEMAS: Record<string, ZodRawShape> = {
  seed_entity: {
    entity_id: z.string().uuid().optional().describe("Entity UUIDv4 (generated if omitted)"),
    entity_slug: z.string().optional().describe("Stable human slug, e.g. hasna-inc-us"),
    name: z.string().describe("Entity legal/display name"),
  },
  get_entity: { id },
  list_entities: {},
  create_asset: {
    entity_id: z.string().uuid().describe("Owning entity id"),
    kind: z.enum(ASSET_KINDS),
    name: z.string(),
    description: z.string().optional(),
    status: z.enum(ASSET_STATUSES).optional(),
  },
  get_asset: { id },
  list_assets: {
    entity_id: z.string().uuid().optional(),
    kind: z.enum(ASSET_KINDS).optional(),
    status: z.enum(ASSET_STATUSES).optional(),
  },
  update_asset: {
    id,
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    status: z.enum(ASSET_STATUSES).optional(),
    kind: z.enum(ASSET_KINDS).optional(),
  },
  delete_asset: { id },
  create_registration: {
    asset_id: z.string().uuid(),
    jurisdiction: z.string().describe("e.g. US, EU, RO, WIPO"),
    office: z.string().optional().describe("e.g. USPTO, EUIPO, WIPO"),
    kind: z.enum(REGISTRATION_KINDS).optional(),
    app_number: z.string().optional(),
    reg_number: z.string().optional(),
    filing_date: dateStr.optional(),
    registration_date: dateStr.optional(),
    status: z.enum(REGISTRATION_STATUSES).optional(),
  },
  get_registration: { id },
  list_registrations: { asset_id: z.string().uuid().optional(), status: z.enum(REGISTRATION_STATUSES).optional() },
  update_registration: {
    id,
    office: z.string().nullable().optional(),
    kind: z.enum(REGISTRATION_KINDS).optional(),
    app_number: z.string().nullable().optional(),
    reg_number: z.string().nullable().optional(),
    filing_date: dateStr.nullable().optional(),
    registration_date: dateStr.nullable().optional(),
    status: z.enum(REGISTRATION_STATUSES).optional(),
  },
  delete_registration: { id },
  create_renewal: {
    asset_id: z.string().uuid(),
    registration_id: z.string().uuid().optional(),
    due_date: dateStr,
    fee_amount: z.number().nonnegative().optional(),
    fee_currency: z.string().length(3).optional(),
    status: z.enum(RENEWAL_STATUSES).optional(),
    reminder_days: z.number().int().min(0).max(3650).optional(),
  },
  get_renewal: { id },
  list_renewals: { asset_id: z.string().uuid().optional(), status: z.enum(RENEWAL_STATUSES).optional() },
  upcoming_renewals: {
    within_days: z.number().int().min(0).max(3650).optional().describe("Horizon in days (default 90)"),
    as_of: dateStr.optional().describe("Anchor date (default today)"),
  },
  update_renewal: {
    id,
    due_date: dateStr.optional(),
    fee_amount: z.number().nonnegative().nullable().optional(),
    fee_currency: z.string().length(3).nullable().optional(),
    status: z.enum(RENEWAL_STATUSES).optional(),
    reminder_days: z.number().int().min(0).max(3650).optional(),
  },
  delete_renewal: { id },
  create_class: {
    asset_id: z.string().uuid(),
    nice_class: z.number().int().min(1).max(45).describe("Nice class 1-45"),
    description: z.string().optional(),
  },
  get_class: { id },
  list_classes: { asset_id: z.string().uuid().optional() },
  delete_class: { id },
  create_document: {
    asset_id: z.string().uuid(),
    title: z.string(),
    doc_type: z.enum(DOCUMENT_TYPES).optional(),
    doc_ref: z.string().optional().describe("External ref/uri (iapp-signatures / iapp-files)"),
  },
  get_document: { id },
  list_documents: { asset_id: z.string().uuid().optional() },
  delete_document: { id },
};

export interface DomainToolDeps {
  db: Database;
  principal: ApiPrincipal;
  shouldRegister: (toolName: string) => boolean;
}

export function registerDomainTools(server: McpServer, deps: DomainToolDeps): void {
  for (const def of OP_REGISTRY) {
    if (!deps.shouldRegister(def.mcpTool)) continue;
    const shape = SCHEMAS[def.mcpTool] ?? {};
    server.tool(def.mcpTool, `${def.op} — ${def.mutates ? "write" : "read"} (${def.resource})`, shape, async (input: Record<string, unknown>) => {
      const isAdmin = deps.principal.roles.some((r) => r === "system" || r === "owner" || r === "admin");
      if (!isAdmin && !deps.principal.scopes.includes(def.scope)) {
        return mcpError({ code: "PERMISSION_DENIED", message: `Caller lacks required scope: ${def.scope}.`, suggestion: "Use a credential with the required scope." });
      }
      try {
        const result = invokeOp({ db: deps.db, auth: principalToAuthContext(deps.principal) }, def.op, input);
        return mcpText(result);
      } catch (error) {
        return mcpError(toErrorEnvelope(error));
      }
    });
  }
}
