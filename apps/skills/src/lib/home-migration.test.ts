import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { INSTALLED_SKILLS_DIRNAME } from "./config.js";
import {
  LAYOUT_MIGRATION_RECORD,
  LOGS_DIRNAME,
  OUTPUTS_DIRNAME,
  SKILLS_CACHE_DIRNAME,
  isOwnerLayoutMigrated,
  migrateOwnerLayout,
  resolveCorpusRoot,
  type LayoutMigrationRecord,
} from "./home-migration.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * The owner layout: the skills data root/{skills,logs,outputs}. skills/ replaces
 * installed/ as the corpus home and becomes the sync source; legacy flat skill
 * dirs at the app root migrate into it; custom/ stays; logs/ and outputs/ are
 * created lazily. Migration is opt-in, idempotent, and refuses a non-empty
 * conflicting destination.
 */

const created: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "skills-migration-home-"));
  created.push(dir);
  return dir;
}

function appDir(home: string): string {
  return join(home, ".hasna", "skills");
}

function writeSkill(parent: string, name: string): string {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\n`);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("migrateOwnerLayout", () => {
  test("moves installed/ and legacy flat dirs into skills/, writes the record, leaves custom/ alone", () => {
    const home = tempHome();
    const app = appDir(home);

    writeSkill(join(app, INSTALLED_SKILLS_DIRNAME), "corpus-skill");
    writeSkill(app, "legacy-skill");
    writeSkill(join(app, "custom"), "custom-skill");
    writeFileSync(join(app, "config.json"), "{}");

    const result = migrateOwnerLayout({ homeDir: home });

    expect(result.status).toBe("migrated");
    expect(result.moved.sort()).toEqual([INSTALLED_SKILLS_DIRNAME, "legacy-skill"]);
    expect(existsSync(join(app, INSTALLED_SKILLS_DIRNAME))).toBe(false);
    expect(existsSync(join(app, "skills", "corpus-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(app, "skills", "legacy-skill", "SKILL.md"))).toBe(true);
    // custom/ is retained, untouched, and not part of the migration.
    expect(existsSync(join(app, "custom", "custom-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(app, "skills", "custom-skill"))).toBe(false);
    // App data stays at the app root.
    expect(existsSync(join(app, "config.json"))).toBe(true);
    // logs/ and outputs/ are created lazily.
    expect(existsSync(join(app, LOGS_DIRNAME))).toBe(true);
    expect(existsSync(join(app, OUTPUTS_DIRNAME))).toBe(true);

    const record = JSON.parse(readFileSync(join(app, SKILLS_CACHE_DIRNAME, LAYOUT_MIGRATION_RECORD), "utf-8")) as LayoutMigrationRecord;
    expect(record.version).toBe(1);
    expect(record.migratedAt).toBeTruthy();
    expect(record.moved.sort()).toEqual([INSTALLED_SKILLS_DIRNAME, "legacy-skill"]);
  });

  test("is idempotent: a second run is a no-op and changes nothing", () => {
    const home = tempHome();
    const app = appDir(home);
    writeSkill(join(app, INSTALLED_SKILLS_DIRNAME), "corpus-skill");

    expect(migrateOwnerLayout({ homeDir: home }).status).toBe("migrated");
    const before = readdirSync(join(app, SKILLS_CACHE_DIRNAME)).sort();
    const recordBefore = readFileSync(join(app, SKILLS_CACHE_DIRNAME, LAYOUT_MIGRATION_RECORD), "utf-8");

    const second = migrateOwnerLayout({ homeDir: home });
    expect(second.status).toBe("already-migrated");
    expect(second.moved).toEqual([]);
    expect(readdirSync(join(app, SKILLS_CACHE_DIRNAME)).sort()).toEqual(before);
    expect(readFileSync(join(app, SKILLS_CACHE_DIRNAME, LAYOUT_MIGRATION_RECORD), "utf-8")).toBe(recordBefore);
  });

  test("refuses a non-empty skills/ destination with no migration record", () => {
    const home = tempHome();
    const app = appDir(home);
    writeSkill(join(app, SKILLS_CACHE_DIRNAME), "somebody-elses-cache");
    writeSkill(join(app, INSTALLED_SKILLS_DIRNAME), "corpus-skill");

    const result = migrateOwnerLayout({ homeDir: home });

    expect(result.status).toBe("refused");
    expect(result.reason).toContain("non-empty destination");
    // Nothing moved.
    expect(existsSync(join(app, INSTALLED_SKILLS_DIRNAME, "corpus-skill"))).toBe(true);
    expect(existsSync(join(app, SKILLS_CACHE_DIRNAME, "corpus-skill"))).toBe(false);
    expect(isOwnerLayoutMigrated(app)).toBe(false);
  });

  test("refuses a per-entry collision between a legacy dir and an existing skills/<name>", () => {
    const home = tempHome();
    const app = appDir(home);
    writeSkill(join(app, INSTALLED_SKILLS_DIRNAME), "shared");
    writeSkill(app, "shared");

    const result = migrateOwnerLayout({ homeDir: home });

    expect(result.status).toBe("refused");
    expect(result.reason).toContain("collides");
    expect(existsSync(join(app, "shared", "SKILL.md"))).toBe(true);
    expect(existsSync(join(app, INSTALLED_SKILLS_DIRNAME, "shared", "SKILL.md"))).toBe(true);
  });

  test("dry-run reports the moves and writes nothing", () => {
    const home = tempHome();
    const app = appDir(home);
    writeSkill(join(app, INSTALLED_SKILLS_DIRNAME), "corpus-skill");
    writeSkill(app, "legacy-skill");

    const result = migrateOwnerLayout({ homeDir: home, dryRun: true });

    expect(result.status).toBe("migrated");
    expect(result.reason).toContain("dry-run");
    expect(result.moved.sort()).toEqual([INSTALLED_SKILLS_DIRNAME, "legacy-skill"]);
    expect(existsSync(join(app, INSTALLED_SKILLS_DIRNAME, "corpus-skill"))).toBe(true);
    expect(existsSync(join(app, "legacy-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(app, SKILLS_CACHE_DIRNAME))).toBe(false);
    expect(existsSync(join(app, LOGS_DIRNAME))).toBe(false);
  });

  test("nothing-to-do when there is no installed/ and no legacy dirs; logs/outputs still created", () => {
    const home = tempHome();
    const app = appDir(home);
    mkdirSync(join(app, "custom"), { recursive: true });

    const result = migrateOwnerLayout({ homeDir: home });

    expect(result.status).toBe("nothing-to-do");
    expect(result.moved).toEqual([]);
    expect(existsSync(join(app, LOGS_DIRNAME))).toBe(true);
    expect(existsSync(join(app, OUTPUTS_DIRNAME))).toBe(true);
    expect(existsSync(join(app, SKILLS_CACHE_DIRNAME))).toBe(false);
    expect(isOwnerLayoutMigrated(app)).toBe(false);
  });
});

describe("resolveCorpusRoot", () => {
  test("rootDir wins and gets no suffix", () => {
    const explicit = join(tmpdir(), "skills-rootdir-test");
    created.push(explicit);
    expect(resolveCorpusRoot({ rootDir: explicit })).toBe(explicit);
  });

  test("returns installed/ before migration", () => {
    const home = tempHome();
    const app = appDir(home);
    writeSkill(join(app, INSTALLED_SKILLS_DIRNAME), "corpus-skill");
    expect(resolveCorpusRoot({ homeDir: home })).toBe(join(app, INSTALLED_SKILLS_DIRNAME));
  });

  test("returns skills/ once migrated, even when installed/ is gone", () => {
    const home = tempHome();
    const app = appDir(home);
    writeSkill(join(app, INSTALLED_SKILLS_DIRNAME), "corpus-skill");
    migrateOwnerLayout({ homeDir: home });

    expect(resolveCorpusRoot({ homeDir: home })).toBe(join(app, SKILLS_CACHE_DIRNAME));
  });

  test("a hand-made skills/ dir without a record is not the corpus", () => {
    const home = tempHome();
    const app = appDir(home);
    writeSkill(join(app, SKILLS_CACHE_DIRNAME), "hand-made");
    expect(resolveCorpusRoot({ homeDir: home })).toBe(join(app, INSTALLED_SKILLS_DIRNAME));
  });
});
