import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { StaticCredentialProvider, ComputersClient } from "../src/sdk";
import { REST_ROUTE_MANIFEST } from "../src/server";
import { SAFE_MCP_TOOLS } from "../src/mcp";

describe("SDK and declared surfaces", () => {
  test("SDK restricts transport, token, redirects, timeout, and non-JSON errors", async () => {
    const credential = new StaticCredentialProvider("x".repeat(32));
    for (const url of ["http://example.com", "http://127.0.0.2:7788", "ftp://127.0.0.1", "https://user:pass@example.com"]) {
      expect(() => new ComputersClient({ baseUrl: url, credentials: credential })).toThrow("Invalid Computers API URL");
    }
    new ComputersClient({ baseUrl: "http://127.0.0.1:7788", credentials: credential });
    new ComputersClient({ baseUrl: "http://localhost:7788", credentials: credential });
    const calls: RequestInit[] = [];
    const redirectClient = new ComputersClient({ baseUrl: "https://api.example.invalid", credentials: credential, timeoutMs: 500,
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => { calls.push(init ?? {}); return new Response(null, { status: 302, headers: { location: "https://evil.invalid" } }); }) as typeof fetch });
    await expect(redirectClient.listComputers()).rejects.toThrow("redirect");
    expect(calls[0]?.redirect).toBe("manual");
    expect(() => new StaticCredentialProvider("x".repeat(513))).toThrow("Authentication configuration");
    const textError = new ComputersClient({ baseUrl: "https://api.example.invalid", credentials: credential, fetch: (async () => new Response("gateway exploded", { status: 502 })) as typeof fetch });
    await expect(textError.listComputers()).rejects.toThrow("Request failed");
    const unsafeJsonError = new ComputersClient({ baseUrl: "https://api.example.invalid", credentials: credential,
      fetch: (async () => new Response(JSON.stringify({ error: { code: "invented", message: "do not trust me" } }), { status: 500, headers: { "content-type": "application/json" } })) as typeof fetch });
    await expect(unsafeJsonError.listComputers()).rejects.toThrow("Request failed");
    const timeoutClient = new ComputersClient({ baseUrl: "https://api.example.invalid", credentials: credential, timeoutMs: 100,
      fetch: ((_url: string | URL | Request, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })) as typeof fetch });
    await expect(timeoutClient.listComputers()).rejects.toBeDefined();
  });

  test("OpenAPI operations and runtime route/tool manifests agree structurally", () => {
    const api = JSON.parse(readFileSync("schemas/openapi.json", "utf8")) as { paths: Record<string, Record<string, unknown>>; components: { schemas: Record<string, unknown> } };
    for (const route of REST_ROUTE_MANIFEST) {
      const operation = api.paths[route.path]?.[route.method.toLowerCase()];
      expect(operation).toBeDefined();
      expect((operation as { responses?: unknown }).responses).toBeDefined();
    }
    const serialized = JSON.stringify(api);
    expect(serialized).not.toContain("#/components/pathItems/");
    expect((api.components.schemas.Operation as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    const create = api.components.schemas.CreateComputer as {
      properties: Record<string, Record<string, unknown>>;
      allOf?: unknown[];
    };
    expect(create.properties.slug).toMatchObject({ minLength: 1, maxLength: 63, pattern: "^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$" });
    expect(create.properties.region).toEqual({ type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9][a-z0-9_-]*$" });
    expect(create.properties.storageGiB).toEqual({ type: "integer", minimum: 1, maximum: 1_048_576 });
    expect(create.properties.uptimeSeconds).toEqual({ type: "integer", minimum: 1, maximum: 31_536_000 });
    expect(create.properties.budgetMicros).toEqual({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
    expect(create.allOf).toContainEqual({ if: { required: ["parentComputerId"] }, then: { required: ["grantId", "region", "profileId", "storageGiB", "uptimeSeconds", "budgetMicros"] } });
    const grant = api.components.schemas.CreateComputerGrant as { properties: Record<string, Record<string, unknown>> };
    expect(grant.properties.allowedProviders).toEqual({ type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: { enum: ["local_machine", "local_vm", "aws_ec2"] } });
    expect(grant.properties.allowedChildOwnerPrincipalIds).toEqual({ type: "array", minItems: 1, maxItems: 128, uniqueItems: true, items: { $ref: "#/components/schemas/Id" } });
    expect(grant.properties.allowedRegions).toEqual({ type: "array", minItems: 1, maxItems: 32, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9][a-z0-9_-]*$" } });
    expect(grant.properties.allowedProfileIds).toEqual({ type: "array", minItems: 1, maxItems: 64, uniqueItems: true, items: { $ref: "#/components/schemas/Id" } });
    expect(grant.properties.maxStorageGiB).toEqual({ type: "integer", minimum: 1, maximum: 1_048_576 });
    expect(grant.properties.maxUptimeSeconds).toEqual({ type: "integer", minimum: 1, maximum: 31_536_000 });
    expect(grant.properties.maxBudgetMicros).toEqual({ type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
    expect(grant.properties.limit).toEqual({ type: "integer", minimum: 1, maximum: 1000 });
    const manifest = JSON.parse(readFileSync("schemas/surface-parity.json", "utf8")) as { mcpTools: string[] };
    expect(manifest.mcpTools).toEqual(SAFE_MCP_TOOLS.map((tool) => tool.name));
  });
});
