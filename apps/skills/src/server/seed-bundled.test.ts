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
