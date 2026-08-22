/**
 * Live-PostgreSQL route regression for todos e920ef6a: GET /v1/personas
 * dropped the client's limit/offset query params (the route passed only
 * projectId), and the pg-store capped the page at 100 rows with no offset.
 * Together they truncated every hosted personas listing to the newest 100
 * rows. This test exercises the REAL server route against a live Postgres:
 * 150 seeded personas, then asserts page 2 (limit=100&offset=100) returns the
 * 50 rows beyond the first 100 and that the SQL carried the offset.
 *
 * Convention mirrors src/server/api-auth.test.ts: runs only when
 * TESTERS_PG_TEST_URL is set (skipped loudly otherwise).
 */
import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { createServer } from "node:net";
import { Pool } from "pg";
import { mintApiKey, ApiKeyStore, apiKeyMigrations } from "@hasna/contracts/auth";
import { createQueryClient } from "../generated/storage-kit/query.js";
import { runPgMigrations } from "../db/pg-migrate.js";

const SIGNING_KEY = "testers-personas-pagination-signing-0000";
const TESTERS_PG_TEST_URL = process.env.TESTERS_PG_TEST_URL;

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

describe.skipIf(!TESTERS_PG_TEST_URL)("GET /v1/personas limit+offset pagination with a live Postgres", () => {
  let serverProc: Subprocess;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: TESTERS_PG_TEST_URL, max: 4 });
    const client = createQueryClient(pool);

    // Schema + api-key store + 150 personas with strictly increasing created_at.
    await runPgMigrations(client);
    for (const migration of apiKeyMigrations()) {
      await client.execute(migration.sql);
    }
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    for (let i = 0; i < 150; i++) {
      const iso = new Date(base + i * 1000).toISOString();
      await client.execute(
        `INSERT INTO personas (id, short_id, name, role, created_at, updated_at)
         VALUES ($1,$2,$3,'user',$4,$4)`,
        [`persona-${i}`, `P${i}`, `Persona ${i}`, iso],
      );
    }

    const store = new ApiKeyStore(client);
    const minted = mintApiKey({
      app: "testers",
      scopes: ["testers:read"],
      signingSecret: SIGNING_KEY,
    });
    await store.insertMinted(minted, "personas-pagination.pg.test.ts");
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

  async function listPersonas(query: string): Promise<{ id: string; name: string }[]> {
    const res = await fetch(`${baseUrl}/v1/personas?${query}`, {
      headers: { "x-api-key": token },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { id: string; name: string }[];
  }

  test("offset=100 returns the 50 rows beyond the first 100", async () => {
    const page1 = await listPersonas("limit=100&offset=0");
    const page2 = await listPersonas("limit=100&offset=100");

    expect(page1).toHaveLength(100);
    expect(page2).toHaveLength(50);
    const page1Ids = new Set(page1.map((p) => p.id));
    expect(page2.some((p) => page1Ids.has(p.id))).toBe(false);
    // newest first: page2 = persona-49..persona-0
    expect(page2[0]!.id).toBe("persona-49");
  });

  test("offset=200 returns an empty page", async () => {
    const page3 = await listPersonas("limit=100&offset=200");
    expect(page3).toEqual([]);
  });
});
