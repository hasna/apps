// Regression tests for todos edec8757: the legacy /api/* surface was reachable
// WITHOUT authentication in cloud (Postgres) mode. handleV1() returns null for
// non-/v1 paths and execution fell straight through to the unauthenticated
// legacy routes — including POST /api/workflows, whose `execution.setupCommand`
// runs verbatim inside the e2b/docker sandbox that receives the dataset API
// key. A remote attacker could therefore mint workflows that execute arbitrary
// commands in a credential-bearing sandbox.
//
// The fix gates the whole legacy /api/* surface with the same API-key
// authenticate() the /v1 surface uses, and the server binds loopback by default
// (TESTERS_HOST) so local SQLite dashboard use stays open. These tests prove:
//   - cloud mode: /api/* rejects unauthenticated requests with 401;
//   - cloud mode: public probes (/health /version /openapi.json) and OPTIONS
//     preflight stay open;
//   - local mode (no DATABASE_URL): /api/* still works without auth (the
//     loopback default bind is the protection there);
//   - a validly-signed key is judged on its revocation status (fail-closed 503
//     when the status store is unreachable), never "auth unavailable".
//
// The full "authenticated request succeeds" lane needs a live Postgres to hold
// the issued key record, so it runs under TESTERS_PG_TEST_URL (skipped
// otherwise), mirroring the repo's `.pg.test.ts` convention.

process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { mintApiKey, ApiKeyStore, apiKeyMigrations } from "@hasna/contracts/auth";
import { createQueryClient } from "../generated/storage-kit/query.js";

const SIGNING_KEY = "testers-regression-signing-secret-0000";
// Port 1 refuses connections instantly; the pg pool construction is lazy, so
// the server boots and only the per-request key-status lookup fails.
const UNREACHABLE_DB = "postgres://testers:testers@127.0.0.1:1/testers";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a test port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitUntilReady(baseUrl: string, path: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}${path}`);
      if (res.status === 200) return;
    } catch {
      // not ready yet
    }
    await Bun.sleep(100);
  }
  throw new Error(`Server did not become ready: ${baseUrl}${path}`);
}

function startServer(port: number, extraEnv: Record<string, string | undefined>): Subprocess {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.TESTERS_DB_PATH = ":memory:";
  env.TESTERS_PORT = String(port);
  // An `undefined` value deletes the key from the child env, so a test can
  // assert behavior with a variable explicitly UNSET (never inherited).
  for (const [key, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return spawn({
    cmd: ["bun", "run", new URL("./index.ts", import.meta.url).pathname],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function workflowBody(setupCommand: string): string {
  return JSON.stringify({
    name: "auth-regression-workflow",
    execution: { target: "sandbox", setupCommand },
  });
}

describe("legacy /api/* in cloud mode (DATABASE_URL set, signing key set)", () => {
  let serverProc: Subprocess;
  let baseUrl: string;

  beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProc = startServer(port, {
      HASNA_TESTERS_DATABASE_URL: UNREACHABLE_DB,
      HASNA_TESTERS_API_SIGNING_KEY: SIGNING_KEY,
    });
    // /api/status is itself gated now; readiness is probed on the open /health.
    await waitUntilReady(baseUrl, "/health");
  }, 15_000);

  afterAll(() => {
    serverProc.kill();
  });

  test("unauthenticated POST /api/workflows with execution.setupCommand returns 401", async () => {
    const res = await fetch(`${baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: workflowBody("echo SECP0_EXFIL > /tmp/pwned.txt"),
    });
    expect(res.status).toBe(401);
  });

  test("unauthenticated GET /api/stats and /api/scenarios return 401", async () => {
    expect((await fetch(`${baseUrl}/api/stats`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/scenarios`)).status).toBe(401);
  });

  test("public probes stay open: /health, /version, /openapi.json", async () => {
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/version`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/openapi.json`)).status).toBe(200);
  });

  test("CORS preflight OPTIONS stays open", async () => {
    const res = await fetch(`${baseUrl}/api/workflows`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("a validly-signed key passes signature verification and fails closed (503) when the status store is unreachable", async () => {
    const minted = mintApiKey({
      app: "testers",
      scopes: ["testers:read", "testers:write"],
      signingSecret: SIGNING_KEY,
    });
    const res = await fetch(`${baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": minted.token },
      body: workflowBody("echo authed > /tmp/authed.txt"),
    });
    // Not 401 (token accepted at signature level), not 503 "auth unavailable"
    // (verifier constructed), but the fail-closed revocation-store denial.
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("Could not verify API key status");
  });
});

describe("legacy /api/* in local mode (no DATABASE_URL) stays open", () => {
  let serverProc: Subprocess;
  let baseUrl: string;

  beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProc = startServer(port, {});
    await waitUntilReady(baseUrl, "/api/status");
  }, 15_000);

  afterAll(() => {
    serverProc.kill();
  });

  test("unauthenticated POST /api/workflows succeeds locally (loopback is the local protection)", async () => {
    const res = await fetch(`${baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: workflowBody("echo local > /tmp/local.txt"),
    });
    expect(res.status).toBe(201);
  });
});

const TESTERS_PG_TEST_URL = process.env.TESTERS_PG_TEST_URL;

describe.skipIf(!TESTERS_PG_TEST_URL)("legacy /api/* authenticated with a live Postgres key store", () => {
  let serverProc: Subprocess;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    // Issue a real key record in the test database, mirroring `testers` key
    // issuance (ApiKeyStore persists the minted key's hash).
    const pool = new Pool({ connectionString: TESTERS_PG_TEST_URL, max: 4 });
    const client = createQueryClient(pool);
    const store = new ApiKeyStore(client);
    for (const migration of apiKeyMigrations()) {
      await client.execute(migration.sql);
    }
    const minted = mintApiKey({
      app: "testers",
      scopes: ["testers:read", "testers:write"],
      signingSecret: SIGNING_KEY,
    });
    await store.insertMinted(minted, "api-auth.test.ts");
    token = minted.token;
    await pool.end();

    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProc = startServer(port, {
      HASNA_TESTERS_DATABASE_URL: TESTERS_PG_TEST_URL!,
      HASNA_TESTERS_API_SIGNING_KEY: SIGNING_KEY,
    });
    await waitUntilReady(baseUrl, "/health");
  }, 20_000);

  afterAll(() => {
    serverProc.kill();
  });

  test("unauthenticated POST /api/workflows still returns 401", async () => {
    const res = await fetch(`${baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: workflowBody("echo blocked > /tmp/blocked.txt"),
    });
    expect(res.status).toBe(401);
  });

  test("authenticated POST /api/workflows with execution.setupCommand succeeds (201)", async () => {
    const res = await fetch(`${baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": token },
      body: workflowBody("echo SECP0_EXFIL > /tmp/pwned.txt"),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("auth-regression-workflow");
    expect(body.execution).toMatchObject({
      target: "sandbox",
      setupCommand: "echo SECP0_EXFIL > /tmp/pwned.txt",
    });
  });

  test("authenticated GET /api/stats succeeds (testers:read scope)", async () => {
    const res = await fetch(`${baseUrl}/api/stats`, {
      headers: { "x-api-key": token },
    });
    expect(res.status).toBe(200);
  });
});

// ── O15-00414: the signing key must never have a committed fallback ─────────
// The auth gate authenticates purely by symmetric HMAC with the signing key
// (verifyApiKeyToken), so a defaulted constant in docker-compose.yml made the
// whole API-key system forgeable by anyone who reads the repo: an offline
// attacker could mint tokens carrying arbitrary scopes that pass signature
// verification. The compose file now requires the variable
// (${HASNA_TESTERS_API_SIGNING_KEY:?...}) so a deployment without an operator
// key fails fast, restoring the server's own fail-closed guard (the auth
// gate throws "API-key signing secret missing" when no key resolves).
describe("docker-compose.yml requires the API signing key", () => {
  test("no defaulted signing secret and no literal fallback value in the compose file", () => {
    const text = readFileSync(
      new URL("../../docker-compose.yml", import.meta.url),
      "utf8",
    );
    const signingLine = text
      .split("\n")
      .find((line) => line.includes("HASNA_TESTERS_API_SIGNING_KEY"));
    expect(
      signingLine,
      "docker-compose.yml must reference HASNA_TESTERS_API_SIGNING_KEY",
    ).toBeTruthy();
    if (!signingLine) return;
    // Required form: ${HASNA_TESTERS_API_SIGNING_KEY:?...} — compose refuses
    // to start the service when the operator did not supply the key.
    expect(signingLine).toContain("${HASNA_TESTERS_API_SIGNING_KEY:?");
    // Defaulted form: ${HASNA_TESTERS_API_SIGNING_KEY:-...} — the defect.
    expect(signingLine).not.toContain("${HASNA_TESTERS_API_SIGNING_KEY:-");
    expect(text).not.toContain("dev-signing-secret-change-me");
  });
});

describe("cloud mode with NO signing key configured fails closed (O15-00414)", () => {
  let serverProc: Subprocess;
  let baseUrl: string;

  beforeAll(async () => {
    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProc = startServer(port, {
      HASNA_TESTERS_DATABASE_URL: UNREACHABLE_DB,
      // Delete every key the server could resolve, so a CI box carrying a
      // stray API_KEY_SIGNING_SECRET cannot make this test vacuous.
      HASNA_TESTERS_API_SIGNING_KEY: undefined,
      API_KEY_SIGNING_SECRET: undefined,
      HASNA_API_SIGNING_KEY: undefined,
    });
    await waitUntilReady(baseUrl, "/health");
  }, 15_000);

  afterAll(() => {
    serverProc.kill();
  });

  test("a gated request is denied (503): the auth gate fails closed instead of accepting a token", async () => {
    const res = await fetch(`${baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: workflowBody("echo nokey > /tmp/nokey.txt"),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("signing secret missing");
  });
});
