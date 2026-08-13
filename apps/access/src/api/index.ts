import { readFileSync } from "node:fs";
import { APP_VERSION } from "../version.js";

/**
 * OpenAPI 3.1 document builder for the /v1 API. Generated to openapi.json and
 * verified by test/openapi-contract.test.ts. Kept in lock-step with the Hono
 * routers (one entry per REST endpoint) so interface parity is inspectable.
 */

interface Endpoint {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  operationId: string;
  summary: string;
  public?: boolean;
}

const ENDPOINTS: Endpoint[] = [
  { method: "get", path: "/health", operationId: "getHealth", summary: "Liveness probe", public: true },
  { method: "get", path: "/ready", operationId: "getReady", summary: "Readiness probe", public: true },
  { method: "get", path: "/version", operationId: "getVersion", summary: "Version + mode", public: true },

  { method: "get", path: "/v1/identities", operationId: "listIdentities", summary: "List non-human identities" },
  { method: "post", path: "/v1/identities", operationId: "createIdentity", summary: "Register an identity" },
  { method: "get", path: "/v1/identities/{id}", operationId: "getIdentity", summary: "Get an identity" },
  { method: "patch", path: "/v1/identities/{id}", operationId: "updateIdentity", summary: "Update an identity" },
  { method: "post", path: "/v1/identities/{id}/suspend", operationId: "suspendIdentity", summary: "Suspend an identity" },
  { method: "post", path: "/v1/identities/{id}/retire", operationId: "retireIdentity", summary: "Retire an identity" },

  { method: "get", path: "/v1/credentials", operationId: "listCredentials", summary: "List credential references" },
  { method: "post", path: "/v1/credentials", operationId: "registerCredential", summary: "Register a credential reference" },
  { method: "get", path: "/v1/credentials/{id}", operationId: "getCredential", summary: "Get a credential" },
  { method: "delete", path: "/v1/credentials/{id}", operationId: "revokeCredential", summary: "Revoke a credential" },

  { method: "get", path: "/v1/scopes", operationId: "listScopes", summary: "List MCP tool scope grants" },
  { method: "post", path: "/v1/scopes", operationId: "grantScope", summary: "Grant an MCP tool scope" },
  { method: "get", path: "/v1/scopes/effective", operationId: "effectiveScopes", summary: "Effective scopes for an identity" },
  { method: "get", path: "/v1/scopes/{id}", operationId: "getScope", summary: "Get a scope grant" },
  { method: "delete", path: "/v1/scopes/{id}", operationId: "revokeScope", summary: "Revoke a scope grant" },

  { method: "get", path: "/v1/elevations", operationId: "listElevations", summary: "List JIT elevations" },
  { method: "post", path: "/v1/elevations", operationId: "requestElevation", summary: "Request a JIT elevation" },
  { method: "post", path: "/v1/elevations/expire", operationId: "expireElevations", summary: "Sweep expired elevations" },
  { method: "get", path: "/v1/elevations/{id}", operationId: "getElevation", summary: "Get an elevation" },
  { method: "post", path: "/v1/elevations/{id}/approve", operationId: "approveElevation", summary: "Approve an elevation" },
  { method: "delete", path: "/v1/elevations/{id}", operationId: "revokeElevation", summary: "Revoke an elevation" },

  { method: "get", path: "/v1/reviews", operationId: "listReviews", summary: "List access reviews" },
  { method: "post", path: "/v1/reviews", operationId: "scheduleReview", summary: "Schedule an access review" },
  { method: "get", path: "/v1/reviews/{id}", operationId: "getReview", summary: "Get an access review" },
  { method: "post", path: "/v1/reviews/{id}/start", operationId: "startReview", summary: "Start an access review" },
  { method: "post", path: "/v1/reviews/{id}/complete", operationId: "completeReview", summary: "Complete an access review" },
  { method: "post", path: "/v1/reviews/{id}/cancel", operationId: "cancelReview", summary: "Cancel an access review" },

  { method: "get", path: "/v1/requests", operationId: "listRequests", summary: "List access requests" },
  { method: "post", path: "/v1/requests", operationId: "createRequest", summary: "Create an access request" },
  { method: "get", path: "/v1/requests/{id}", operationId: "getRequest", summary: "Get an access request" },
  { method: "post", path: "/v1/requests/{id}/approve", operationId: "approveRequest", summary: "Approve an access request" },
  { method: "post", path: "/v1/requests/{id}/provision", operationId: "provisionRequest", summary: "Mark an access request provisioned" },
  { method: "post", path: "/v1/requests/{id}/fail", operationId: "failRequest", summary: "Mark an access request failed" },
  { method: "post", path: "/v1/requests/{id}/cancel", operationId: "cancelRequest", summary: "Cancel an access request" },

  { method: "get", path: "/v1/revocations", operationId: "listRevocations", summary: "List revocations" },
  { method: "post", path: "/v1/revocations", operationId: "executeRevocation", summary: "One-click revocation" },

  { method: "get", path: "/v1/tokens", operationId: "listTokens", summary: "List issued MCP bearer tokens" },
  { method: "post", path: "/v1/tokens", operationId: "issueToken", summary: "Issue an MCP bearer token" },
  { method: "post", path: "/v1/tokens/verify", operationId: "verifyToken", summary: "Verify an MCP bearer token" },
  { method: "get", path: "/v1/tokens/{id}", operationId: "getToken", summary: "Get an issued token record" },
  { method: "delete", path: "/v1/tokens/{id}", operationId: "revokeToken", summary: "Revoke an issued token" },

  { method: "get", path: "/v1/audit", operationId: "listAudit", summary: "List append-only audit events" },
  { method: "get", path: "/v1/audit/verify", operationId: "verifyAudit", summary: "Verify the audit hash chain" },
];

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  components: { securitySchemes: { bearerAuth: { type: string; scheme: string } } };
  security: Array<Record<string, string[]>>;
  paths: Record<string, Record<string, {
    operationId: string;
    summary: string;
    security?: Array<Record<string, string[]>>;
    responses: Record<string, { description: string }>;
  }>>;
}

export function openApiDocument(): OpenApiDocument {
  const paths: OpenApiDocument["paths"] = {};
  for (const ep of ENDPOINTS) {
    const item = paths[ep.path] ?? (paths[ep.path] = {});
    item[ep.method] = {
      operationId: ep.operationId,
      summary: ep.summary,
      ...(ep.public ? { security: [] } : {}),
      responses: {
        "200": { description: "OK" },
        "400": { description: "Validation error" },
        "401": { description: "Unauthorized" },
        "403": { description: "Permission denied" },
        "404": { description: "Not found" },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "@hasna/access",
      version: APP_VERSION,
      description: "Non-human-identity governance API: identities, credentials, MCP scopes, JIT elevation, access reviews, revocation, and MCP bearer-token issuance.",
    },
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

export function serializeOpenApiDocument(): string {
  return JSON.stringify(openApiDocument());
}

export interface OpenApiSummary {
  operation_count: number;
  operation_ids: string[];
}

export function summarizeOpenApiDocument(json: string): OpenApiSummary {
  const doc = JSON.parse(json) as OpenApiDocument;
  const ids = Object.values(doc.paths).flatMap((item) => Object.values(item).map((op) => op.operationId));
  return { operation_count: ids.length, operation_ids: ids };
}

export interface OpenApiCheck {
  valid: boolean;
  path: string;
  operation_count: number;
  reason?: string;
}

export function checkOpenApiDocument(path: string): OpenApiCheck {
  let onDisk: string;
  try {
    onDisk = JSON.stringify(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    return { valid: false, path, operation_count: 0, reason: error instanceof Error ? error.message : String(error) };
  }
  const generated = serializeOpenApiDocument();
  const summary = summarizeOpenApiDocument(generated);
  if (onDisk !== generated) {
    return { valid: false, path, operation_count: summary.operation_count, reason: "openapi.json is stale; run openapi:generate" };
  }
  const unique = new Set(summary.operation_ids).size === summary.operation_ids.length;
  return { valid: unique, path, operation_count: summary.operation_count, ...(unique ? {} : { reason: "duplicate operationIds" }) };
}
