/**
 * Live-PostgreSQL regression for OPE21-00033: the hosted testers backend 404'd
 * on result recording ("upstream testers backend POST /results -> 404", QA
 * HARD STOP 2026-08-29). The client's ApiStore.createResult/updateResult have
 * POSTed /v1/results and PUT /v1/results/:id since 2026-07-08 (9b62324f5),
 * but the /v1 server (2289f8b36) only ever routed GET /v1/results/:id — the
 * write half of the results contract was never implemented, so a sandboxed
 * runner resolved to the hosted store 404'd the moment it recorded a result.
 *
 * This test exercises the REAL server routes against a live Postgres: POST a
 * result (201), PUT its progress/final state (200), read it back (200), list
 * it under the run (200), and reject a missing runId (400).
 *
 * Convention mirrors src/server/personas-pagination.pg.test.ts: runs only
 * when TESTERS_PG_TEST_URL is set (skipped loudly otherwise).
 */
import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { createServer } from "node:net";
import { Pool } from "pg";
import { mintApiKey, ApiKeyStore, apiKeyMigrations } from "@hasna/contracts/auth";
import { createQueryClient } from "../generated/storage-kit/query.js";
import { runPgMigrations } from "../db/pg-migrate.js";

const SIGNING_KEY = "testers-results-write-signing-0000";
const TESTERS_PG_TEST_URL = process.env.TESTERS_PG_TEST_URL;

const RUN_ID = "11111111-1111-1111-1111-111111111111";
const SCENARIO_ID = "22222222-2222-2222-2222-222222222222";

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

async function waitUntilReady(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.status === 200) return;
    } catch {
      // not ready yet
    }
    await Bun.sleep(100);
  }
  throw new Error(`Server did not become ready: ${baseUrl}/health`);
}

describe.skipIf(!TESTERS_PG_TEST_URL)("POST/PUT/GET /v1/results with a live Postgres (OPE21-00033)", () => {
  let serverProc: Subprocess;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: TESTERS_PG_TEST_URL, max: 4 });
    const client = createQueryClient(pool);

    // Schema + api-key store + the FK targets the result row needs.
    await runPgMigrations(client);
    for (const migration of apiKeyMigrations()) {
      await client.execute(migration.sql);
    }
    // Idempotent seed: the suite may re-run against the same disposable DB
    // (the FK targets must exist; ON CONFLICT makes re-runs safe).
    await client.execute(
      `INSERT INTO scenarios (id, short_id, name) VALUES ($1, 'res-write-sc', 'results-write regression scenario')
       ON CONFLICT (id) DO NOTHING`,
      [SCENARIO_ID],
    );
    await client.execute(
      `INSERT INTO runs (id, status, url, model) VALUES ($1, 'running', 'https://example.com', 'quick')
       ON CONFLICT (id) DO NOTHING`,
      [RUN_ID],
    );

    const store = new ApiKeyStore(client);
    const minted = mintApiKey({
      app: "testers",
      scopes: ["testers:read", "testers:write"],
      signingSecret: SIGNING_KEY,
    });
    await store.insertMinted(minted, "results-write.pg.test.ts");
    token = minted.token;
    await pool.end();

    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    serverProc = spawn({
      cmd: ["bun", "run", new URL("./index.ts", import.meta.url).pathname],
      env: {
        ...process.env,
        TESTERS_DB_PATH: ":memory:",
        TESTERS_PORT: String(port),
        HASNA_TESTERS_DATABASE_URL: TESTERS_PG_TEST_URL,
        HASNA_TESTERS_API_SIGNING_KEY: SIGNING_KEY,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    await waitUntilReady(baseUrl);
  }, 30_000);

  afterAll(() => {
    serverProc?.kill();
  });

  test("POST /v1/results creates a result (201) — the route that 404'd before the fix", async () => {
    const res = await fetch(`${baseUrl}/v1/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": token },
      body: JSON.stringify({ runId: RUN_ID, scenarioId: SCENARIO_ID, model: "quick", stepsTotal: 3 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; runId: string; scenarioId: string; stepsTotal: number };
    expect(body.runId).toBe(RUN_ID);
    expect(body.scenarioId).toBe(SCENARIO_ID);
    expect(body.status).toBe("skipped");
    expect(body.stepsTotal).toBe(3);
    expect(typeof body.id).toBe("string");

    const res2 = await fetch(`${baseUrl}/v1/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": token },
      body: JSON.stringify({ runId: RUN_ID, scenarioId: SCENARIO_ID, model: "quick" }),
    });
    expect(res2.status).toBe(201);
    const body2 = (await res2.json()) as { id: string };
    expect(body2.id).not.toBe(body.id);
  });

  test("PUT /v1/results/:id persists the runner's progress/final state (200)", async () => {
    const created = (await (
      await fetch(`${baseUrl}/v1/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": token },
        body: JSON.stringify({ runId: RUN_ID, scenarioId: SCENARIO_ID, model: "quick", stepsTotal: 2 }),
      })
    ).json()) as { id: string };

    const res = await fetch(`${baseUrl}/v1/results/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-api-key": token },
      body: JSON.stringify({
        status: "passed",
        reasoning: "all steps green",
        stepsCompleted: 2,
        durationMs: 1500,
        tokensUsed: 42,
        costCents: 1,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string; reasoning: string; stepsCompleted: number; durationMs: number; tokensUsed: number };
    expect(body.id).toBe(created.id);
    expect(body.status).toBe("passed");
    expect(body.reasoning).toBe("all steps green");
    expect(body.stepsCompleted).toBe(2);
    expect(body.durationMs).toBe(1500);
    expect(body.tokensUsed).toBe(42);
  });

  test("GET /v1/results/:id reads back the persisted state (200)", async () => {
    const created = (await (
      await fetch(`${baseUrl}/v1/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": token },
        body: JSON.stringify({ runId: RUN_ID, scenarioId: SCENARIO_ID, model: "quick" }),
      })
    ).json()) as { id: string };
    await fetch(`${baseUrl}/v1/results/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-api-key": token },
      body: JSON.stringify({ status: "failed", error: "login gate rejected" }),
    });

    const res = await fetch(`${baseUrl}/v1/results/${created.id}`, {
      headers: { "x-api-key": token },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; status: string; error: string };
    expect(body.id).toBe(created.id);
    expect(body.status).toBe("failed");
    expect(body.error).toBe("login gate rejected");
  });

  test("GET /v1/runs/:id/results lists the created results (200)", async () => {
    await fetch(`${baseUrl}/v1/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": token },
      body: JSON.stringify({ runId: RUN_ID, scenarioId: SCENARIO_ID, model: "quick" }),
    });
    const res = await fetch(`${baseUrl}/v1/runs/${RUN_ID}/results`, {
      headers: { "x-api-key": token },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string }[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    for (const r of body) expect(r.runId).toBe(RUN_ID);
  });

  test("POST /v1/results with a missing runId rejects with 400", async () => {
    const res = await fetch(`${baseUrl}/v1/results`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": token },
      body: JSON.stringify({ scenarioId: SCENARIO_ID, model: "quick" }),
    });
    expect(res.status).toBe(400);
  });
});
