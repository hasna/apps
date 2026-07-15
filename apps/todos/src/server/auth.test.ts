import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiKey } from "../db/api-keys.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

let port: number;
let proc: ReturnType<typeof Bun.spawn>;
let tmpDir: string;
let dbPath: string;
let apiKey: string;

function url(path: string): string {
  return `http://localhost:${port}${path}`;
}

beforeAll(async () => {
  port = 19550 + Math.floor(Math.random() * 100);
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

  proc = Bun.spawn({
    cmd: ["bun", "run", "src/server/index.ts", `--port=${port}`, "--no-open"],
    cwd: join(import.meta.dir, "..", ".."),
    env: localRoutingTestEnv({ TODOS_DB_PATH: dbPath, TODOS_AUTO_PROJECT: "false", TODOS_NO_OPEN: "true" }),
    stdout: "pipe",
    stderr: "pipe",
  });

  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(url("/api/health"), { headers: { "x-api-key": apiKey } });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error(`Auth test server did not start on port ${port}`);
}, 15_000);

afterAll(async () => {
  proc.kill();
  await proc.exited;
  await rm(tmpDir, { recursive: true, force: true });
}, 15_000);

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
