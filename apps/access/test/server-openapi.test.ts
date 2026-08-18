import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { buildApp } from "../src/server/app.js";

/**
 * The manifest declares a supported API surface with openApiPath /openapi.json
 * and an SDK generatedFrom /openapi.json (contracts-align lane). The server
 * must actually serve the committed OpenAPI document there — a declared
 * openApiPath that nothing serves is a control-plane write treated as a
 * contract.
 */
describe("server OpenAPI surface", () => {
  it("serves /openapi.json equal to the committed document", async () => {
    const app = buildApp();
    const res = await app.fetch(new Request("http://127.0.0.1/openapi.json"));
    expect(res.status).toBe(200);
    const committed = JSON.parse(readFileSync("openapi.json", "utf8"));
    const served = (await res.json()) as Record<string, unknown>;
    expect(served).toEqual(committed);
  });

  it("serves /health and /version as declared in the manifest", async () => {
    const app = buildApp();
    const health = await app.fetch(new Request("http://127.0.0.1/health"));
    expect(health.status).toBe(200);
    expect(typeof (await health.json())).toBe("object");
    const version = await app.fetch(new Request("http://127.0.0.1/version"));
    expect(version.status).toBe(200);
  });
});
