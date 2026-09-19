import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { runMigrations } from "./migrate.js";
import { publicPrincipal } from "./auth.js";
import { PostgresSkillsStore } from "./store.js";

const principal = publicPrincipal({ orgId: "pg_archive_org", orgSlug: "pg-archive", orgName: "PG Archive", userId: "pg_owner", email: "pg-owner@example.test", apiKeyId: "pg_archive_key" });
const adminUrl = process.env.HASNA_SKILLS_TEST_DATABASE_URL?.trim() || "postgres://hasna@127.0.0.1:5432/postgres";

async function sql(url: string) {
  const bunWithSql = Bun as unknown as { SQL: new (url: string, options?: { max?: number }) => any };
  return new bunWithSql.SQL(url, { max: 1 });
}
async function scratchDatabase(): Promise<string | null> {
  const database = `skills_archive_${randomUUID().replace(/-/g, "")}`;
  try {
    const admin = await sql(adminUrl);
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    await admin.close?.();
    const target = new URL(adminUrl);
    target.pathname = "/" + database;
    return target.toString();
  } catch {
    return null;
  }
}
const databaseUrl = await scratchDatabase();

const postgresTest = databaseUrl ? test : test.skip;
postgresTest("PostgreSQL archive lifecycle: two store connections fence archive and profile selection", async () => {
    if (!databaseUrl) return;
    const first = new PostgresSkillsStore(databaseUrl!);
    const second = new PostgresSkillsStore(databaseUrl!);
    try {
      await runMigrations(databaseUrl!, resolve(import.meta.dir, "../../migrations/postgres"));
      await first.ensureBootstrapApiKey("synthetic-pg", principal);
      const bytes = new TextEncoder().encode("synthetic postgres archive fixture");
      const published = await first.publishSkill({ principal, slug: "legacy-skill", displayName: "Legacy", description: "Fixture", category: "Test", tags: ["fixture"], source: "custom", kind: "instruction", version: "1.0.0", skillMd: "# Legacy\n", bundle: { sha256: "a".repeat(64), byteSize: bytes.byteLength, contentType: "application/gzip", storageKind: "db", bytes } });
      await first.selectionStore.saveProfile(principal, "fleet", [], null);
      const profile = await first.selectionStore.getProfile(principal, "fleet");
      const [archive, selection] = await Promise.allSettled([
        first.setSkillLifecycle(principal, "legacy-skill", { lifecycle: "archived", reason: "synthetic replacement" }, published.revisionId),
        second.selectionStore.saveProfile(principal, "fleet", [{ slug: "legacy-skill", version: "1.0.0", bundleDigest: `sha256:${"a".repeat(64)}` }], profile!.revision),
      ]);
      const archived = archive.status === "fulfilled" && archive.value?.lifecycle === "archived";
      const selected = selection.status === "fulfilled" && selection.value !== null;
      expect(Number(archived) + Number(selected)).toBe(1);
      expect((await first.getSkill(principal, "legacy-skill"))?.lifecycle).toBe(archived ? "archived" : "active");
      if (archive.status === "rejected") expect(archive.reason).toMatchObject({ name: "SkillLifecycleConflictError" });
      if (selection.status === "fulfilled" && !selection.value) expect(selection.value).toBeNull();
    } finally {
      await first.close();
      await second.close();
      const admin = await sql(adminUrl);
      await admin.unsafe(`DROP DATABASE IF EXISTS "${new URL(databaseUrl!).pathname.slice(1)}" WITH (FORCE)`);
      await admin.close?.();
    }
});
