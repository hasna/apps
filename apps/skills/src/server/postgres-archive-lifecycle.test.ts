import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { runMigrations } from "./migrate.js";
import { publicPrincipal } from "./auth.js";
import { PostgresSkillsStore } from "./store.js";

const principal = publicPrincipal({ orgId: "pg_archive_org", orgSlug: "pg-archive", orgName: "PG Archive", userId: "pg_owner", email: "pg-owner@example.test", apiKeyId: "pg_archive_key" });
const configuredUrl = process.env.HASNA_SKILLS_TEST_DATABASE_URL?.trim();
const adminUrl = configuredUrl || "postgres://hasna@127.0.0.1:5432/postgres";

async function sql(url: string) {
  const bunWithSql = Bun as unknown as { SQL: new (url: string, options?: { max?: number }) => any };
  return new bunWithSql.SQL(url, { max: 1 });
}
async function scratchDatabase(sourceUrl = adminUrl, required = Boolean(configuredUrl)): Promise<{ url: string; name: string } | null> {
  const name = `skills_archive_${randomUUID().replace(/-/g, "")}`;
  let admin: any;
  try {
    admin = await sql(sourceUrl);
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    const target = new URL(sourceUrl);
    target.pathname = "/" + name;
    return { url: target.toString(), name };
  } catch (error) {
    // A configured test target is an explicit fixture contract: an auth,
    // permission, or connectivity error must fail the test instead of becoming
    // a false skip. Only absence of the optional local-trust cluster skips.
    if (required) throw error;
    return null;
  } finally {
    await admin?.close?.();
  }
}
const database = await scratchDatabase(adminUrl, Boolean(configuredUrl));
const postgresTest = database ? test : test.skip;

test("configured PostgreSQL fixture failures are errors, not skips", async () => {
  await expect(scratchDatabase("postgres://hasna@127.0.0.1:1/unreachable", true)).rejects.toBeDefined();
});

postgresTest("PostgreSQL archive lifecycle: both race orders fence archive and profile selection", async () => {
  if (!database) return;
  const first = new PostgresSkillsStore(database.url);
  const second = new PostgresSkillsStore(database.url);
  try {
    await runMigrations(database.url, resolve(import.meta.dir, "../../migrations/postgres"));
    await first.ensureBootstrapApiKey("synthetic-pg", principal);
    const bytes = new TextEncoder().encode("synthetic postgres archive fixture");
    const publish = (slug: string) => first.publishSkill({ principal, slug, displayName: "Legacy", description: "Fixture", category: "Test", tags: ["fixture"], source: "custom", kind: "instruction", version: "1.0.0", skillMd: "# Legacy\n", bundle: { sha256: "a".repeat(64), byteSize: bytes.byteLength, contentType: "application/gzip", storageKind: "db", bytes } });
    const selection = (slug: string) => ({ slug, version: "1.0.0", bundleDigest: `sha256:${"a".repeat(64)}` });
    for (const [slug, profileId, archiveFirst] of [["legacy-skill", "fleet-archive-first", true], ["legacy-skill-two", "fleet-profile-first", false]] as const) {
      const published = await publish(slug);
      await first.selectionStore.saveProfile(principal, profileId, [], null);
      const profile = await first.selectionStore.getProfile(principal, profileId);
      const archiveOp = first.setSkillLifecycle(principal, slug, { lifecycle: "archived", reason: "synthetic replacement" }, published.revisionId);
      const selectionOp = second.selectionStore.saveProfile(principal, profileId, [selection(slug)], profile!.revision);
      const [archive, selectedResult] = archiveFirst
        ? await Promise.allSettled([archiveOp, selectionOp])
        : await Promise.allSettled([selectionOp, archiveOp]).then(([selectionResult, archiveResult]) => [archiveResult, selectionResult] as const);
      const archived = archive.status === "fulfilled" && archive.value?.lifecycle === "archived";
      const selected = selectedResult.status === "fulfilled" && selectedResult.value !== null;
      expect(Number(archived) + Number(selected)).toBe(1);
      if (archive.status === "rejected") expect(archive.reason).toMatchObject({ name: "SkillLifecycleConflictError" });
      const current = await first.getSkill(principal, slug);
      const finalProfile = await first.selectionStore.getProfile(principal, profileId);
      expect(current?.lifecycle).toBe(archived ? "archived" : "active");
      expect(finalProfile?.selections).toEqual(archived ? [] : [selection(slug)]);
    }
  } finally {
    await first.close();
    await second.close();
    const admin = await sql(adminUrl);
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${database.name}" WITH (FORCE)`);
    } finally {
      await admin.close?.();
    }
  }
});
