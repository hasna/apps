/**
 * HTTP request handler for workflows-serve. Interface layer over
 * WorkflowsService; all business logic lives in the service.
 */
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
    },
  };
}

export function createRequestHandler(service: WorkflowsService): (req: Request) => Response {
  return (req) => {
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/health":
        return jsonResponse(service.health());
      case "/ready":
        return jsonResponse(service.ready());
      case "/version":
        return jsonResponse({ service: service.name, version: service.version });
      case "/openapi.json":
        return jsonResponse(openApiDoc(service));
      default:
        return jsonResponse({ error: "not_found", path: url.pathname }, 404);
    }
  };
}
