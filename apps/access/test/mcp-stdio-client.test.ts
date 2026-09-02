import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as mcp from "../src/mcp/index.js";
import { CORE_ROUTES, type CoreOperation } from "../src/client/index.js";
import { authorizeMcpRequest, handleMcpHttpRequest } from "../src/mcp/http.js";
import { cleanupTestDatabase, useTestDatabase } from "./helpers/database.js";

const configuration = () => ({ HASNA_ACCESS_API_URL: "https://access.example.test/prefix", HASNA_ACCESS_API_KEY: ["stdio", "test", "credential"].join("-") });
const operations: Record<string, CoreOperation> = {
  list_audit: "audit.list", verify_audit: "audit.verify",
  list_credentials: "credential.list", register_credential: "credential.register", get_credential: "credential.get", revoke_credential: "credential.revoke",
  list_elevations: "elevation.list", request_elevation: "elevation.request", expire_elevations: "elevation.expire", get_elevation: "elevation.get", approve_elevation: "elevation.approve", revoke_elevation: "elevation.revoke",
  list_identities: "identity.list", create_identity: "identity.create", get_identity: "identity.get", update_identity: "identity.update", suspend_identity: "identity.suspend", retire_identity: "identity.retire",
  list_requests: "request.list", create_request: "request.create", get_request: "request.get", approve_request: "request.approve", provision_request: "request.provision", fail_request: "request.fail", cancel_request: "request.cancel",
  list_reviews: "review.list", schedule_review: "review.schedule", get_review: "review.get", start_review: "review.start", complete_review: "review.complete", cancel_review: "review.cancel",
  list_revocations: "revocation.list", execute_revocation: "revocation.execute",
  list_scopes: "scope.list", grant_scope: "scope.grant", effective_scopes: "scope.effective", get_scope: "scope.get", revoke_scope: "scope.revoke",
  list_tokens: "token.list", issue_token: "token.issue", verify_token: "token.verify", get_token: "token.get", revoke_token: "token.revoke",
};
const alwaysOn = ["register_agent", "heartbeat", "set_focus", "send_feedback", "access_storage_status", "access_storage_push", "access_storage_pull", "access_storage_sync"];
const sessions: Array<{ client: Client; server: McpServer }> = [];
const previousProfile = process.env.ACCESS_PROFILE;
afterEach(async () => {
  if (previousProfile === undefined) delete process.env.ACCESS_PROFILE; else process.env.ACCESS_PROFILE = previousProfile;
  for (const { client, server } of sessions.splice(0)) { await client.close(); await server.close(); }
});

async function connect(server: McpServer) {
  const client = new Client({ name: "stdio-domain-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  sessions.push({ client, server });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function sample(schema: Record<string, any>): unknown {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.type === "boolean") return true;
  if (schema.type === "number" || schema.type === "integer") return 1;
  if (schema.type === "array") return [sample(schema.items)];
  if (schema.type === "object") return {};
  return "test-id";
}

describe("canonical stdio domain executor", () => {
  test("all 43 tools retain schemas and dispatch their HTTPS operation asynchronously", async () => {
    process.env.ACCESS_PROFILE = "full";
    const requests: Array<{ url: URL; init: RequestInit }> = [];
    const server = mcp.buildStdioServer(configuration(), (async (url, init) => {
      await Promise.resolve();
      requests.push({ url: new URL(String(url)), init: init! });
      return Response.json({ result: requests.length, async: true });
    }) as typeof fetch);
    const client = await connect(server);
    const legacy = await connect(mcp.buildServer());
    const listed = await client.listTools();
    expect(listed).toEqual(await legacy.listTools());
    expect(Object.values(operations).sort()).toEqual(Object.keys(CORE_ROUTES).sort());
    expect(listed.tools).toHaveLength(51);
    for (const tool of listed.tools.filter(tool => Object.hasOwn(operations, tool.name))) {
      const schema = tool.inputSchema;
      const args = Object.fromEntries((schema.required ?? []).map(key => [key, sample(schema.properties![key] as Record<string, any>)]));
      const write = Object.hasOwn(schema.properties!, "confirm");
      if (write) Object.assign(args, { confirm: true, confirmation_reason: "reviewed", idempotency_key: "test-only" });
      const result = await client.callTool({ name: tool.name, arguments: args });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ result: requests.length, async: true });
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(result.structuredContent) }]);
      const { url, init } = requests.at(-1)!;
      const [method, path] = CORE_ROUTES[operations[tool.name]!];
      expect(init.method).toBe(method);
      expect(url.origin + url.pathname).toBe(`https://access.example.test/prefix/v1${path.replace(":id", "test-id")}`);
      expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${configuration().HASNA_ACCESS_API_KEY}`);
      expect(init.redirect).toBe("error");
      const payload = init.body ? JSON.parse(String(init.body)) : Object.fromEntries(url.searchParams);
      for (const key of ["confirm", "confirmation_reason", "idempotency_key"]) expect(payload).not.toHaveProperty(key);
      const { confirm: _confirm, confirmation_reason: _reason, idempotency_key: _key, ...expected } = args;
      if (path.includes(":id")) delete expected.id;
      expect(payload).toEqual(expected);
    }
    expect(requests).toHaveLength(43);
  });

  for (const [profile, total, domains] of [["minimal", 18, 10], ["standard", 37, 29], ["full", 51, 43]] as const) {
    test(`${profile} preserves ${total} tools including all eight remaining local tools`, async () => {
      process.env.ACCESS_PROFILE = profile;
      const client = await connect(mcp.buildStdioServer(configuration()));
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(total);
      expect(tools.filter(tool => Object.hasOwn(operations, tool.name))).toHaveLength(domains);
      expect(tools.filter(tool => !Object.hasOwn(operations, tool.name)).map(tool => tool.name).sort()).toEqual([...alwaysOn].sort());
    });
  }

  test("every write requires confirmation before any network dispatch", async () => {
    process.env.ACCESS_PROFILE = "full";
    let calls = 0;
    const client = await connect(mcp.buildStdioServer(configuration(), (async () => { calls++; return Response.json({}); }) as typeof fetch));
    for (const tool of (await client.listTools()).tools.filter(tool => Object.hasOwn(operations, tool.name) && Object.hasOwn(tool.inputSchema.properties!, "confirm"))) {
      const args = Object.fromEntries((tool.inputSchema.required ?? []).filter(key => key !== "confirm").map(key => [key, sample(tool.inputSchema.properties![key] as Record<string, any>)]));
      for (const confirmation of [{}, { confirm: false }]) {
        const result = await client.callTool({ name: tool.name, arguments: { ...args, ...confirmation } });
        expect(JSON.stringify(result)).toContain("MCP_CONFIRMATION_REQUIRED");
      }
    }
    expect(calls).toBe(0);
  });

  test("optional arrays, numeric versions and metadata survive the async executor", async () => {
    const requests: Array<{ url: URL; init: RequestInit }> = [];
    const env = configuration();
    const client = await connect(mcp.buildStdioServer(env, (async (url, init) => {
      requests.push({ url: new URL(String(url)), init: init! });
      return Response.json({ ok: true });
    }) as typeof fetch));
    env.HASNA_ACCESS_API_URL = "https://changed.example.test";
    env.HASNA_ACCESS_API_KEY = "changed";
    await client.callTool({ name: "approve_request", arguments: { id: "request-id", expected_version: 3, decision_metadata: { reviewed: true }, confirm: true } });
    expect(JSON.parse(String(requests[0]!.init.body))).toEqual({ expected_version: 3, decision_metadata: { reviewed: true } });
    await client.callTool({ name: "issue_token", arguments: { identity_id: "identity-id", scopes: ["access:read"], entity_ids: ["entity-id"], ttl_minutes: 2, confirm: true } });
    expect(JSON.parse(String(requests[1]!.init.body))).toEqual({ identity_id: "identity-id", scopes: ["access:read"], entity_ids: ["entity-id"], ttl_minutes: 2 });
    await client.callTool({ name: "list_identities", arguments: { limit: 7, offset: 2 } });
    expect(Object.fromEntries(requests[2]!.url.searchParams)).toEqual({ limit: "7", offset: "2" });
    for (const { url, init } of requests) {
      expect(url.origin).toBe("https://access.example.test");
      expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${configuration().HASNA_ACCESS_API_KEY}`);
    }
  });

  test("invalid configuration fails before tools can dispatch", () => {
    let calls = 0;
    const fetcher = (async () => { calls++; return Response.json({}); }) as typeof fetch;
    for (const env of [{}, { ...configuration(), HASNA_ACCESS_API_KEY: "" }, { ...configuration(), HASNA_ACCESS_API_URL: "http://example.test" }, { ...configuration(), ACCESS_API_KEY: "different" }, { ...configuration(), HASNA_ACCESS_DATABASE_URL: "" }]) {
      expect(() => mcp.buildStdioServer(env, fetcher)).toThrow();
    }
    expect(calls).toBe(0);
  });

  for (const [code, status] of [["VERSION_CONFLICT", 409], ["PERMISSION_DENIED", 403]] as const) {
    test(`awaits and redacts remote ${code} failures`, async () => {
      const marker = configuration().HASNA_ACCESS_API_KEY;
      const client = await connect(mcp.buildStdioServer(configuration(), (async () => {
        await Promise.resolve();
        return Response.json({ code, message: marker, suggestion: marker }, { status });
      }) as typeof fetch));
      const result = await client.callTool({ name: "list_identities", arguments: {} });
      expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text).code).toBe(code);
      expect(JSON.stringify(result)).not.toContain(marker);
    });
  }

  test("HTTP caller path cannot acquire the process-owner HTTPS credential", async () => {
    const entityId = "00000000-0000-4000-8000-000000000001";
    const previousDbPath = process.env.HASNA_ACCESS_DB_PATH;
    const dbPath = useTestDatabase("access-stdio-http-isolation");
    const saved = { apiUrl: process.env.HASNA_ACCESS_API_URL, apiKey: process.env.HASNA_ACCESS_API_KEY, credentials: process.env.HASNA_ACCESS_API_CREDENTIALS };
    const originalFetch = globalThis.fetch;
    let calls = 0;
    try {
      Object.assign(process.env, configuration(), { HASNA_ACCESS_API_CREDENTIALS: JSON.stringify([{ id: "http-viewer", token: "http-viewer-fixture", roles: ["auditor"], scopes: ["access:read"], entity_ids: [entityId] }]) });
      globalThis.fetch = (async () => { calls++; throw new Error("Unexpected owner dispatch"); }) as typeof fetch;
      const request = new Request("http://localhost/mcp", {
        method: "POST", headers: { Authorization: "Bearer http-viewer-fixture", "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_identity", arguments: { entity_id: entityId, kind: "agent", name: "denied", confirm: true } } }),
      });
      const outcome = authorizeMcpRequest(request);
      expect(outcome.ok).toBe(true);
      expect(outcome.context?.bypass).toBeUndefined();
      expect(outcome.context?.roles).toEqual(["auditor"]);
      expect(outcome.context?.scopes).toEqual(["access:read"]);
      const response = await handleMcpHttpRequest(request, outcome.context!);
      const text = await response.text();
      expect(text).toContain("PERMISSION_DENIED");
      expect(text).not.toContain(configuration().HASNA_ACCESS_API_KEY);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
      cleanupTestDatabase(dbPath);
      if (previousDbPath !== undefined) process.env.HASNA_ACCESS_DB_PATH = previousDbPath;
      for (const [name, value] of Object.entries({ HASNA_ACCESS_API_URL: saved.apiUrl, HASNA_ACCESS_API_KEY: saved.apiKey, HASNA_ACCESS_API_CREDENTIALS: saved.credentials })) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });

  test("manifest has no install lifecycle and preserves all package entrypoints", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    for (const hook of ["preinstall", "install", "postinstall"]) expect(pkg.scripts).not.toHaveProperty(hook);
    expect(Object.keys(pkg.bin).sort()).toEqual(["access", "access-mcp", "access-serve"]);
    expect(pkg.exports["./sdk"].import).toBe("./dist/client/index.js");
    expect(pkg.exports["."].import).toBe("./dist/index.js");
    const migration = JSON.parse(readFileSync(new URL("../hasna.contract.json", import.meta.url), "utf8")).metadata.canonicalMigration;
    expect(migration.status).toBe("partial");
    expect(migration.completedSurfaces).toContain("stdio-mcp-domain");
    expect(migration.completedSurfaces).toContain("postinstall-removal");
    expect(migration.remainingSurfaces).toContain("http-mcp");
    expect(migration.remainingSurfaces).toContain("mcp-standard-storage");
  });
});
