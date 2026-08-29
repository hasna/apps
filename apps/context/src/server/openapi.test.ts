/**
 * OpenAPI contract coverage for the context-serve HTTP surface.
 *
 * ROOT CAUSE guarded here: the supported SDK surface declared in
 * hasna.contract.json (package-sdk generatedFrom / http-api openApiPath)
 * previously pointed at nothing — no /openapi.json route existed, so the
 * conformance gate (`repo-conformance`) failed and the declaration would
 * have been a lie. The served document must be the builder's output and
 * must list the core routes, so the SDK surface is honest and cannot
 * silently drift from the route handlers.
 */
import { describe, expect, test } from "bun:test";
import { buildOpenApiDocument } from "./openapi.js";
import { handleRequest } from "./index.js";

describe("context OpenAPI surface", () => {
  test("the document is OpenAPI 3.1 and describes the core routes", () => {
    const doc = buildOpenApiDocument() as {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("Context API");
    expect(doc.info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(doc.paths["/health"]).toBeDefined();
    expect(doc.paths["/ready"]).toBeDefined();
    expect(doc.paths["/version"]).toBeDefined();
    expect(doc.paths["/api/search"]).toBeDefined();
    expect(doc.paths["/api/libraries"]).toBeDefined();
  });

  test("GET /openapi.json is served and equals the builder output", async () => {
    const res = await handleRequest(new Request("http://localhost/openapi.json"));
    expect(res.status).toBe(200);
    const served = (await res.json()) as { paths: Record<string, unknown> };
    const built = buildOpenApiDocument() as { paths: Record<string, unknown> };
    expect(served).toEqual(built);
    expect(served.paths["/api/search"]).toBeDefined();
  });

  test("GET /openapi.json is public even when HTTP auth is required", async () => {
    process.env.CONTEXT_REQUIRE_HTTP_AUTH = "1";
    try {
      const res = await handleRequest(new Request("http://localhost/openapi.json"));
      expect(res.status).toBe(200);
    } finally {
      delete process.env.CONTEXT_REQUIRE_HTTP_AUTH;
    }
  });

  test("declares security schemes and marks protected operations (contract honesty)", () => {
    // ROOT CAUSE guarded here: protected /api/* and /mcp operations had no
    // OpenAPI security requirements or securitySchemes and the `public`
    // marker was unused — the machine-readable contract described
    // authenticated routes as unauthenticated (release-review P1).
    const doc = buildOpenApiDocument() as {
      components: {
        securitySchemes: Record<string, unknown>;
      };
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };

    expect(doc.components.securitySchemes.bearerAuth).toBeDefined();
    expect(doc.components.securitySchemes.xContextToken).toBeDefined();

    // Public endpoints carry an EMPTY security array (explicitly public).
    expect(doc.paths["/health"]!.get.security).toEqual([]);
    expect(doc.paths["/api/health"]!.get.security).toEqual([]);
    expect(doc.paths["/version"]!.get.security).toEqual([]);

    // Protected endpoints REQUIRE one of the declared schemes.
    const searchSecurity = doc.paths["/api/search"]!.get.security;
    expect(searchSecurity).toEqual([{ bearerAuth: [] }, { xContextToken: [] }]);
    expect(doc.paths["/api/libraries"]!.get.security).toEqual([{ bearerAuth: [] }, { xContextToken: [] }]);
    expect(doc.paths["/mcp"]!.post.security).toEqual([{ bearerAuth: [] }, { xContextToken: [] }]);
  });
});
