import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { provisionCloudStore } from "../src/db/database.js";
import type { PoolQueryClient } from "../src/generated/storage-kit/query.js";

/**
 * Live-PostgreSQL gate declared in hasna.contract.json (storage.pgTestGate).
 *
 * These are the only tests in the repo that open a real Postgres connection.
 * The cloud domain path is deliberately fail-closed (getDatabase refuses to
 * degrade to volatile in-memory SQLite), so this gate proves the primitives the
 * cloud path is built on: provisionCloudStore() resolving the DSN and wiring
 * the vendored storage-kit pool + typed query client.
 *
 * The gate must not be able to pass without a database:
 *   - URL set                                   -> connect for real; an
 *     unreachable database fails the suite.
 *   - URL unset, HASNA_CONTROLS_REQUIRE_POSTGRES=1 -> throw. The declared gate
 *     command exports that flag, so a vacuous green run is impossible.
 *   - URL unset, flag unset                     -> skip loudly, so `bun run
 *     test` stays green on a machine with no Postgres.
 */

function testDatabaseUrl(): string | undefined {
  return process.env["HASNA_CONTROLS_TEST_DATABASE_URL"]?.trim() || process.env["HASNA_CONTROLS_DATABASE_URL"]?.trim();
}

const REQUIRED = process.env["HASNA_CONTROLS_REQUIRE_POSTGRES"] !== undefined;
const url = testDatabaseUrl();

if (!url && REQUIRED) {
  throw new Error(
    "HASNA_CONTROLS_REQUIRE_POSTGRES=1 requires HASNA_CONTROLS_TEST_DATABASE_URL (or HASNA_CONTROLS_DATABASE_URL); the live-PG gate must not pass without one",
  );
}

const enabled = Boolean(url);

describe.skipIf(!enabled)("live PostgreSQL via the vendored storage-kit", () => {
  let client: PoolQueryClient;

  beforeAll(async () => {
    process.env["HASNA_CONTROLS_DATABASE_URL"] = url!;
    client = (await provisionCloudStore()) as PoolQueryClient;
  });

  afterAll(async () => {
    delete process.env["HASNA_CONTROLS_DATABASE_URL"];
    if (client) await client.close();
  });

  it("connects for real and round-trips a row through the typed query client", async () => {
    const row = await client.one<{ ok: boolean }>("SELECT true AS ok");
    expect(row.ok).toBe(true);
  });

  it("runs a transaction on a dedicated pooled client", async () => {
    await client.transaction(async (tx) => {
      const result = await tx.query<{ n: number }>("SELECT 1 AS n");
      expect(result.rows[0]?.n).toBe(1);
    });
  });
});
