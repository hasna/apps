import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkOpenApiDocument, serializeOpenApiDocument, summarizeOpenApiDocument } from "../src/api/index.js";

describe("OpenAPI contract generation", () => {
  it("keeps the committed OpenAPI snapshot current", () => {
    const parsed = JSON.parse(readFileSync("openapi.json", "utf8"));
    const snapshot = JSON.stringify(parsed);
    const generated = serializeOpenApiDocument();
    const summary = summarizeOpenApiDocument(generated);

    expect(snapshot).toBe(generated);
    expect(parsed.components.securitySchemes.bearerAuth).toEqual(
      expect.objectContaining({ type: "http", scheme: "bearer" }),
    );
    expect(parsed.paths["/health"].get.security).toEqual([]);
    expect(summary.operation_count).toBeGreaterThan(30);
    expect(new Set(summary.operation_ids).size).toBe(summary.operation_ids.length);
    expect(checkOpenApiDocument("openapi.json")).toEqual(
      expect.objectContaining({ valid: true, path: "openapi.json", operation_count: summary.operation_count }),
    );
  });

  it("exposes an OpenAPI check command for CI", () => {
    const output = execFileSync("bun", ["run", "src/cli/index.tsx", "--json", "openapi", "check"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const result = JSON.parse(output);
    expect(result).toEqual(expect.objectContaining({ valid: true, path: "openapi.json" }));
  });
});
