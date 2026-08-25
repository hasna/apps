/**
 * HTTP request handler for workflows-serve. Interface layer over
 * WorkflowsService; all business logic lives in the service.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { WorkflowsService } from "./service.js";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function openApiDoc(service: WorkflowsService): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: { title: "workflows", version: service.version },
    paths: {
      "/health": { get: { summary: "Service health", responses: { "200": { description: "ok" } } } },
      "/ready": { get: { summary: "Service readiness", responses: { "200": { description: "ok" } } } },
      "/version": { get: { summary: "Service version", responses: { "200": { description: "ok" } } } },
      "/trigger": {
        post: {
          summary: "Authenticated trigger: run a workflow graph to a terminal state",
          security: [{ bearerAuth: [] }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["graph"],
                  properties: {
                    graph: { type: "object", description: "the workflow graph" },
                    context: { type: "object", description: "optional run context" },
                    idempotencyKey: { type: "string", description: "re-run with the same key returns the same run" },
                    maxCycles: { type: "number", description: "bound on reap cycles (default 500, max 2000)" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "run summary" },
            "401": { description: "missing or invalid Bearer token" },
            "503": { description: "trigger not configured (WORKFLOWS_API_KEY unset)" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  };
}

/** Constant-time Bearer token comparison (sha256 digests of both sides). */
function bearerMatches(authHeader: string, expected: string): boolean {
  if (!authHeader.startsWith("Bearer ")) return false;
  const supplied = authHeader.slice("Bearer ".length);
  if (supplied.length === 0) return false;
  const a = createHash("sha256").update(supplied).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

async function handleTrigger(service: WorkflowsService, req: Request): Promise<Response> {
  const expected = service.config.apiKey;
  if (!expected) {
    return jsonResponse(
      { error: "trigger_not_configured", message: "WORKFLOWS_API_KEY is not configured — set it to enable the authenticated trigger" },
      503,
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!bearerMatches(auth, expected)) {
    return jsonResponse({ error: "unauthorized", message: "a valid Bearer token is required" }, 401);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json", message: "request body must be JSON" }, 400);
  }
  const record = body as { graph?: unknown; context?: unknown; idempotencyKey?: unknown; maxCycles?: unknown };
  if (record.graph === null || typeof record.graph !== "object" || Array.isArray(record.graph)) {
    return jsonResponse({ error: "graph_required", message: "body.graph must be a workflow graph object" }, 400);
  }
  const context = record.context ?? {};
  if (typeof context !== "object" || Array.isArray(context)) {
    return jsonResponse({ error: "invalid_context", message: "body.context must be an object" }, 400);
  }
  const maxCycles = typeof record.maxCycles === "number" ? record.maxCycles : undefined;
  const idempotencyKey = typeof record.idempotencyKey === "string" ? record.idempotencyKey : undefined;
  try {
    const summary = await service.triggerRun(record.graph as never, context as Record<string, unknown>, { maxCycles, idempotencyKey });
    return jsonResponse(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: "trigger_failed", message }, 400);
  }
}

export function createRequestHandler(service: WorkflowsService): (req: Request) => Response | Promise<Response> {
  return (req) => {
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/health":
        return jsonResponse(service.health());
      case "/ready":
        return jsonResponse(service.ready());
      case "/version":
        return jsonResponse({ service: service.name, version: service.version });
      case "/trigger":
        return handleTrigger(service, req);
      case "/openapi.json":
        return jsonResponse(openApiDoc(service));
      default:
        return jsonResponse({ error: "not_found", path: url.pathname }, 404);
    }
  };
}
