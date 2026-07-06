import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openApiDocument, openApiJson } from "../src/api/index.js";
import { ALL_OPS } from "../src/services/registry.js";

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_]+)/g, "{$1}");
}

describe("openapi contract", () => {
  it("checked-in openapi.json is current (openapi:check)", () => {
    const onDisk = readFileSync(join(process.cwd(), "openapi.json"), "utf8");
    expect(onDisk).toBe(openApiJson());
  });

  it("documents every registry op path + method", () => {
    const doc = openApiDocument();
    for (const op of ALL_OPS) {
      const path = toOpenApiPath(op.path);
      expect(doc.paths[path], `missing ${path}`).toBeDefined();
      const operation = doc.paths[path]?.[op.method.toLowerCase()] as { operationId?: string; "x-scopes"?: string[] } | undefined;
      expect(operation?.operationId).toBe(op.op);
      expect(operation?.["x-scopes"]).toEqual(op.scopes);
    }
  });

  it("declares bearer security and the system endpoints", () => {
    const doc = openApiDocument();
    expect((doc.components as { securitySchemes?: Record<string, unknown> }).securitySchemes).toHaveProperty("bearerAuth");
    for (const p of ["/health", "/ready", "/version"]) expect(doc.paths[p]).toBeDefined();
  });
});
