import { describe, expect, it } from "bun:test";
import { checkHealth } from "../src/generated/storage-kit/health.js";
import { createServerPoolFromEnv } from "../src/generated/storage-kit/pool.js";

const testDatabaseUrl = process.env["HASNA_BILLING_TEST_DATABASE_URL"];
const live = testDatabaseUrl ? it : it.skip;

describe("PostgreSQL live gate", () => {
  live("connects and passes the read-only health query", async () => {
    const env: Record<string, string | undefined> = {
      HASNA_BILLING_DATABASE_URL: testDatabaseUrl,
      PGSSLROOTCERT: process.env["PGSSLROOTCERT"],
    };
    const { client } = createServerPoolFromEnv("billing", { env });
    try {
      const result = await checkHealth(client);
      expect(result.ok).toBe(true);
    } finally {
      await client.close();
    }
  });
});
