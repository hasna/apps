import { APP_VERSION } from "../version.js";
import { ALL_OPS } from "../services/registry.js";
import type { ServiceOp } from "../services/context.js";

/**
 * OpenAPI 3.1 document GENERATED from the service registry (BUILD-SPEC §6.3/§7).
 * Because paths derive from the same ALL_OPS that back the CLI and MCP, the
 * documented surface is parity-consistent by construction. Written to
 * openapi.json and verified by test/openapi-contract.test.ts.
 */
export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string }[];
  components: Record<string, unknown>;
  paths: Record<string, Record<string, unknown>>;
}

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_]+)/g, "{$1}");
}

function pathParams(path: string): string[] {
  return Array.from(path.matchAll(/:([A-Za-z_]+)/g)).map((m) => m[1] as string);
}

function operationObject(op: ServiceOp): Record<string, unknown> {
  const parameters: Record<string, unknown>[] = pathParams(op.path).map((name) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  // Webhook ingest carries a Stripe signature verified fail-closed before any
  // state change (BUILD-SPEC §5.1a webhook integrity). Documented as a header;
  // it may equivalently be supplied as a body `signature` field for parity.
  if (op.op === "ingest_event") {
    parameters.push({
      name: "Stripe-Signature",
      in: "header",
      required: false,
      description:
        "Stripe webhook signature (t=<unix>,v1=<hmac-sha256>). Verified timing-safe against the configured " +
        "HASNA_BILLING_STRIPE_WEBHOOK_SECRET with a replay window BEFORE any state mutation. Required unless " +
        "supplied in the request body `signature` field.",
      schema: { type: "string" },
    });
  }
  const operation: Record<string, unknown> = {
    operationId: op.op,
    summary: op.summary,
    tags: [op.resource],
    security: [{ bearerAuth: op.scopes }],
    "x-scopes": op.scopes,
    "x-action": op.action,
    responses: {
      "200": { description: "Success" },
      "401": { description: "Unauthorized" },
      "403": { description: "Permission denied" },
      "404": { description: "Not found" },
      "422": { description: "Invalid transition" },
    },
  };
  if (parameters.length > 0) operation.parameters = parameters;
  if (op.method !== "GET") {
    operation.requestBody = {
      required: true,
      content: { "application/json": { schema: { type: "object" } } },
    };
  }
  return operation;
}

export function openApiDocument(): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};

  paths["/health"] = {
    get: {
      operationId: "health",
      summary: "Liveness + version + mode.",
      tags: ["system"],
      responses: { "200": { description: "Health payload { status, version, mode }" } },
    },
  };
  paths["/ready"] = {
    get: { operationId: "ready", summary: "Readiness (DB + migrations).", tags: ["system"], responses: { "200": { description: "Ready" }, "503": { description: "Not ready" } } },
  };
  paths["/version"] = {
    get: { operationId: "version", summary: "Version + mode.", tags: ["system"], responses: { "200": { description: "Version payload" } } },
  };

  for (const op of ALL_OPS) {
    const p = toOpenApiPath(op.path);
    paths[p] = paths[p] ?? {};
    paths[p][op.method.toLowerCase()] = operationObject(op);
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "@hasna/billing",
      version: APP_VERSION,
      description:
        "Thin agent-facing billing/dunning orchestration over Stripe Billing: subscription lifecycle, decline-code retries, pre-dunning, graduated downgrades, multi-entity invoicing.",
    },
    servers: [{ url: "http://127.0.0.1:3487" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Billing API credential (scoped bearer token)." },
      },
    },
    paths,
  };
}

/**
 * Deterministic (minified, single-line) serialization used by openapi:generate
 * and the contract test. Minified so the checked-in artifact stays under the
 * 700-line production cap (BUILD-SPEC §3.6).
 */
export function openApiJson(): string {
  return JSON.stringify(openApiDocument()) + "\n";
}
