import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkOpenApiDocument, serializeOpenApiDocument, summarizeOpenApiDocument } from "../src/api/index.js";

describe("OpenAPI contract", () => {
  it("keeps the committed openapi.json current", () => {
    const committed = readFileSync("openapi.json", "utf8").trim();
    const generated = serializeOpenApiDocument().trim();
    expect(committed).toBe(generated);
  });

  it("declares bearer auth and leaves system endpoints open", () => {
    const doc = JSON.parse(readFileSync("openapi.json", "utf8"));
    expect(doc.components.securitySchemes.bearerAuth).toEqual(
      expect.objectContaining({ type: "http", scheme: "bearer" }),
    );
    expect(doc.paths["/health"].get.security).toEqual([]);
  });

  it("has unique operation ids for every operation", () => {
    const summary = summarizeOpenApiDocument();
    expect(summary.operation_count).toBeGreaterThan(20);
    expect(new Set(summary.operation_ids).size).toBe(summary.operation_ids.length);
  });

  it("exposes an openapi check command for CI", () => {
    const output = execFileSync("bun", ["run", "src/cli/index.tsx", "--json", "openapi", "check"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual(expect.objectContaining({ valid: true, path: "openapi.json" }));
    expect(checkOpenApiDocument("openapi.json").valid).toBe(true);
  });
});
