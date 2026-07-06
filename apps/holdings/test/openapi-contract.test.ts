import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { openApiDocument, openApiDocumentJson, operationIdFor } from "../src/api/index.js";
import { OP_REGISTRY } from "../src/services/registry.js";

describe("openapi contract", () => {
  it("checked-in openapi.json is current", () => {
    const onDisk = readFileSync("openapi.json", "utf8").trim();
    expect(onDisk).toBe(openApiDocumentJson().trim());
  });

  it("advertises the system endpoints", () => {
    const opIds = Object.values(openApiDocument.paths).flatMap((p) => Object.values(p).map((op) => op.operationId));
    expect(opIds).toContain("getHealth");
    expect(opIds).toContain("getReady");
    expect(opIds).toContain("getVersion");
  });

  it("advertises every registry op as a REST operation", () => {
    for (const def of OP_REGISTRY) {
      const path = def.api.path.replace(/:([A-Za-z_]+)/g, "{$1}");
      const method = def.api.method.toLowerCase();
      const operation = openApiDocument.paths[path]?.[method];
      expect(operation, `${def.op} -> ${method.toUpperCase()} ${path}`).toBeDefined();
      expect(operation!.operationId).toBe(operationIdFor(def.op));
    }
  });
});
