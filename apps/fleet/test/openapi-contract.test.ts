import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { checkOpenApiDocument, serializeOpenApiDocument, summarizeOpenApiDocument } from "../src/api/index.js";

describe("OpenAPI contract generation", () => {
  it("keeps the committed OpenAPI snapshot current", () => {
    const committed = readFileSync("openapi.json", "utf8").trim();
    const generated = serializeOpenApiDocument();
    expect(committed).toBe(generated);
  });

  it("declares bearer auth and leaves system endpoints public", () => {
    const parsed = JSON.parse(serializeOpenApiDocument());
    expect(parsed.components.securitySchemes.bearerAuth).toEqual(
      expect.objectContaining({ type: "http", scheme: "bearer" }),
    );
    expect(parsed.paths["/health"].get.security).toEqual([]);
    expect(parsed.paths["/version"].get.security).toEqual([]);
  });

  it("has unique operation ids covering config + fused resources", () => {
    const summary = summarizeOpenApiDocument(serializeOpenApiDocument());
    expect(summary.operation_count).toBeGreaterThan(20);
    expect(new Set(summary.operation_ids).size).toBe(summary.operation_ids.length);
    expect(summary.operation_ids).toContain("saved-view.create");
    expect(summary.operation_ids).toContain("health.agents");
  });

  it("check helper validates the committed doc", () => {
    expect(checkOpenApiDocument("openapi.json")).toEqual(
      expect.objectContaining({ valid: true, path: "openapi.json" }),
    );
  });
});
