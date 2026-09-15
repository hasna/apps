import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "./config.js";
import { writeOwnedFixture } from "./private-corpus-test-utils.js";
import { getSkillBestDoc } from "./skillinfo.js";
import { BASIC_SKILL_NAMES, CATEGORIES, SKILLS, getSkill, getSkillsByCategory, searchSkills, getSkillsByTag,
  getAllTags, loadRegistry, loadBasicRegistry, clearRegistryCache, type Category } from "./registry.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

beforeEach(() => {
  writeOwnedFixture("owned-report", { displayName: "Owned Report", description: "Synthetic market clusters", tags: ["report", "marketing", "api"] });
  writeOwnedFixture("owned-proposal", { description: "Synthetic proposal example", tags: ["proposal", "email"], category: "Research & Writing" });
});

describe("account-owned local registry", () => {
  test("the software exports no bundled catalog or default selection", () => {
    expect(SKILLS).toEqual([]); expect(BASIC_SKILL_NAMES).toEqual([]);
    expect(CATEGORIES).toHaveLength(17); expect(new Set(CATEGORIES).size).toBe(CATEGORIES.length);
    expect(loadRegistry().map(s => s.name)).toEqual(["owned-proposal", "owned-report"]);
    expect(loadBasicRegistry()).toEqual(loadRegistry());
  });
  test("exact lookup returns owned metadata and unknown names remain absent", () => {
    expect(getSkill("owned-report")).toMatchObject({ name: "owned-report", displayName: "Owned Report", source: "custom" });
    expect(getSkill("missing-fixture")).toBeUndefined();
  });
  test("category filtering partitions the owned catalog", () => {
    expect(getSkillsByCategory("Development Tools").map(s => s.name)).toEqual(["owned-report"]);
    expect(getSkillsByCategory("Research & Writing").map(s => s.name)).toEqual(["owned-proposal"]);
    expect(getSkillsByCategory("Not A Category" as Category)).toEqual([]);
    expect(CATEGORIES.flatMap(c => getSkillsByCategory(c))).toHaveLength(2);
  });
  test("search covers names, display names, descriptions, tags, case and approximate matches", () => {
    for (const query of ["owned-report", "Owned Report", "clusters", "marketing", "API"]) {
      expect(searchSkills(query).map(s => s.name)).toContain("owned-report");
    }
    for (const query of ["prosal", "emal", "prop"]) expect(searchSkills(query).map(s => s.name)).toContain("owned-proposal");
    expect(searchSkills("zzzz-unmatched")).toEqual([]);
    expect(searchSkills("synthetic")).toHaveLength(2);
  });
  test("tag matching is case insensitive and supports partial matches", () => {
    expect(getSkillsByTag("api").map(s => s.name)).toEqual(["owned-report"]);
    expect(getSkillsByTag("API")).toEqual(getSkillsByTag("api"));
    expect(getSkillsByTag("mark")).toHaveLength(1);
    expect(getSkillsByTag("absent-tag")).toEqual([]);
    expect(getAllTags()).toEqual(["api", "email", "marketing", "proposal", "report"]);
  });
  test("cache holds a snapshot until invalidated", () => {
    const first = loadRegistry(); expect(loadRegistry()).toBe(first);
    writeOwnedFixture("later-fixture");
    expect(loadRegistry()).not.toBe(first); expect(loadRegistry()).toHaveLength(3);
  });
  test("explicit extensions stay external and an owned cache entry takes precedence", () => {
    const root = getDataDir(), extensionsDir = join(root, "extension-source");
    for (const slug of ["extension-only", "owned-report"]) {
      const dir = join(extensionsDir, slug); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: Explicit source\nkind: instruction\n---\n`);
    }
    writeFileSync(join(root, "config.json"), JSON.stringify({ extensionsDir })); clearRegistryCache();
    expect(getSkill("extension-only")).toMatchObject({ source: "extension", description: "Explicit source" });
    expect(getSkill("owned-report")).toMatchObject({ source: "custom", description: "Synthetic market clusters" });
    expect(getSkillBestDoc("extension-only")).toContain("Explicit source");
    expect(existsSync(join(root, "installed", "extension-only"))).toBe(false);
  });
});
