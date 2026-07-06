import type { ZodTypeAny } from "zod";
import type { Store } from "../db/store.js";
import type { ApiPrincipal, ApiScope } from "../server/auth.js";
import type { AuthorizationAction } from "./authorization.js";

// A single domain operation, defined ONCE and exposed identically across CLI,
// MCP, and /v1 (interface parity). The parity harness is identical; this table
// is the per-app generated surface.

export interface OpContext {
  store: Store;
  principal: ApiPrincipal;
  /** Enforce entity/org scoping for a single entity the op touches. */
  requireEntity(entityId: string): void;
  /** Enforce entity/org scoping for a group of entities (ALL must be allowed). */
  requireAllEntities(entityIds: string[]): void;
}

export interface HttpBinding {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path template with :params, e.g. "/v1/runs/:id". */
  pathTemplate: string;
  /** Build the concrete path (fills :params) from validated input. */
  toPath(input: Record<string, unknown>): string;
  /** Input keys carried in the JSON body (POST/PATCH). */
  bodyKeys?: string[];
  /** Input keys carried as query string (GET/DELETE list filters). */
  queryKeys?: string[];
}

export interface CliBinding {
  /** Command path, e.g. ["runs", "get"]. */
  path: string[];
  /** Build --flag argv from validated input. */
  toArgs(input: Record<string, unknown>): string[];
}

export interface OpDef {
  op: string;
  summary: string;
  action: AuthorizationAction;
  scope: ApiScope;
  input: ZodTypeAny;
  http: HttpBinding;
  cli: CliBinding;
  mcpTool: string;
  /** Whether the op participates in the generated interface-parity table. */
  parity?: boolean;
  /** MCP profiles that include this op (minimal|standard|full). full always includes. */
  profiles: Array<"minimal" | "standard" | "full">;
  /** Whether the op mutates state (write action + write scope required). */
  mutating: boolean;
  handler(ctx: OpContext, input: Record<string, unknown>): Promise<unknown>;
}
