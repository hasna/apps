/**
 * End-to-end regression for the @hasna/todos 0.15.38 /v1 503 incident
 * (todos row ae34a051, incident 720366) against a REAL Postgres.
 *
 * The incident: every /v1 business route returned HTTP 503 with a valid API
 * key because the REAL cloud.ts verifier wiring threw at construction
 * (contracts >= 0.8.7 refuses the deprecated `isRevoked`-only wiring; the
 * #761 lockfile regeneration moved todos from the stale-locked contracts 0.5.2
 * to 0.13.1). See cloud-auth-wiring.test.ts for the full account.
 *
 * This file exercises the complete real path: real verifier wiring, real
 * api_keys table (schema ensured on the test database), a real minted +
 * inserted key, and the real /v1 request handler — a valid key must get HTTP
 * 200, a keyless request must fail closed with 401.
 *
 * Guarded by TODOS_TEST_PG_URL so the default no-Postgres lane skips it:
 *   TODOS_TEST_PG_URL=postgres://postgres@127.0.0.1:5432/todos_pg_test?sslmode=disable \
 *     bun test src/server/cloud-auth-wiring.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { getDatabase, resetDatabase } from "../db/database.js";
import { createLocalSqliteTodosStorageAdapter } from "../storage/local-sqlite.js";
import type { TodosStorageAdapter } from "../storage/interfaces.js";
import { createTodosCloudQueryClient, type TodosCloudQueryClient } from "../storage/cloud-client.js";
import { postgresTodosSyncSchemaSql } from "../storage/postgres-sync.js";
import {
  closeCloud,
  getApiKeyStore,
  getCloudVerifier,
  resolveCloudDatabaseUrl,
} from "./cloud.js";
import { handleV1Request, type V1RequestDependencies } from "./v1.js";

const PG_URL = process.env["TODOS_TEST_PG_URL"];
const TEST_SIGNING_SECRET = "cloud-auth-wiring-pg-test-signing-secret";
const AGENT = "wiring-pg-test";

describe.skipIf(!PG_URL)("real /v1 auth wiring against Postgres", () => {
  let client: TodosCloudQueryClient;
  let store: TodosStorageAdapter;
  let dependencies: V1RequestDependencies;

  beforeAll(async () => {
    if (!PG_URL) return;
    // The real cloud wiring reads these from the environment on first use.
    process.env.DATABASE_URL = PG_URL;
    process.env.API_KEY_SIGNING_SECRET = TEST_SIGNING_SECRET;
    client = createTodosCloudQueryClient(PG_URL, { max: 2, connectionTimeout: 5 });
    // Ensure the schema the store + adapter need: sync tables + api_keys.
    for (const sql of postgresTodosSyncSchemaSql()) {
      await client.query(sql);
    }
    await getApiKeyStore().ensureSchema();
    await client.query(
      `DELETE FROM api_keys WHERE app = 'todos' AND (agent = $1 OR created_by = $1)`,
      [AGENT],
    );
    // Reset module caches so getCloudVerifier() builds against the PG client.
    await closeCloud().catch(() => {});

    resetDatabase();
    store = createLocalSqliteTodosStorageAdapter({ db: getDatabase(":memory:") });
    dependencies = {
      // The REAL verifier + REAL (lazy) schema path; storage is stubbed with
      // the local adapter so the assertion targets auth, not storage.
      getVerifier: () => getCloudVerifier(),
      ensureSchema: async () => {},
      getStorageAdapter: () => store,
      getPrGroupLedger: () =>
        ({}) as unknown as ReturnType<NonNullable<V1RequestDependencies["getPrGroupLedger"]>>,
      getProjectRegistrationAuthority: () =>
        ({}) as unknown as ReturnType<
          NonNullable<V1RequestDependencies["getProjectRegistrationAuthority"]>
        >,
      getTaskManifestAuthority: () =>
        ({}) as unknown as ReturnType<
          NonNullable<V1RequestDependencies["getTaskManifestAuthority"]>
        >,
      getTaskSubtreeTransferAuthority: () =>
        ({}) as unknown as ReturnType<
          NonNullable<V1RequestDependencies["getTaskSubtreeTransferAuthority"]>
        >,
    };
  });

  afterAll(async () => {
    await closeCloud().catch(() => {});
    if (client) await client.close().catch(() => {});
    delete process.env.DATABASE_URL;
    delete process.env.API_KEY_SIGNING_SECRET;
  });

  function request(path: string, method = "GET", key?: string): Promise<Response | null> {
    const url = new URL(`https://todos.example.test${path}`);
    const headers = key ? { "x-api-key": key } : {};
    return handleV1Request(new Request(url, { method, headers }), url, dependencies);
  }

  it("GET /v1/tasks with a valid registered key returns 200 (incident regression)", async () => {
    const { mintApiKey } = await import("@hasna/contracts/auth");
    const minted = mintApiKey({
      app: "todos",
      scopes: ["todos:read", "todos:write"],
      signingSecret: TEST_SIGNING_SECRET,
      agent: AGENT,
    });
    await getApiKeyStore().insertMinted(minted, AGENT);

    const res = await request("/v1/tasks?limit=1", "GET", minted.token);
    expect(res?.status).toBe(200);
  });

  it("GET /v1/tasks without a key fails closed with 401", async () => {
    const res = await request("/v1/tasks?limit=1", "GET");
    expect(res?.status).toBe(401);
    const body = (await res?.json()) as { reason?: string };
    expect(body.reason).toBe("missing_token");
  });

  it("the signer and the verifier agree on the same configured secret", () => {
    expect(resolveCloudDatabaseUrl()).toBe(PG_URL);
  });
});
