import { describe, expect, it } from "bun:test";
import { openApiDocument, buildOpenApiDocument } from "../src/api/index.js";
import { OP_REGISTRY } from "../src/services/registry.js";

function camel(op: string): string {
  return op.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

describe("OpenAPI contract", () => {
  it("advertises getHealth plus every registry operation", () => {
    const operationIds = Object.values(openApiDocument.paths).flatMap((item) =>
      Object.values(item).map((op) => op.operationId),
    );
    expect(operationIds).toContain("getHealth");
    for (const op of OP_REGISTRY) {
      expect(operationIds, `missing operationId for ${op.op}`).toContain(camel(op.op));
    }
  });

  it("maps every registry route to an OpenAPI path + method", () => {
    for (const op of OP_REGISTRY) {
      const path = op.surfaces.api.path.replace(/:([A-Za-z_]+)/g, "{$1}");
      const method = op.surfaces.api.method.toLowerCase() as keyof (typeof openApiDocument.paths)[string];
      expect(openApiDocument.paths[path], `missing path ${path}`).toBeDefined();
      expect(openApiDocument.paths[path]![method], `missing ${op.surfaces.api.method} ${path}`).toBeDefined();
    }
  });

  it("attaches a bearer security requirement to every domain operation", () => {
    for (const [path, item] of Object.entries(openApiDocument.paths)) {
      if (path === "/health") continue;
      for (const op of Object.values(item)) {
        expect(op.security.length).toBeGreaterThan(0);
        expect(Object.keys(op.security[0]!)[0]).toBe("bearerAuth");
      }
    }
  });

  it("is deterministic (rebuild equals the exported document)", () => {
    expect(JSON.stringify(buildOpenApiDocument())).toEqual(JSON.stringify(openApiDocument));
  });
});
