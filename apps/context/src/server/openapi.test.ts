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
});
