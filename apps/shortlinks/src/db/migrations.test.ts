import { describe, expect, test } from "bun:test";
import { MigrationLedger, type TypedQueryClient } from "../generated/storage-kit/index.js";
import { SHORTLINKS_MIGRATIONS } from "./migrations.js";

const PRODUCTION_LEDGER = [
  ["shortlinks_0001_domains", "sha256:2f79aef683d782cccf6f0855cbe63ddd70ab2e0e663a99a0007690c31cc1bf26"],
  ["shortlinks_0002_links", "sha256:3518842d0bbb5d18bd9d5364b7ee5ff2f0367f2067ce76651091d485c2d52807"],
  ["shortlinks_0003_clicks", "sha256:df547c3585076a7628374c6144ff868a3de39b11ff20f81aa0e22acc122536fc"],
  ["shortlinks_0004_indexes", "sha256:416fde32f123fb00c832200a8dc3d7ea59c496322d070eed4cdb262dc9bb7878"],
  ["shortlinks_0005_host_redirect_lookup", "sha256:89b4617400997e82ba698e617e6d62fdc005821ba98f91acdbe645739c971d59"],
  ["hasna_auth_0001_api_keys", "sha256:95429079245944aa39727486cf92dea0ae8a1bfa889e1940f2d9911eb0b020a5"],
  ["hasna_auth_0002_api_keys_indexes", "sha256:4e646262846e9ae664b5b0d67cb079f788c85d45fcc3a323131df5aa9ba7b777"],
  ["hasna_auth_0003_api_keys_tenant", "sha256:feeb00d30e5b52c74d4084c5cbd48fe8475bae56ad286eaf5cbaa117a17aa10a"],
] as const;

type LedgerRow = { id: string; checksum: string; applied_at: string };

function fakeClient(rows: LedgerRow[]): { client: TypedQueryClient; executed: string[] } {
  const executed: string[] = [];
  return {
    executed,
    client: {
      execute: async (sql: string) => {
        executed.push(sql);
        return { rowCount: 0, rows: [] };
      },
      many: async () => rows,
    } as unknown as TypedQueryClient,
  };
}

function appliedRows(): LedgerRow[] {
  return PRODUCTION_LEDGER.map(([id, checksum]) => ({
    id,
    checksum,
    applied_at: "2026-09-18T00:00:00.000Z",
  }));
}

describe("Shortlinks production migration continuity", () => {
  test("matches every immutable migration ID and checksum already applied by the prior producer", () => {
    expect(SHORTLINKS_MIGRATIONS.map(({ id, checksum }) => [id, checksum])).toEqual(
      PRODUCTION_LEDGER.map(([id, checksum]) => [id, checksum]),
    );
    expect(SHORTLINKS_MIGRATIONS.find(({ id }) => id === "shortlinks_0005_host_redirect_lookup")?.sql).toBe(
      `CREATE INDEX IF NOT EXISTS idx_links_domain_active_slug
       ON links(domain_id, active, slug)`,
    );
  });

  test("classifies the complete production ledger as already applied without rerunning schema SQL", async () => {
    const { client, executed } = fakeClient(appliedRows());
    const result = await new MigrationLedger(client, SHORTLINKS_MIGRATIONS).migrate({ dryRun: true });

    expect(result.plan.map(({ migration, state }) => [migration.id, state])).toEqual(
      PRODUCTION_LEDGER.map(([id]) => [id, "already_applied"]),
    );
    expect(executed).toHaveLength(1);
    expect(executed[0]).toContain("CREATE TABLE IF NOT EXISTS schema_migrations");
    expect(executed.some((sql) => sql.includes("idx_links_domain_active_slug"))).toBe(false);
    expect(executed.some((sql) => sql.includes("INSERT INTO schema_migrations"))).toBe(false);
  });

  test("still refuses any checksum drift in the frozen production ledger", async () => {
    const rows = appliedRows();
    rows[0] = { ...rows[0]!, checksum: "sha256:wrong" };
    const { client } = fakeClient(rows);
    await expect(new MigrationLedger(client, SHORTLINKS_MIGRATIONS).migrate({ dryRun: true })).rejects.toThrow(
      "Migration checksum mismatch for 'shortlinks_0001_domains'",
    );
  });
});
