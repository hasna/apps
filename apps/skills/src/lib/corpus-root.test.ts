/**
 * Regression tests for the split corpus root (todos 50229cf1, bug 170b0e9b).
 *
 * Before the fix, list/search/info/push resolved the local corpus to
 * <app folder>/installed/ (getPortableSkillsRoot) while `skills storage migrate`
 * had moved the corpus to <app folder>/skills/ (marked by skills/
 * .layout-migration.json) — so local discovery and the publish path were
 * silently blind to the migrated corpus.
 *
 * These tests pin the canonical resolution — rootDir -> migrated skills/ cache
 * -> installed/ — across every local discovery and publish path, and pin the
 * pre-migration layout as the no-regression state.
 */
import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

import { DATA_DIR_ENV, INSTALLED_SKILLS_DIRNAME } from "./config.js";
import { LAYOUT_MIGRATION_RECORD, resolveCorpusRoot, SKILLS_CACHE_DIRNAME } from "./home-migration.js";
import {
  getPortableSkillsRoot,
  listPortableSkillMetas,
  listPortableSkills,
  scaffoldPortableSkill,
} from "./portable-skills.js";
import { clearRegistryCache, loadRegistry, searchSkills } from "./registry.js";
import { getSkillDocs } from "./skillinfo.js";
import { PushSkillError, pushSkill } from "../cli/commands/publish.js";
import { resolveSyncCorpus } from "./agent-sync.js";

const created: string[] = [];
const ambientDataDir = process.env[DATA_DIR_ENV];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "skills-corpus-root-home-"));
  created.push(dir);
  return dir;
}

function appDir(home: string): string {
  return join(home, ".hasna", "skills");
}

/** Write the migration record that makes skills/ the canonical corpus. */
function writeMigrationRecord(app: string): void {
  mkdirSync(join(app, SKILLS_CACHE_DIRNAME), { recursive: true });
  writeFileSync(
    join(app, SKILLS_CACHE_DIRNAME, LAYOUT_MIGRATION_RECORD),
    `${JSON.stringify({ version: 1, migratedAt: new Date().toISOString(), moved: ["installed"], note: "test" })}\n`,
  );
}

/** Seed a skill that exists ONLY in <app>/skills (the migrated corpus). */
function seedMigratedOnlySkill(home: string): void {
  scaffoldPortableSkill("migrated-only-skill", {
    homeDir: home,
    kind: "instruction",
    description: "Only present in the migrated corpus",
  });
}

afterEach(() => {
  clearRegistryCache();
  if (ambientDataDir === undefined) delete process.env[DATA_DIR_ENV];
  else process.env[DATA_DIR_ENV] = ambientDataDir;
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("canonical corpus root — migrated owner layout", () => {
  test("resolver and list/metas read <app>/skills once the migration record exists", () => {
    const home = tempHome();
    const app = appDir(home);
    writeMigrationRecord(app);
    seedMigratedOnlySkill(home);

    expect(resolveCorpusRoot({ homeDir: home })).toBe(join(app, SKILLS_CACHE_DIRNAME));
    expect(getPortableSkillsRoot({ homeDir: home })).toBe(join(app, SKILLS_CACHE_DIRNAME));

    const names = listPortableSkills({ homeDir: home }).map((s) => s.name);
    expect(names).toContain("migrated-only-skill");
    const metaNames = listPortableSkillMetas({ homeDir: home }).map((s) => s.name);
    expect(metaNames).toContain("migrated-only-skill");
  });

  test("list/search/info/push/sync all see a skill present only in the migrated corpus", async () => {
    const home = tempHome();
    const app = appDir(home);
    writeMigrationRecord(app);
    seedMigratedOnlySkill(home);

    process.env[DATA_DIR_ENV] = app;
    clearRegistryCache();

    // Registry + list: 86 official catalog entries + the migrated-corpus skill.
    const registry = loadRegistry();
    expect(registry.find((s) => s.name === "migrated-only-skill")).toBeDefined();
    expect(registry.length).toBe(87);

    // Search.
    const hits = searchSkills("migrated-only-skill");
    expect(hits.some((s) => s.name === "migrated-only-skill")).toBe(true);

    // Info (reads the skill path via the canonical resolver).
    const docs = getSkillDocs("migrated-only-skill");
    expect(docs?.skillMd).toContain("migrated-only-skill");

    // Push dry-run: resolves and validates the migrated-corpus skill.
    const pushed = await pushSkill("migrated-only-skill", { dryRun: true });
    expect(pushed.published).toBe(false);
    expect(pushed.path).toBe(join(app, SKILLS_CACHE_DIRNAME, "migrated-only-skill"));

    // Sync reads the migrated cache as the corpus root.
    const sync = resolveSyncCorpus({ homeDir: home });
    expect(sync.source).toBe("corpus");
    expect(sync.roots).toEqual([join(app, SKILLS_CACHE_DIRNAME)]);
  });

  test("no regression: without the record every path keeps reading installed/", async () => {
    const home = tempHome();
    const app = appDir(home);
    // A hand-made skills/ dir is NOT the corpus (the record is the authority).
    mkdirSync(join(app, SKILLS_CACHE_DIRNAME, "hand-made"), { recursive: true });
    writeFileSync(
      join(app, SKILLS_CACHE_DIRNAME, "hand-made", "SKILL.md"),
      "---\nname: hand-made\ndescription: not the corpus\nkind: instruction\n---\n",
    );
    scaffoldPortableSkill("installed-skill", {
      homeDir: home,
      kind: "instruction",
      description: "In the pre-migration corpus",
    });

    expect(resolveCorpusRoot({ homeDir: home })).toBe(join(app, INSTALLED_SKILLS_DIRNAME));
    expect(getPortableSkillsRoot({ homeDir: home })).toBe(join(app, INSTALLED_SKILLS_DIRNAME));

    const names = listPortableSkills({ homeDir: home }).map((s) => s.name);
    expect(names).toContain("installed-skill");
    expect(names).not.toContain("hand-made");

    process.env[DATA_DIR_ENV] = app;
    clearRegistryCache();

    const registry = loadRegistry();
    expect(registry.find((s) => s.name === "installed-skill")).toBeDefined();
    expect(registry.find((s) => s.name === "hand-made")).toBeUndefined();
    expect(searchSkills("hand-made")).toHaveLength(0);
    expect(getSkillDocs("hand-made")).toBeNull();

    await expect(pushSkill("hand-made", { dryRun: true })).rejects.toThrow(PushSkillError);
    await expect(pushSkill("hand-made", { dryRun: true })).rejects.toThrow(/not found in the local corpus/);

    const sync = resolveSyncCorpus({ homeDir: home });
    expect(sync.roots).toEqual([join(app, INSTALLED_SKILLS_DIRNAME)]);
  });
});
