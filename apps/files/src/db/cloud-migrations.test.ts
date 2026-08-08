import { describe, expect, test } from "bun:test";
import { createMigrationLedger } from "../generated/storage-kit/migrations.js";
import { wrapExecutor, type PgExecutor } from "../generated/storage-kit/query.js";
import { CLOUD_MIGRATIONS } from "./cloud-migrations.js";

const FILES_0113_SQL = `UPDATE file_upload_intents
    SET required_headers = '{}'
    WHERE required_headers <> '{}'`;
const FILES_0113_CHECKSUM = "sha256:3ca45b34b25053aa065fc88af70792c6bec653be3fb338c77940ea1d1481b85c";

interface LedgerRow {
  id: string;
  checksum: string;
  applied_at: string;
}

function ledgerWith(rows: LedgerRow[]) {
  const executor: PgExecutor = {
    async query(sql: string) {
      if (sql.startsWith("SELECT id, checksum, applied_at FROM schema_migrations")) {
        return { rows: rows as never[], rowCount: rows.length };
      }
      return { rows: [] as never[], rowCount: 0 };
    },
  };
  return createMigrationLedger(wrapExecutor(executor), CLOUD_MIGRATIONS);
}

describe("cloud migration compatibility", () => {
  test("recognizes the exact historical files-0113 ledger entry", async () => {
    const result = await ledgerWith([
      {
        id: "files-0113",
        checksum: FILES_0113_CHECKSUM,
        applied_at: "2026-07-10T17:08:18.000Z",
      },
    ]).migrate({ dryRun: true });

    const migration = CLOUD_MIGRATIONS.find(({ id }) => id === "files-0113");
    expect(migration?.sql).toBe(FILES_0113_SQL);
    expect(migration?.checksum).toBe(FILES_0113_CHECKSUM);
    expect(result.plan.find(({ migration: item }) => item.id === "files-0113")?.state).toBe("already_applied");
  });

  test("still rejects checksum drift for files-0113", async () => {
    await expect(
      ledgerWith([
        {
          id: "files-0113",
          checksum: "sha256:not-the-applied-checksum",
          applied_at: "2026-07-10T17:08:18.000Z",
        },
      ]).migrate({ dryRun: true }),
    ).rejects.toThrow("Migration checksum mismatch for 'files-0113'");
  });

  test("still rejects a genuinely unknown applied migration", async () => {
    await expect(
      ledgerWith([
        {
          id: "files-0114",
          checksum: "sha256:unknown",
          applied_at: "2026-07-10T17:08:18.000Z",
        },
      ]).migrate({ dryRun: true }),
    ).rejects.toThrow("Applied migration 'files-0114' is not recognized by this build");
  });
});
