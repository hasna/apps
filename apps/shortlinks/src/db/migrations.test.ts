import { describe, expect, test } from "bun:test";
import { MigrationLedger, type TypedQueryClient } from "../generated/storage-kit/index.js";
import { SHORTLINKS_MIGRATIONS } from "./migrations.js";

const HOST_REDIRECT_ID = "shortlinks_0005_host_redirect_lookup";
const HOST_REDIRECT_CHECKSUM = "sha256:89b4617400997e82ba698e617e6d62fdc005821ba98f91acdbe645739c971d59";

describe("Shortlinks production migration continuity", () => {
  test("retains the exact host-aware redirect index migration already applied in production", () => {
    const migration = SHORTLINKS_MIGRATIONS.find((candidate) => candidate.id === HOST_REDIRECT_ID);
    expect(migration).toEqual({
      id: HOST_REDIRECT_ID,
      sql: `CREATE INDEX IF NOT EXISTS idx_links_domain_active_slug
       ON links(domain_id, active, slug)`,
      checksum: HOST_REDIRECT_CHECKSUM,
    });
    expect(SHORTLINKS_MIGRATIONS.findIndex((candidate) => candidate.id === HOST_REDIRECT_ID)).toBe(
      SHORTLINKS_MIGRATIONS.findIndex((candidate) => candidate.id === "shortlinks_0004_indexes") + 1,
    );
  });

  test("recognizes the existing ledger row instead of treating the public build as a downgrade", async () => {
    const migration = SHORTLINKS_MIGRATIONS.find((candidate) => candidate.id === HOST_REDIRECT_ID)!;
    const client = {
      execute: async () => ({ rowCount: 0, rows: [] }),
      many: async () => [{ id: HOST_REDIRECT_ID, checksum: HOST_REDIRECT_CHECKSUM, applied_at: "2026-09-18T00:00:00.000Z" }],
    } as unknown as TypedQueryClient;
    const result = await new MigrationLedger(client, [migration]).migrate({ dryRun: true });
    expect(result.plan).toEqual([{ migration, state: "already_applied" }]);
    expect(result.applied).toEqual([{
      id: HOST_REDIRECT_ID,
      checksum: HOST_REDIRECT_CHECKSUM,
      appliedAt: "2026-09-18T00:00:00.000Z",
    }]);
  });
});
