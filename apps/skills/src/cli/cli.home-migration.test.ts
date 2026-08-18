import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli } from "./cli.test-utils";
import { SYNC_MARKER_FILE } from "../lib/agent-sync.js";
import { INSTALLED_SKILLS_DIRNAME } from "../lib/config.js";
import { LAYOUT_MIGRATION_RECORD, SKILLS_CACHE_DIRNAME } from "../lib/home-migration.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * CLI surface for the owner layout migration, unmarked-home adoption, and the
 * home drift census: skills storage migrate, skills sync --check/--adopt/
 * --prune, and the de-pin-gated skills diff / outdated.
 */

const created: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "skills-cli-home-migration-"));
  created.push(dir);
  return dir;
}

const SKILL_CONTENT = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\nkind: instruction\n---\n\n# ${name}\nbody\n`;

function writeSkillMd(dir: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("skills storage migrate", () => {
  test("moves installed/ into skills/ and writes the record; sync then reads the migrated cache", async () => {
    const home = tempHome();
    const app = join(home, ".hasna", "skills");
    writeSkillMd(join(app, INSTALLED_SKILLS_DIRNAME, "alpha"), SKILL_CONTENT("alpha"));

    const before = await runCli(["sync", "--for", "claude", "--dry-run", "--json"], { HOME: home });
    expect(before.exitCode).toBe(0);
    expect(JSON.parse(before.stdout).actions.some((a: any) => a.skill === "alpha")).toBe(true);

    const migrated = await runCli(["storage", "migrate", "--json"], { HOME: home });
    expect(migrated.exitCode).toBe(0);
    const result = JSON.parse(migrated.stdout);
    expect(result.status).toBe("migrated");
    expect(result.moved).toEqual([INSTALLED_SKILLS_DIRNAME]);
    expect(existsSync(join(app, INSTALLED_SKILLS_DIRNAME))).toBe(false);
    expect(existsSync(join(app, SKILLS_CACHE_DIRNAME, "alpha", "SKILL.md"))).toBe(true);
    expect(existsSync(join(app, SKILLS_CACHE_DIRNAME, LAYOUT_MIGRATION_RECORD))).toBe(true);
    expect(existsSync(join(app, "logs"))).toBe(true);
    expect(existsSync(join(app, "outputs"))).toBe(true);

    // Sync source switches to the migrated cache: the corpus is still readable.
    const after = await runCli(["sync", "--for", "claude", "--dry-run", "--json"], { HOME: home });
    expect(after.exitCode).toBe(0);
    expect(JSON.parse(after.stdout).actions.some((a: any) => a.skill === "alpha")).toBe(true);

    // Every local discovery surface reads the migrated cache too — list/search/info
    // were silently blind to skills/ before the fix (bug 170b0e9b, todos 50229cf1).
    const listed = await runCli(["list", "--all", "--json"], { HOME: home });
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout).some((s: any) => s.name === "alpha")).toBe(true);

    const searched = await runCli(["search", "alpha", "--all", "--json"], { HOME: home });
    expect(searched.exitCode).toBe(0);
    expect(JSON.parse(searched.stdout).some((s: any) => s.name === "alpha")).toBe(true);

    const info = await runCli(["info", "alpha", "--json"], { HOME: home });
    expect(info.exitCode).toBe(0);
    expect(JSON.parse(info.stdout).name).toBe("alpha");

    // Idempotent from the CLI too.
    const again = await runCli(["storage", "migrate", "--json"], { HOME: home });
    expect(JSON.parse(again.stdout).status).toBe("already-migrated");
  });

  test("refuses a non-empty conflicting skills/ destination", async () => {
    const home = tempHome();
    const app = join(home, ".hasna", "skills");
    writeSkillMd(join(app, SKILLS_CACHE_DIRNAME, "cache-entry"), SKILL_CONTENT("cache-entry"));
    writeSkillMd(join(app, INSTALLED_SKILLS_DIRNAME, "alpha"), SKILL_CONTENT("alpha"));

    const migrated = await runCli(["storage", "migrate", "--json"], { HOME: home });

    expect(migrated.exitCode).toBe(1);
    const result = JSON.parse(migrated.stdout);
    expect(result.status).toBe("refused");
    expect(existsSync(join(app, INSTALLED_SKILLS_DIRNAME, "alpha"))).toBe(true);
  });
});

describe("skills sync --check", () => {
  test("exits 0 when homes are clean", async () => {
    const home = tempHome();
    const app = join(home, ".hasna", "skills");
    writeSkillMd(join(app, INSTALLED_SKILLS_DIRNAME, "alpha"), SKILL_CONTENT("alpha"));
    const claudeSkill = join(home, ".claude", "skills", "alpha");
    writeSkillMd(claudeSkill, SKILL_CONTENT("alpha"));
    writeFileSync(join(claudeSkill, SYNC_MARKER_FILE), JSON.stringify({ managedBy: "@hasna/skills" }));

    const check = await runCli(["sync", "--check", "--json"], { HOME: home });

    expect(check.exitCode).toBe(0);
    expect(JSON.parse(check.stdout).clean).toBe(true);
  });

  test("exits 1 listing missing/stray/diverged drift", async () => {
    const home = tempHome();
    const app = join(home, ".hasna", "skills");
    writeSkillMd(join(app, INSTALLED_SKILLS_DIRNAME, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(app, INSTALLED_SKILLS_DIRNAME, "beta"), SKILL_CONTENT("beta"));
    // diverged: marked, content differs.
    const alphaDir = join(home, ".claude", "skills", "alpha");
    writeSkillMd(alphaDir, SKILL_CONTENT("alpha") + "drift\n");
    writeFileSync(join(alphaDir, SYNC_MARKER_FILE), JSON.stringify({ managedBy: "@hasna/skills" }));
    // stray: marked, no canonical entry.
    const strayDir = join(home, ".claude", "skills", "orphan");
    writeSkillMd(strayDir, SKILL_CONTENT("orphan"));
    writeFileSync(join(strayDir, SYNC_MARKER_FILE), JSON.stringify({ managedBy: "@hasna/skills" }));
    // beta is missing from the home entirely.

    const check = await runCli(["sync", "--check", "--json"], { HOME: home });

    expect(check.exitCode).toBe(1);
    const census = JSON.parse(check.stdout);
    expect(census.clean).toBe(false);
    const kinds = census.entries.map((entry: any) => `${entry.agent}/${entry.skill}/${entry.kind}`);
    expect(kinds).toContain("claude/alpha/diverged");
    expect(kinds).toContain("claude/orphan/stray-in-home");
    expect(kinds).toContain("claude/beta/missing-from-home");
  });
});

describe("skills sync --adopt", () => {
  test("dry-run by default: reports adoptable, writes no marker", async () => {
    const home = tempHome();
    const app = join(home, ".hasna", "skills");
    writeSkillMd(join(app, INSTALLED_SKILLS_DIRNAME, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha"));

    const adopt = await runCli(["sync", "--adopt", "--json"], { HOME: home });

    expect(adopt.exitCode).toBe(0);
    const result = JSON.parse(adopt.stdout);
    expect(result.dryRun).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.adoptable).toHaveLength(1);
    expect(existsSync(join(home, ".claude", "skills", "alpha", SYNC_MARKER_FILE))).toBe(false);
  });

  test("--apply writes markers and the conflicts ledger, skips diverged dirs", async () => {
    const home = tempHome();
    const app = join(home, ".hasna", "skills");
    writeSkillMd(join(app, INSTALLED_SKILLS_DIRNAME, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(app, INSTALLED_SKILLS_DIRNAME, "beta"), SKILL_CONTENT("beta"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "beta"), SKILL_CONTENT("beta") + "drift\n");

    const adopt = await runCli(["sync", "--adopt", "--apply", "--json"], { HOME: home });

    expect(adopt.exitCode).toBe(0);
    const result = JSON.parse(adopt.stdout);
    expect(result.applied).toBe(true);
    expect(result.adoptable).toHaveLength(1);
    expect(result.conflicts).toHaveLength(1);
    expect(existsSync(join(home, ".claude", "skills", "alpha", SYNC_MARKER_FILE))).toBe(true);
    expect(existsSync(join(home, ".claude", "skills", "beta", SYNC_MARKER_FILE))).toBe(false);
    expect(existsSync(join(app, "conflicts.json"))).toBe(true);
    expect(result.rollbackFile).toContain("rollback");
  });
});

describe("skills sync --prune", () => {
  test("--apply removes only marked-and-stray dirs after recording them", async () => {
    const home = tempHome();
    const app = join(home, ".hasna", "skills");
    writeSkillMd(join(app, INSTALLED_SKILLS_DIRNAME, "alpha"), SKILL_CONTENT("alpha"));
    const strayDir = join(home, ".claude", "skills", "orphan");
    writeSkillMd(strayDir, SKILL_CONTENT("orphan"));
    writeFileSync(join(strayDir, SYNC_MARKER_FILE), JSON.stringify({ managedBy: "@hasna/skills" }));
    const alphaDir = join(home, ".claude", "skills", "alpha");
    writeSkillMd(alphaDir, SKILL_CONTENT("alpha"));
    writeFileSync(join(alphaDir, SYNC_MARKER_FILE), JSON.stringify({ managedBy: "@hasna/skills" }));
    const handDir = join(home, ".claude", "skills", "hand-authored");
    writeSkillMd(handDir, SKILL_CONTENT("hand-authored"));

    const prune = await runCli(["sync", "--prune", "--apply", "--json"], { HOME: home });

    expect(prune.exitCode).toBe(0);
    const result = JSON.parse(prune.stdout);
    expect(result.pruned).toBe(1);
    expect(result.candidates.map((entry: any) => entry.skill)).toEqual(["orphan"]);
    expect(existsSync(strayDir)).toBe(false);
    expect(existsSync(alphaDir)).toBe(true);
    expect(existsSync(handDir)).toBe(true);
    expect(result.rollbackFile).toContain("rollback");
  });
});

describe("skills diff / outdated are no longer pin-gated", () => {
  test("diff works on an unpinned skill, home-scoped", async () => {
    const home = tempHome();
    const app = join(home, ".hasna", "skills");
    writeSkillMd(join(app, INSTALLED_SKILLS_DIRNAME, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha"));
    writeFileSync(join(home, ".claude", "skills", "alpha", SYNC_MARKER_FILE), JSON.stringify({ managedBy: "@hasna/skills" }));

    const diff = await runCli(["diff", "alpha", "--json"], { HOME: home });

    expect(diff.exitCode).toBe(0);
    const result = JSON.parse(diff.stdout);
    expect(result.pinned).toBe(false);
    expect(result.canonical.present).toBe(true);
    const claude = result.homes.find((entry: any) => entry.agent === "claude");
    expect(claude).toMatchObject({ present: true, managed: true, diverged: false });
  });

  test("diff exits 1 when a managed home diverges", async () => {
    const home = tempHome();
    const app = join(home, ".hasna", "skills");
    writeSkillMd(join(app, INSTALLED_SKILLS_DIRNAME, "alpha"), SKILL_CONTENT("alpha"));
    const alphaDir = join(home, ".claude", "skills", "alpha");
    writeSkillMd(alphaDir, SKILL_CONTENT("alpha") + "drift\n");
    writeFileSync(join(alphaDir, SYNC_MARKER_FILE), JSON.stringify({ managedBy: "@hasna/skills" }));

    const diff = await runCli(["diff", "alpha", "--json"], { HOME: home });

    expect(diff.exitCode).toBe(1);
    expect(JSON.parse(diff.stdout).homes.find((entry: any) => entry.agent === "claude").diverged).toBe(true);
  });

  test("outdated reports home drift without any pins", async () => {
    const home = tempHome();
    const app = join(home, ".hasna", "skills");
    writeSkillMd(join(app, INSTALLED_SKILLS_DIRNAME, "alpha"), SKILL_CONTENT("alpha"));
    const alphaDir = join(home, ".claude", "skills", "alpha");
    writeSkillMd(alphaDir, SKILL_CONTENT("alpha") + "drift\n");
    writeFileSync(join(alphaDir, SYNC_MARKER_FILE), JSON.stringify({ managedBy: "@hasna/skills" }));

    const outdated = await runCli(["outdated", "--json"], { HOME: home });

    expect(outdated.exitCode).toBe(1);
    const result = JSON.parse(outdated.stdout);
    expect(result.pins).toEqual([]);
    expect(result.homes.diverged).toHaveLength(1);
  });

  test("--check and --adopt are mutually exclusive", async () => {
    const home = tempHome();
    const check = await runCli(["sync", "--check", "--adopt"], { HOME: home });
    expect(check.exitCode).toBe(1);
    expect(check.stderr).toContain("mutually exclusive");
  });
});
