import { describe, expect, test } from "bun:test";
import type { QueryResultRow } from "pg";
import type { TypedQueryClient } from "../../generated/storage-kit/index.js";
import { loadMigrations } from "./migrations.js";
import { runCloudMigrations } from "./migrate.js";

/**
 * Prod ledger census (2026-08-29, ECS inspection task on the oss-fleet-prod
 * cluster, read-only `SELECT id, checksum, applied_at FROM schema_migrations
 * ORDER BY id`): the 8 current migrations plus exactly ONE legacy row,
 * `0004_tenancy`, applied 2026-07-13 by the pre-monorepo sessions cloud whose
 * id scheme no longer exists in any build of this repo. Every current
 * migration's checksum matches the ledger row byte-for-byte, so no checksum
 * drift exists — only the acknowledged legacy row is unknown to the build.
 */
const PROD_LEDGER: Array<{ id: string; checksum: string }> = [
  { id: "0001_init", checksum: "sha256:05b4985082a384ac34d50ea7c3ca7f02063f57a8f8754539747517dc55a5ae24" },
  { id: "0002_api_keys", checksum: "sha256:30ce5264fb242e4c3a7c092879d47b25667f990ce45e7135ca8880ae7f96766f" },
  { id: "0003_session_token_bigints", checksum: "sha256:cb4a153eea96ffde02335dbede6bf9a91e7a4d838e4746b0ba94495a6f22d022" },
  { id: "0004_codewith_session_source", checksum: "sha256:20c7ee04c4fb8d2d0af1f9f365512e32c0f71a0818fa746913d6fae5db6f9741" },
  { id: "0004_tenancy", checksum: "sha256:2e85063a78122cf92744dbf2c0c9e67536da76d94869c1e2f30008224d81ebd9" },
  { id: "0005_session_source_id_lookup_index", checksum: "sha256:e62b24dd238533b296308e6395bac0ba15400f00fbda8f5a7a217769a5ae44f1" },
  { id: "0006_session_objects", checksum: "sha256:34cb950616a07a1eb51be82690d83824ae18e9bfc66235a278ef5f2003ee7c9f" },
  { id: "0007_embeddings", checksum: "sha256:3a92b52bb7af9d28286058bdf27922a171bcb6e279e9bfc659b21de0f292b666" },
  { id: "0008_embeddings_float8", checksum: "sha256:e0e81049641e517c23498e2299c8dfd97f7c7f2dbebbbd794c0a5376b3b164d3" },
];

function fakeClient(ledgerRows: Array<{ id: string; checksum: string }>): TypedQueryClient {
  return {
    async query() {
      return { rows: [], rowCount: 0 };
    },
    async many<T extends QueryResultRow>(sql: string): Promise<T[]> {
      if (sql.includes("SELECT id, checksum, applied_at FROM schema_migrations")) {
        return ledgerRows.map((row) => ({
          id: row.id,
          checksum: row.checksum,
          applied_at: "2026-08-28T08:50:58.000Z",
        })) as T[];
      }
      throw new Error(`unexpected many SQL: ${sql}`);
    },
    async get() {
      throw new Error("get() not used in this test");
    },
    async one() {
      throw new Error("one() not used in this test");
    },
    async execute(sql: string): Promise<void> {
      if (sql.includes("CREATE TABLE IF NOT EXISTS schema_migrations")) return;
      throw new Error(`unexpected execute SQL: ${sql}`);
    },
  };
}

describe("runCloudMigrations against the prod ledger shape", () => {
  test("accepts the prod ledger (incl. legacy 0004_tenancy) and plans every current migration as already applied", async () => {
    const migrations = loadMigrations();
    expect(migrations.length).toBe(8);

    const report = await runCloudMigrations({
      client: fakeClient(PROD_LEDGER),
      dryRun: true,
    });

    expect(report.dryRun).toBe(true);
    expect(report.pending).toEqual([]);
    expect(report.alreadyApplied.sort()).toEqual(
      migrations.map((m) => m.id).sort(),
    );
  });

  test("still refuses an applied ledger row that is neither a current migration nor acknowledged legacy history", async () => {
    const unknownLedger = [...PROD_LEDGER, { id: "9999_never_declared", checksum: "sha256:deadbeef" }];
    await expect(
      runCloudMigrations({ client: fakeClient(unknownLedger), dryRun: true }),
    ).rejects.toThrow("Applied migration '9999_never_declared' is not recognized by this build (downgrade?)");
  });

  test("pre-fix shape: without the acknowledgment the prod ledger fails with the exact prod error", async () => {
    // This assertion pins the failure mode this regression guards against.
    // It exercises the raw kit ledger (no acknowledgment set) so the test
    // documents the pre-fix behaviour even after the runner ships the ack.
    const { MigrationLedger } = await import("../../generated/storage-kit/index.js");
    const ledger = new MigrationLedger(fakeClient(PROD_LEDGER), loadMigrations());
    await expect(ledger.migrate({ dryRun: true })).rejects.toThrow(
      "Applied migration '0004_tenancy' is not recognized by this build (downgrade?)",
    );
  });
});
