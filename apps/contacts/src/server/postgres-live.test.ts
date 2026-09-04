import { describe, expect, test } from "bun:test";
import pg from "pg";
import { validatePostgresDatabaseUrl } from "./cloud.js";
import { PG_MIGRATIONS } from "../db/pg-migrations.js";
import { createQueryClient } from "../generated/storage-kit/query.js";
import { ContactsPgStore } from "./pg-store.js";

const dsn = process.env.HASNA_CONTACTS_TEST_DATABASE_URL;
const required = process.env.CONTACTS_REQUIRE_LIVE_POSTGRES === "1";

describe("contacts live PostgreSQL proof", () => {
  test.skipIf(!dsn && !required)("applies the actual schema and round-trips contact methods through the production store", async () => {
    if (!dsn) throw new Error("HASNA_CONTACTS_TEST_DATABASE_URL must point at a throwaway PostgreSQL database.");
    // One connection keeps every statement inside the same rollback-only
    // transaction. A unique schema avoids touching any pre-existing tables.
    const pool = new pg.Pool({ connectionString: validatePostgresDatabaseUrl(dsn), max: 1 });
    const client = createQueryClient(pool);
    const schema = `contacts_gate_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      await client.execute("BEGIN");
      await client.execute(`CREATE SCHEMA ${schema}`);
      await client.execute(`SET LOCAL search_path TO ${schema}`);
      for (const sql of PG_MIGRATIONS) await client.execute(sql);
      // Production schema startup promises idempotency.
      for (const sql of PG_MIGRATIONS) await client.execute(sql);
      const store = new ContactsPgStore(client);
      const created = await store.createContact({
        display_name: "Live PostgreSQL probe",
        emails: [{ address: "probe@example.invalid", type: "work" }],
        phones: [{ number: "+15555550123", type: "mobile" }],
      });
      expect(created.emails.map((email) => email.address)).toEqual(["probe@example.invalid"]);
      expect(created.phones.map((phone) => phone.number)).toEqual(["+15555550123"]);
      expect((await store.getContact(created.id))?.display_name).toBe("Live PostgreSQL probe");
      const updated = await store.updateContact(created.id, {
        emails_add: [{ address: "second@example.invalid", type: "personal" }],
      });
      expect(updated?.emails.map((email) => email.address).sort()).toEqual(["probe@example.invalid", "second@example.invalid"]);
      expect(await store.deleteContact(created.id)).toBe(true);
      expect(await store.getContact(created.id)).toBeNull();
      const remaining = await client.one<{ count: string }>("SELECT count(*)::text AS count FROM emails");
      expect(remaining.count).toBe("0");
    } finally {
      try { await client.execute("ROLLBACK"); } finally { await client.close(); }
    }
  });

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
