/**
 * The bundled corpus becomes ordinary published, versioned skills on boot (hasna/apps#1630):
 * every static skill gets a slug@<version> row, re-running seeds nothing, and a later
 * package version adds a new version row rather than touching the old one.
 */
import { describe, expect, test } from "bun:test";
import { publicPrincipal } from "./auth.js";
import { ArtifactStorage } from "./artifact-storage.js";
import { listServerSkills } from "./registry.js";
import { seedBundledCorpus } from "./seed-bundled.js";
import { MemorySkillsStore } from "./store.js";
import { resolveStoreBackends } from "./store-fixtures.js";
import type { ServerSkillRecord } from "./types.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

describe("seedBundledCorpus", () => {
  test("publishes every bundled skill once per version and is idempotent", async () => {
    const store = new MemorySkillsStore();
    const artifactStorage = new ArtifactStorage();
    const principal = publicPrincipal();
    const catalog = listServerSkills();
    expect(catalog.length).toBeGreaterThan(50);

    const first = await seedBundledCorpus({ store, artifactStorage, principal, version: "0.0.0-test" });
    expect(first.failed).toEqual([]);
    expect(first.seeded).toHaveLength(catalog.length);
    expect(first.seeded.every((entry) => entry.endsWith("@0.0.0-test"))).toBe(true);

    const second = await seedBundledCorpus({ store, artifactStorage, principal, version: "0.0.0-test" });
    expect(second.seeded).toEqual([]);
    expect(second.skipped).toHaveLength(catalog.length);

    const sample = catalog[0]!.name;
    const versions = await store.listSkillVersions(principal, sample);
    expect(versions.map((v) => v.version)).toEqual(["0.0.0-test"]);
    const row = await store.getSkill(principal, sample);
    expect(row?.source).toBe("bundled");
    expect(row?.bundleSha256).toBe(versions[0]!.bundleSha256);
    expect(await store.getSkillBundle(principal, versions[0]!.bundleSha256)).not.toBeNull();

    // A newer package version adds a row and leaves the old one untouched.
    const third = await seedBundledCorpus({ store, artifactStorage, principal, version: "0.0.1-test" });
    expect(third.failed).toEqual([]);
    expect(third.seeded).toHaveLength(catalog.length);
    const after = await store.listSkillVersions(principal, sample);
    expect(after.map((v) => v.version).sort()).toEqual(["0.0.0-test", "0.0.1-test"]);
    expect(after.every((v) => v.bundleSha256 === versions[0]!.bundleSha256)).toBe(true);
  });
});

// The startup path must protect tenant edits, including edits made after its read.
const backends = await resolveStoreBackends();
for (const backend of backends) {
  test(`${backend.name}: seed refresh preserves customer records and refuses racing edits/deletes`, async () => {
    const principal = publicPrincipal();
    const other = { ...principal, apiKeyId: "seed_other_key", orgId: "seed_other", orgSlug: "seed-other", userId: "seed_other_user", email: "seed-other@example.test" };
    const fixture = await backend.create([
      { token: "seed-fixture-bootstrap", principal },
      { token: "seed-fixture-other", principal: other },
    ]);
    const { store } = fixture;
    const artifactStorage = new ArtifactStorage();
    try {
      const first = await seedBundledCorpus({ store, artifactStorage, principal, version: "seed-first" });
      expect(first.failed).toEqual([]);
      const [custom, deleted, edited, legacy, racedCustom, racedDelete, racedMetadata, ordinary] = listServerSkills().slice(0, 8).map((skill) => skill.name) as [string, string, string, string, string, string, string, string];
      const originals = new Map(await Promise.all([custom, deleted, edited, legacy, racedCustom, racedDelete, racedMetadata, ordinary].map(async (slug) => [slug, (await store.getSkill(principal, slug))!] as const)));
      const immutable = await store.getSkillVersion(principal, ordinary, "seed-first");
      await store.publishSkill({ ...originals.get(custom)!, principal, source: "custom", skillMd: "# Customer custom document", expectedRevisionId: originals.get(custom)!.revisionId });
      await store.deleteSkill(principal, deleted, 86_400_000);
      await store.updateSkill(principal, edited, { description: "Customer description", skillMd: "# Customer metadata edit" }, originals.get(edited)!.revisionId);
      // Simulates an older unmarked seed; source/bundle equality is not proof of ownership.
      await store.publishSkill({ ...originals.get(legacy)!, principal, version: "legacy-unmarked", expectedRevisionId: originals.get(legacy)!.revisionId });
      await store.publishSkill({ ...originals.get(ordinary)!, principal: other, source: "custom", skillMd: "# Other tenant" });
      const untouched = new Map(await Promise.all([custom, deleted, edited, legacy].map(async (slug) => [slug, await store.getSkill(principal, slug)] as const)));
      const otherBefore = await store.getSkill(other, ordinary);
      const raceSnapshots = new Map<string, ServerSkillRecord | null>();
      const publish = store.publishSkill.bind(store);
      // Injection occurs at the final store boundary, AFTER storePublishedSkill's read
      // and artifact preparation. The actual backend still performs the guarded write.
      store.publishSkill = async (input) => {
        if (input.seedBundledOnly && [racedCustom, racedDelete, racedMetadata].includes(input.slug)) {
          const before = (await store.getSkill(principal, input.slug))!;
          if (input.slug === racedDelete) await store.deleteSkill(principal, input.slug, 86_400_000);
          else if (input.slug === racedMetadata) await store.updateSkill(principal, input.slug, { description: "Racing metadata edit" }, before.revisionId);
          else await publish({ ...before, principal, source: "custom", skillMd: "# Racing customer", expectedRevisionId: before.revisionId });
          raceSnapshots.set(input.slug, await store.getSkill(principal, input.slug));
        }
        return publish(input);
      };
      const next = await seedBundledCorpus({ store, artifactStorage, principal, version: "seed-next" });
      store.publishSkill = publish;
      expect(next.failed).toEqual([]);
      for (const slug of [custom, deleted, edited, legacy, racedCustom, racedDelete, racedMetadata]) {
        expect(next.skipped).toContain(slug);
        expect(await store.getSkill(principal, slug)).toEqual(untouched.get(slug) ?? raceSnapshots.get(slug) ?? null);
        expect(await store.getSkillVersion(principal, slug, "seed-next")).toBeNull();
      }
      expect(raceSnapshots.size).toBe(3);
      expect(await store.getSkill(other, ordinary)).toEqual(otherBefore);
      expect(await store.getSkillVersion(principal, ordinary, "seed-first")).toEqual(immutable);
      expect(next.seeded).toContain(`${ordinary}@seed-next`);
      const refreshed = (await store.getSkill(principal, ordinary))!;
      expect(refreshed.version).toBe("seed-next");
      const provenance = (await store.getSkillVersion(principal, ordinary, "seed-next"))!.manifest.provenance as Record<string, unknown>;
      expect(provenance.seededRevisionId).toBe(refreshed.revisionId);
      // Explicit user publishing still revives a tombstone; only boot seeds refuse it.
      const revived = await store.publishSkill({ ...originals.get(deleted)!, principal, source: "custom", skillMd: "# Explicit revive" });
      expect(revived.tombstonedAt).toBeUndefined();
      expect(revived.skillMd).toBe("# Explicit revive");
    } finally {
      await fixture.close();
    }
  });
}
