import { describe, expect, test } from "bun:test";
import { buildFutureV1OpenApiDocument, buildV1OpenApiDocument } from "./openapi.js";
import {
  TODOS_STAGE_A_DISPATCH_ORDER,
  TODOS_STAGE_A_ROUTES,
  classifyTodosServerPostContainmentDispatch,
  matchTodosServerRoute,
} from "./stage-a-dispatch.js";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);

function operations(document: ReturnType<typeof buildV1OpenApiDocument>) {
  return Object.entries(document.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(([method]) => HTTP_METHODS.has(method))
      .map(([method, operation]) => ({ path, method: method.toUpperCase(), operation })),
  );
}

function concretePath(template: string): string {
  return template.replace(/\{[^}]+\}/g, "synthetic-segment");
}

describe("served /v1 OpenAPI Stage-A contract", () => {
  test("the finite route table is the single source for dispatch and OpenAPI", () => {
    const document = buildV1OpenApiDocument("stage-a-test");
    const byRoute = new Map(operations(document).map(({ path, method, operation }) => [
      `${method} ${path}`,
      operation,
    ]));

    expect(TODOS_STAGE_A_ROUTES.length).toBeGreaterThan(60);
    expect(new Set(TODOS_STAGE_A_ROUTES.map((route) => `${route.method} ${route.path}`)).size)
      .toBe(TODOS_STAGE_A_ROUTES.length);
    for (const route of TODOS_STAGE_A_ROUTES) {
      const path = concretePath(route.path);
      expect(matchTodosServerRoute(route.method, path), `${route.method} ${route.path}`).toEqual(route);
      expect(classifyTodosServerPostContainmentDispatch(route.method, path)).toBe(route.family);
      const operation = byRoute.get(`${route.method} ${route.path}`);
      expect(operation, `${route.method} ${route.path}`).toBeDefined();
      expect(operation["x-stage-a-dispatch-family"]).toBe(route.family);
      expect(Object.keys(operation.responses).sort()).toEqual([...route.statuses].sort());
    }
  });

  test("uses only finite single-segment templates and never claims a nested wildcard", () => {
    const document = buildV1OpenApiDocument("stage-a-test");
    const serialized = JSON.stringify(document);

    expect(Object.keys(document.paths)).not.toContain("/{path}");
    expect(serialized).not.toContain("x-stage-a-path-pattern");
    expect(serialized).not.toContain("/**");
    for (const route of TODOS_STAGE_A_ROUTES) {
      expect(route.path).not.toMatch(/\{(?:path|wildcard|rest|tail)\}/i);
      expect(concretePath(route.path)).not.toContain("{");
    }
  });

  test("unknown sensitive paths and unsupported methods have deterministic no-I/O families", () => {
    expect(classifyTodosServerPostContainmentDispatch("GET", "/v1/not-a-live-route"))
      .toBe("sensitive-not-found");
    expect(classifyTodosServerPostContainmentDispatch("GET", "/api/not-a-live-route/deep"))
      .toBe("sensitive-not-found");
    expect(classifyTodosServerPostContainmentDispatch("GET", "/mcp/nested"))
      .toBe("sensitive-not-found");
    expect(classifyTodosServerPostContainmentDispatch("TRACE", "/v1/tasks"))
      .toBe("sensitive-method-not-allowed");
    expect(classifyTodosServerPostContainmentDispatch("GET", "/unrelated"))
      .toBe("local-runtime");
  });

  test("documents containment, probes, CORS, exemptions, and rate behavior honestly", () => {
    const document = buildV1OpenApiDocument("stage-a-test");
    expect(document.info.description).toMatch(/Stage A/i);
    expect(document.security).toEqual([]);
    expect(document.components.securitySchemes).toBeUndefined();
    expect(document["x-future-positive-contract"]).toMatchObject({ enabled: false });
    expect(document["x-stage-a-dispatch-order"]).toEqual(TODOS_STAGE_A_DISPATCH_ORDER);
    expect(document["x-stage-a-rate-limit"]).toMatchObject({
      containment_before_limiter: true,
      finite_options_exempt: true,
      probes_may_return_429: true,
    });
    expect(document["x-stage-a-sensitive-fallbacks"]).toMatchObject({
      applies_after_containment: true,
      api_mcp_unknown_path: { status: 404, no_io: true },
      api_mcp_unsupported_method: { status: 405, no_io: true },
      v1_unknown_or_unsupported: {
        statuses: [400, 503],
        family: "hosted-containment",
        no_io: true,
        precedes_finite_route_classification: true,
      },
    });
    expect(document["x-stage-a-cors"]).toMatchObject({
      finite_options_only: true,
      v1_containment_precedes_cors: true,
    });

    const options = TODOS_STAGE_A_ROUTES.filter((route) => route.method === "OPTIONS");
    expect(options.length).toBeGreaterThan(20);
    expect(options.every((route) => route.statuses.includes("200"))).toBe(true);
    expect(TODOS_STAGE_A_ROUTES.find((route) => route.method === "GET" && route.path === "/health")?.statuses)
      .toEqual(["200", "429"]);
    expect(TODOS_STAGE_A_ROUTES.find((route) => route.method === "GET" && route.path === "/ready")?.statuses)
      .toEqual(["200", "429", "503"]);
    const mcpPost = document.paths["/mcp"].post;
    expect(Object.keys(mcpPost.responses).sort()).toContain("202");
    expect(mcpPost.responses["202"]).toEqual({
      description: "The MCP JSON-RPC notification was accepted with no response body.",
    });
    expect(document.paths["/mcp"].get.responses["202"]).toBeUndefined();
    expect(document.paths["/mcp"].delete.responses["202"]).toBeUndefined();
  });

  test("the containment schemas exactly describe ordinary and forged-authority bodies", () => {
    const schemas = buildV1OpenApiDocument("stage-a-test").components.schemas;
    expect(schemas.StageAHostedAuthorityUnavailable).toMatchObject({
      required: ["error", "code", "reason"],
      properties: {
        error: { const: "hosted_authority_unavailable" },
        code: { const: "HOSTED_AUTHORITY_UNAVAILABLE" },
        reason: { const: "authority_resolver_unavailable" },
      },
    });
    expect(schemas.StageACallerAuthorityRejected).toMatchObject({
      required: ["error", "code", "source"],
      properties: {
        error: { const: "caller_authority_rejected" },
        code: { const: "CALLER_AUTHORITY_REJECTED" },
        source: { enum: ["header", "query"] },
      },
    });
  });

  test("future-positive schemas remain available only through the disabled non-live builder", () => {
    const future = buildFutureV1OpenApiDocument("future-test");
    expect(future.info.description).toMatch(/Future-positive contract \(not live; disabled in Stage A\)/);
    expect(future["x-stage-a-enabled"]).toBe(false);
    expect(future.security).toEqual([{ apiKey: [] }]);
    expect(future.paths["/v1/tasks"].get.responses["200"]).toBeDefined();
  });
});
