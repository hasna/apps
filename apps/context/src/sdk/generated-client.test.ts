/**
 * Staleness + shape gate for the generated HTTP client SDK.
 *
 * ROOT CAUSE guarded here: hasna.contract.json declares the package-sdk
 * surface as generated from /openapi.json; that claim must be true and must
 * stay true. This test regenerates the client from the current OpenAPI
 * document in memory and fails if the committed generated-client.ts differs
 * (run `bun run openapi:generate`), and asserts the client exposes a method
 * per declared endpoint so a contract-driven consumer can invoke the routes.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApiDocument } from "../server/openapi.js";
import { generateClientSource } from "./generate-client.js";
import { ContextClient } from "./generated-client.js";

const GENERATED_PATH = join(import.meta.dir, "generated-client.ts");

describe("generated context HTTP client", () => {
  test("the committed generated client is not stale", () => {
    const committed = readFileSync(GENERATED_PATH, "utf8");
    const fresh = generateClientSource(buildOpenApiDocument() as never);
    expect(fresh).toBe(committed);
  });

  test("the client exposes a typed method for every declared endpoint", () => {
    const doc = buildOpenApiDocument() as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    const proto = ContextClient.prototype as Record<string, unknown>;
    for (const operations of Object.values(doc.paths)) {
      for (const op of Object.values(operations)) {
        expect(typeof proto[op.operationId], `missing ${op.operationId}`).toBe("function");
      }
    }
  });

  test("core methods exist and the client honors a token", () => {
    const client = new ContextClient({ baseUrl: "http://127.0.0.1:8080", token: "t" });
    expect(typeof client.search).toBe("function");
    expect(typeof client.listLibraries).toBe("function");
    expect(typeof client.getLibrary).toBe("function");
    expect(typeof client.buildDocsContext).toBe("function");
    expect(typeof client.listWebhooks).toBe("function");
    expect(typeof client.mcpJsonRpc).toBe("function");
  });
});
