import { describe, expect, test } from "bun:test";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import { PG_MIGRATIONS } from "../db/pg-migrations.js";
import { evCreateUploadIntent } from "./pg-store.js";

describe("Postgres evidence upload intent persistence", () => {
  test("drops raw transport headers and includes an upgrade scrub migration", async () => {
    let insertParams: readonly unknown[] | undefined;
    const client = {
      async execute(sql: string, params?: readonly unknown[]) {
        if (sql.includes("INSERT INTO file_upload_intents")) insertParams = params;
      },
      async get() {
        return {
          id: String(insertParams?.[0]),
          asset_id: String(insertParams?.[1]),
          expires_at: String(insertParams?.[2]),
          status: "pending",
          expected_checksum: String(insertParams?.[3]),
          expected_checksum_algorithm: String(insertParams?.[4]),
          expected_size: Number(insertParams?.[5]),
          required_headers: String(insertParams?.[6]),
          metadata: String(insertParams?.[7]),
          created_at: new Date(0).toISOString(),
          completed_at: null,
        };
      },
      async query() { throw new Error("not used"); },
      async many() { throw new Error("not used"); },
      async one() { throw new Error("not used"); },
    } as unknown as TypedQueryClient;

    const intent = await evCreateUploadIntent(client, {
      asset_id: "asset_synthetic",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      expected_checksum: "0".repeat(64),
      expected_checksum_algorithm: "sha256",
      expected_size: 1,
      required_headers: {
        Authorization: "Bearer CANARY_POSTGRES_AUTHORIZATION",
        "x-amz-security-token": "CANARY_POSTGRES_SESSION",
      },
    });

    expect(insertParams?.[6]).toBe("{}");
    expect(intent.required_headers).toEqual({});

    const scrubMigration = PG_MIGRATIONS.at(-1) ?? "";
    expect(scrubMigration).toContain("UPDATE file_upload_intents");
    expect(scrubMigration).toContain("required_headers");
    expect(scrubMigration).toContain("'{}'");
  });
});
