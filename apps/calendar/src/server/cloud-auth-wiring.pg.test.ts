/**
 * End-to-end regression for the @hasna/calendar 0.3.6 /v1 503 incident
 * (row I38-00755, deploy-oss-fleet-0823a confirm 725517) against a REAL
 * Postgres.
 *
 * The incident: every /v1 business route returned HTTP 503 with a valid API
 * key because the REAL cloud.ts verifier wiring threw at construction
 * (contracts >= 0.8.7 refuses the deprecated `isRevoked`-only wiring; the
 * 0.3.6 lockfile regeneration moved calendar from @hasna/contracts ^0.4.2 to
 * the pinned 0.13.3). See cloud-auth-wiring.test.ts for the full account.
 *
 * This file exercises the complete real path: real verifier wiring, real
 * api_keys table (schema ensured on the test database), a real minted +
 * inserted key, and the real /v1 request handler — a valid key must get HTTP
 * 200, a keyless request must fail closed with 401.
 *
 * Guarded by CALENDAR_TEST_DATABASE_URL so the default no-Postgres lane skips
 * it (the same opt-in the existing v1.pg.test.ts uses):
 *
 *   CALENDAR_TEST_DATABASE_URL =
 *   postgres://postgres@127.0.0.1:5432/calendar_pg_test?sslmode=verify-full \
 *     bun test src/server/cloud-auth-wiring.pg.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mintApiKey } from "@hasna/contracts/auth";
import { schemaStatements, closeCloud, getApiKeyStore, getCloudVerifier } from "./cloud.js";
import { createCalendarCloudQueryClient, type CalendarCloudQueryClient } from "./cloud-client.js";
import { handleV1Request } from "./v1.js";

const DSN = process.env.CALENDAR_TEST_DATABASE_URL;
const TEST_SIGNING_SECRET = "cloud-auth-wiring-pg-test-signing-secret";
const AGENT = "wiring-pg-test";

describe.skipIf(!DSN)("real /v1 auth wiring against Postgres", () => {
  let client: CalendarCloudQueryClient;

  beforeAll(async () => {
    if (!DSN) return;
    // The real cloud wiring reads these from the environment on first use.
    process.env.CALENDAR_DATABASE_URL = DSN;
    process.env.API_KEY_SIGNING_SECRET = TEST_SIGNING_SECRET;
    client = createCalendarCloudQueryClient(DSN, { max: 2, connectionTimeout: 5 });
    // Ensure the schema the store + auth need: calendar tables + api_keys.
    for (const stmt of schemaStatements()) {
      await client.query(stmt);
    }
    await getApiKeyStore().ensureSchema();
    await client.query(
      `DELETE FROM api_keys WHERE app = 'calendar' AND (agent = $1 OR created_by = $1)`,
      [AGENT],
    );
    // Reset module caches so getCloudVerifier() builds against the PG client.
    await closeCloud().catch(() => {});
  });

  afterAll(async () => {
    await closeCloud().catch(() => {});
    if (client) await client.close().catch(() => {});
    delete process.env.CALENDAR_DATABASE_URL;
    delete process.env.API_KEY_SIGNING_SECRET;
  });

  function request(path: string, method = "GET", key?: string): Promise<Response | null> {
    const url = new URL(`https://calendar.example.test${path}`);
    const headers = key ? { "x-api-key": key } : {};
    return handleV1Request(new Request(url, { method, headers }), url);
  }

  it("GET /v1/events with a valid registered key returns 200 (incident regression)", async () => {
    const minted = mintApiKey({
      app: "calendar",
      scopes: ["calendar:read", "calendar:write"],
      signingSecret: TEST_SIGNING_SECRET,
      agent: AGENT,
    });
    await getApiKeyStore().insertMinted(minted, AGENT);

    const res = await request("/v1/events?limit=1", "GET", minted.token);
    expect(res?.status).toBe(200);
    const body = (await res?.json()) as { count?: number };
    expect(typeof body.count).toBe("number");
  });

  it("GET /v1/events without a key fails closed with 401", async () => {
    const res = await request("/v1/events?limit=1", "GET");
    expect(res?.status).toBe(401);
    const body = (await res?.json()) as { reason?: string };
    expect(body.reason).toBe("missing_token");
  });

  it("the real verifier constructs (no contracts isRevoked-only throw)", () => {
    expect(() => getCloudVerifier()).not.toThrow();
  });
});
