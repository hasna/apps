import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createMigrationLedger } from "../generated/storage-kit/migrations.js";
import { wrapExecutor, type PgExecutor } from "../generated/storage-kit/query.js";
import { CLOUD_MIGRATIONS } from "./cloud-migrations.js";

const LEGACY_FILES_0001_TO_0154_LEDGER_DIGEST = [
  "sha256:",
  "66aa4138",
  "0b2831e0",
  "3e081798",
  "beffe729",
  "8bb834a9",
  "1813d1fd",
  "6f03a461",
  "8a8a971c",
].join("");

const FILES_0155_SQL = `UPDATE file_upload_intents
    SET required_headers = '{}'
    WHERE required_headers <> '{}'`;
const FILES_0155_CHECKSUM = [
  "sha256:",
  "3ca45b34",
  "b25053aa",
  "065fc88a",
  "f70792c6",
  "bec653be",
  "3fb338c7",
  "7940ea1d",
  "1481b85c",
].join("");

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
  const historicalFilesLedger = CLOUD_MIGRATIONS.filter(
    ({ id }) => id >= "files-0001" && id <= "files-0154",
  ).map(({ id, checksum }) => ({
    id,
    checksum,
    applied_at: "2026-07-10T17:08:18.000Z",
  }));

  test("preserves the exact historical files-0001..0154 ledger and appends the scrub as files-0155", () => {
    expect(historicalFilesLedger).toHaveLength(154);
    expect(
      `sha256:${createHash("sha256")
        .update(JSON.stringify(historicalFilesLedger.map(({ id, checksum }) => [id, checksum])))
        .digest("hex")}`,
    ).toBe(LEGACY_FILES_0001_TO_0154_LEDGER_DIGEST);

    const scrub = CLOUD_MIGRATIONS.find(({ id }) => id === "files-0155");
    expect(scrub?.sql).toBe(FILES_0155_SQL);
    expect(scrub?.checksum).toBe(FILES_0155_CHECKSUM);
    expect(CLOUD_MIGRATIONS.some(({ id }) => id === "files-0156")).toBe(false);
  });

  test("accepts a full historical files-0001..0154 production ledger", async () => {
    const result = await ledgerWith(historicalFilesLedger).migrate({ dryRun: true });

    expect(
      result.plan
        .filter(({ migration }) => migration.id >= "files-0001" && migration.id <= "files-0154")
        .every(({ state }) => state === "already_applied"),
    ).toBe(true);
    expect(result.plan.find(({ migration }) => migration.id === "files-0155")?.state).toBe("pending");
  });

  test("still rejects checksum drift inside the restored historical range", async () => {
    await expect(
      ledgerWith(
        historicalFilesLedger.map((row) =>
          row.id === "files-0142"
            ? {
                ...row,
                checksum: "sha256:not-the-applied-checksum",
              }
            : row,
        ),
      ).migrate({ dryRun: true }),
    ).rejects.toThrow("Migration checksum mismatch for 'files-0142'");
  });

  test("still rejects a genuinely unknown applied migration after the current lineage", async () => {
    await expect(
      ledgerWith([
        ...historicalFilesLedger,
        {
          id: "files-0156",
          checksum: "sha256:not-the-applied-checksum",
          applied_at: "2026-07-10T17:08:18.000Z",
        },
      ]).migrate({ dryRun: true }),
    ).rejects.toThrow("Applied migration 'files-0156' is not recognized by this build");
  });
});
