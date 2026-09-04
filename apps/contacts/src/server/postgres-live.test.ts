import { describe, expect, test } from "bun:test";
import pg from "pg";
import { validatePostgresDatabaseUrl } from "./cloud.js";

const dsn = process.env.HASNA_CONTACTS_TEST_DATABASE_URL;
const required = process.env.CONTACTS_REQUIRE_LIVE_POSTGRES === "1";

describe("contacts live PostgreSQL proof", () => {
  test.skipIf(!dsn && !required)("round-trips a transaction against the opt-in test database", async () => {
    if (!dsn) throw new Error("HASNA_CONTACTS_TEST_DATABASE_URL must point at a throwaway PostgreSQL database.");
    const client = new pg.Client({ connectionString: validatePostgresDatabaseUrl(dsn) });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TEMP TABLE contacts_live_gate (value text NOT NULL)");
      await client.query("INSERT INTO contacts_live_gate (value) VALUES ($1)", ["round-trip"]);
      const result = await client.query<{ value: string }>("SELECT value FROM contacts_live_gate");
      expect(result.rows).toEqual([{ value: "round-trip" }]);
      await client.query("ROLLBACK");
    } finally {
      await client.end();
    }
  });
});
