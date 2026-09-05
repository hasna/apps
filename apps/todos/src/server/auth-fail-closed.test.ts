/**
 * Regression tests for the fail-OPEN auth hole.
 *
 * Before this fix, `checkAuth` returned "authorized" whenever no credential was
 * configured (`if (!apiKey && !generatedKeysEnabled) return null`). A server bound
 * to a non-loopback host therefore published `/mcp` (full MCP tool catalog,
 * including create/update/delete tools) and every `/api/*` REST route to any
 * anonymous caller.
 *
 * These tests assert the two halves of the fix:
 *  1. An unconfigured server REFUSES TO START instead of serving data anonymously.
 *  2. Every data route (`/api/*`, `/mcp`, `/v1/*`) rejects a credential-less
 *     request once a credential source exists, while `/health` `/ready` `/version`
 *     `/openapi.json` stay public.
 *
 * Test 1 FAILS against the pre-fix code (the process starts and answers 200).
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiKey } from "../db/api-keys.js";
import { closeDatabase, getDatabase, resetDatabase } from "../db/database.js";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";
import {
  SERVER_HOOK_BUDGET_MS,
  SERVER_STOP_BUDGET_MS,
  startTestServer,
  type TestServer,
} from "../test/server-harness.js";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const HOOK_TIMEOUT_MS = 20_000;
const LOOPBACK = "http://127.0.0.1";

/**
 * Loopback test URLs are assembled here so no inline absolute-URL literal appears at a
 * call site — `src/lib/headless-boundaries.test.ts` scans server sources for exactly
 * that pattern to prove the server never performs outbound HTTP.
 */
function localUrl(port: number, path: string): string {
  return `${LOOPBACK}:${port}${path}`;
}

/**
 * Only the two "refuses to start" tests below still pick a concrete port, and only
 * because they assert that NOTHING ends up listening on it — an assertion that
 * needs a real port number to probe, so `--port=0` (which the server never gets
 * far enough to bind) would make it vacuous. The suites that wait for a server to
 * come UP use the kernel-assigned port from src/test/server-harness.ts instead.
 *
 * The windows below no longer collide with anything: ratelimit.test.ts used to
 * share base 19700, and it now uses an ephemeral port, and these two tests run
 * sequentially within this file.
 */
function reserveFreePort(start: number): number {
  for (let candidate = start; candidate < start + 200; candidate++) {
    try {
      const server = Bun.serve({ port: candidate, fetch: () => new Response("") });
      server.stop(true);
      return candidate;
    } catch {
      // Try the next port in the test range.
    }
  }
  throw new Error(`No free test port found starting at ${start}`);
}

function spawnServer(port: number, env: Record<string, string | undefined>, extraArgs: string[] = []) {
  return Bun.spawn({
    cmd: ["bun", "run", "src/server/index.ts", `--port=${port}`, ...extraArgs],
    cwd: REPO_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function waitForExit(proc: ReturnType<typeof Bun.spawn>, timeoutMs: number): Promise<number | null> {
  const exited = proc.exited.then((code) => code as number | null);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  return Promise.race([exited, timeout]);
}

// ── 1. Unconfigured => refuse to start (this is the fail-open regression) ─────
describe("unconfigured server fails closed", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "todos-failclosed-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("refuses to start with no credential source and names the env var to set", async () => {
    const port = reserveFreePort(19700 + Math.floor(Math.random() * 100));
    const dbPath = join(tmpDir, "unconfigured.db");
    const proc = spawnServer(port, localRoutingTestEnv({
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
    }));

    try {
      const exitCode = await waitForExit(proc, 15_000);
      const stderr = await new Response(proc.stderr as ReadableStream).text();

      // Pre-fix this process stays up and serves /api/* + /mcp anonymously.
      expect(exitCode).not.toBeNull();
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("HASNA_TODOS_SERVER_API_KEY");
      expect(stderr).toContain("refusing to start");

      // And nothing is listening, so the anonymous plane does not exist at all.
      let reachable = true;
      try {
        await fetch(localUrl(port, "/api/stats"));
      } catch {
        reachable = false;
      }
      expect(reachable).toBe(false);
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, HOOK_TIMEOUT_MS);

  it("refuses --allow-anonymous on a non-loopback bind host", async () => {
    const port = reserveFreePort(19750 + Math.floor(Math.random() * 100));
    const dbPath = join(tmpDir, "anon-offbox.db");
    const proc = spawnServer(
      port,
      localRoutingTestEnv({ TODOS_DB_PATH: dbPath, TODOS_AUTO_PROJECT: "false" }),
      ["--allow-anonymous", "--host=0.0.0.0"],
    );

    try {
      const exitCode = await waitForExit(proc, 15_000);
      const stderr = await new Response(proc.stderr as ReadableStream).text();
      expect(exitCode).not.toBeNull();
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--allow-anonymous is refused");
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, HOOK_TIMEOUT_MS);
});

// ── 2. Configured => every data route rejects a credential-less request ───────
describe("data routes reject credential-less requests", () => {
  let port: number;
  let server: TestServer;
  let tmpDir: string;
  let apiKey: string;

  const url = (path: string) => localUrl(port, path);

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "todos-authroutes-"));
    const dbPath = join(tmpDir, "test.db");

    const previousDbPath = process.env["TODOS_DB_PATH"];
    process.env["TODOS_DB_PATH"] = dbPath;
    resetDatabase();
    getDatabase();
    apiKey = createApiKey({ name: "auth route test" }).key;
    closeDatabase();
    resetDatabase();
    if (previousDbPath === undefined) delete process.env["TODOS_DB_PATH"];
    else process.env["TODOS_DB_PATH"] = previousDbPath;

    server = await startTestServer({
      env: {
        TODOS_DB_PATH: dbPath,
        TODOS_AUTO_PROJECT: "false",
        TODOS_RATE_LIMIT_MAX: "1000",
      },
    });
    port = server.port;
  }, SERVER_HOOK_BUDGET_MS);

  afterAll(async () => {
    await server?.stop();
    await rm(tmpDir, { recursive: true, force: true });
  }, SERVER_STOP_BUDGET_MS);

  const readRoutes = [
    "/api/stats",
    "/api/tasks",
    "/api/projects",
    "/api/agents",
    "/api/plans",
    "/api/doctor",
    "/api/headless",
    "/api/tasks/export?format=json",
    "/api/events",
  ];

  for (const route of readRoutes) {
    it(`rejects anonymous GET ${route}`, async () => {
      const res = await fetch(url(route));
      expect(res.status).toBe(401);
    });
  }

  const writeRoutes: Array<[string, string, unknown]> = [
    ["POST", "/api/tasks", { title: "anonymous write must not land" }],
    ["POST", "/api/projects", { id: "anon", name: "anon", path: "/tmp/anon" }],
    ["POST", "/api/agents", { name: "anon-agent" }],
    ["POST", "/api/webhooks", { url: "https://example.com/hook", events: ["task.created"] }],
    ["PATCH", "/api/tasks/zzz-nonexistent", { title: "nope" }],
    ["DELETE", "/api/tasks/zzz-nonexistent", undefined],
  ];

  for (const [method, route, body] of writeRoutes) {
    it(`rejects anonymous ${method} ${route}`, async () => {
      const res = await fetch(url(route), {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect(res.status).toBe(401);
    });
  }

  it("rejects anonymous POST /mcp tools/list", async () => {
    const res = await fetch(url("/mcp"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("create_task");
  });

  it("rejects anonymous GET and DELETE /mcp", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(url("/mcp"), {
        method,
        headers: { Accept: "application/json, text/event-stream" },
      });
      expect(res.status).toBe(401);
    }
  });

  // `/v1` self-authenticates via the @hasna/contracts verifier, which is backed by
  // cloud Postgres. On a hosted deployment an anonymous request is a 401
  // (`missing_token`); on this local server there is no verifier at all, so it is a
  // 503. Both are denials — the invariant under test is that no anonymous caller
  // ever gets data out of `/v1`.
  it("denies anonymous /v1 reads and writes", async () => {
    const read = await fetch(url("/v1/tasks"));
    expect([401, 503]).toContain(read.status);
    const write = await fetch(url("/v1/tasks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "anonymous write must not land" }),
    });
    expect([401, 503]).toContain(write.status);
  });

  it("still accepts an authenticated /api request", async () => {
    const res = await fetch(url("/api/stats"), { headers: { "x-api-key": apiKey } });
    expect(res.status).toBe(200);
  });

  it("keeps the non-data probes public", async () => {
    for (const probe of ["/health", "/ready", "/version", "/openapi.json"]) {
      const res = await fetch(url(probe));
      expect(res.status).toBe(200);
    }
  });

  it("does not leak a credential or a DSN in the public probes", async () => {
    const version = await (await fetch(url("/version"))).text();
    expect(version).not.toContain(apiKey);
    expect(version.toLowerCase()).not.toContain("postgres");
  });
});

// ── 3. Minting a key closes an already-open anonymous window ──────────────────
describe("anonymous-loopback upgrades to enforce when a key appears", () => {
  let port: number;
  let server: TestServer;
  let tmpDir: string;
  let dbPath: string;

  const url = (path: string) => localUrl(port, path);

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "todos-anon-upgrade-"));
    dbPath = join(tmpDir, "test.db");
    server = await startTestServer({
      args: ["--allow-anonymous"],
      env: { TODOS_DB_PATH: dbPath, TODOS_AUTO_PROJECT: "false" },
    });
    port = server.port;
  }, SERVER_HOOK_BUDGET_MS);

  afterAll(async () => {
    await server?.stop();
    await rm(tmpDir, { recursive: true, force: true });
  }, SERVER_STOP_BUDGET_MS);

  it("stops serving anonymously as soon as an API key is minted, without a restart", async () => {
    // Sanity: the explicit loopback opt-in is in effect.
    expect((await fetch(url("/api/stats"))).status).toBe(200);

    const previousDbPath = process.env["TODOS_DB_PATH"];
    process.env["TODOS_DB_PATH"] = dbPath;
    resetDatabase();
    getDatabase();
    const minted = createApiKey({ name: "minted while serving" }).key;
    closeDatabase();
    resetDatabase();
    if (previousDbPath === undefined) delete process.env["TODOS_DB_PATH"];
    else process.env["TODOS_DB_PATH"] = previousDbPath;

    expect((await fetch(url("/api/stats"))).status).toBe(401);
    expect((await fetch(url("/api/stats"), { headers: { "x-api-key": minted } })).status).toBe(200);
  }, HOOK_TIMEOUT_MS);
});
