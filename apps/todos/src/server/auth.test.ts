import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiKey } from "../db/api-keys.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import {
  SERVER_HOOK_BUDGET_MS,
  SERVER_STOP_BUDGET_MS,
  startTestServer,
  type TestServer,
} from "../test/server-harness.js";

let server: TestServer;
let tmpDir: string;
let dbPath: string;
let apiKey: string;

function url(path: string): string {
  return server.url(path);
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "todos-server-auth-test-"));
  dbPath = join(tmpDir, "test.db");

  const oldDbPath = process.env["TODOS_DB_PATH"];
  process.env["TODOS_DB_PATH"] = dbPath;
  resetDatabase();
  getDatabase();
  apiKey = createApiKey({ name: "integration app" }).key;
  closeDatabase();
  resetDatabase();
  if (oldDbPath === undefined) delete process.env["TODOS_DB_PATH"];
  else process.env["TODOS_DB_PATH"] = oldDbPath;

  // No `--allow-anonymous`: this suite exercises the credential boundary itself,
  // so the server must come up with the generated key seeded above as its only
  // way in.
  server = await startTestServer({
    env: { TODOS_DB_PATH: dbPath, TODOS_AUTO_PROJECT: "false" },
  });
}, SERVER_HOOK_BUDGET_MS);

afterAll(async () => {
  await server?.stop();
  await rm(tmpDir, { recursive: true, force: true });
}, SERVER_STOP_BUDGET_MS);

describe("API key authentication", () => {
  it("rejects API requests without a generated key", async () => {
    const res = await fetch(url("/api/health"));
    expect(res.status).toBe(401);
  });

  it("rejects API requests with the wrong generated key", async () => {
    const res = await fetch(url("/api/health"), { headers: { "x-api-key": "tdos_wrong" } });
    expect(res.status).toBe(401);
  });

  it("accepts generated keys via x-api-key", async () => {
    const res = await fetch(url("/api/health"), { headers: { "x-api-key": apiKey } });
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data.status).toBe("ok");
  });

  it("accepts generated keys via bearer authorization", async () => {
    const res = await fetch(url("/api/health"), { headers: { authorization: `Bearer ${apiKey}` } });
    expect(res.status).toBe(200);
  });
});

// ── H1: the /mcp transport must be gated by the same auth as /api/* ──
describe("MCP HTTP endpoint authentication", () => {
  const mcpBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  const mcpHeaders = (extra: Record<string, string> = {}) => ({
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    ...extra,
  });

  it("rejects unauthenticated POST /mcp with 401", async () => {
    const res = await fetch(url("/mcp"), { method: "POST", headers: mcpHeaders(), body: mcpBody });
    expect(res.status).toBe(401);
  });

  it("rejects POST /mcp with a wrong key", async () => {
    const res = await fetch(url("/mcp"), {
      method: "POST",
      headers: mcpHeaders({ "x-api-key": "tdos_wrong" }),
      body: mcpBody,
    });
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated GET /mcp with 401", async () => {
    const res = await fetch(url("/mcp"), { method: "GET", headers: mcpHeaders() });
    expect(res.status).toBe(401);
  });

  it("allows POST /mcp past the auth boundary with a valid key", async () => {
    const res = await fetch(url("/mcp"), {
      method: "POST",
      headers: mcpHeaders({ "x-api-key": apiKey }),
      body: mcpBody,
    });
    // Past auth: the MCP transport handles it. Whatever it returns, it must not
    // be the 401 an unauthenticated caller would get.
    expect(res.status).not.toBe(401);
  });
});
