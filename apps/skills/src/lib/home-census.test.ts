import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SYNC_MARKER_FILE, SYNC_MARKER_MANAGED_BY } from "./agent-sync.js";
import { INSTALLED_SKILLS_DIRNAME } from "./config.js";
import { censusHomeDrift } from "./home-census.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * Home drift census — skills sync --check. Three drift classes:
 * missing-from-home (canonical skill absent from an existing home),
 * stray-in-home (marked dir with no canonical entry), diverged (marked dir
 * whose SKILL.md hash differs from canonical). Unmarked dirs are adoption
 * candidates, never drift. A home that does not exist is not checked.
 */

const created: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "skills-census-home-"));
  created.push(dir);
  return dir;
}

function corpusDir(home: string): string {
  return join(home, ".hasna", "skills", INSTALLED_SKILLS_DIRNAME);
}

function writeSkillMd(dir: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
}

function mark(dir: string): void {
  writeFileSync(join(dir, SYNC_MARKER_FILE), JSON.stringify({ managedBy: SYNC_MARKER_MANAGED_BY }));
}

const SKILL_CONTENT = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\nbody\n`;

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("censusHomeDrift", () => {
  test("clean when every canonical skill is present, marked, and matching", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha"));
    mark(join(home, ".claude", "skills", "alpha"));

    const census = censusHomeDrift({ homeDir: home });

    expect(census.clean).toBe(true);
    expect(census.entries).toEqual([]);
    expect(census.homesChecked).toBe(1);
    expect(census.managed).toBe(1);
  });

  test("diverged when a marked home copy differs from canonical", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha") + "drift\n");
    mark(join(home, ".claude", "skills", "alpha"));

    const census = censusHomeDrift({ homeDir: home });

    expect(census.clean).toBe(false);
    expect(census.entries).toHaveLength(1);
    expect(census.entries[0]).toMatchObject({ agent: "claude", skill: "alpha", kind: "diverged" });
    expect(census.entries[0].homeHash).not.toBe(census.entries[0].canonicalHash);
  });

  test("stray-in-home when a marked dir has no canonical entry", () => {
    const home = tempHome();
    writeSkillMd(join(home, ".claude", "skills", "orphan"), SKILL_CONTENT("orphan"));
    mark(join(home, ".claude", "skills", "orphan"));

    const census = censusHomeDrift({ homeDir: home });

    expect(census.clean).toBe(false);
    expect(census.entries).toHaveLength(1);
    expect(census.entries[0]).toMatchObject({ agent: "claude", skill: "orphan", kind: "stray-in-home" });
  });

  test("missing-from-home when a canonical skill is absent from an existing home", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    // The home exists (another skill is present) but alpha is missing there.
    writeSkillMd(join(home, ".claude", "skills", "beta"), SKILL_CONTENT("beta"));
    mark(join(home, ".claude", "skills", "beta"));

    const census = censusHomeDrift({ homeDir: home });

    expect(census.clean).toBe(false);
    const missing = census.entries.filter((entry) => entry.kind === "missing-from-home");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ agent: "claude", skill: "alpha" });
  });

  test("a home that does not exist is not checked and produces no missing-from-home noise", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "beta"), SKILL_CONTENT("beta"));

    // Only claude exists; codewith/codex/opencode/cursor homes are absent.
    const census = censusHomeDrift({ homeDir: home });

    expect(census.homesChecked).toBe(1);
    expect(census.entries.filter((entry) => entry.kind === "missing-from-home")).toHaveLength(1);
    expect(census.clean).toBe(false);
  });

  test("unmarked dirs are counted, never reported as drift", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha") + "drift\n");
    writeSkillMd(join(home, ".claude", "skills", "unmarked"), SKILL_CONTENT("unmarked"));

    const census = censusHomeDrift({ homeDir: home });

    expect(census.unmarked).toBe(2);
    expect(census.managed).toBe(0);
    expect(census.entries.filter((entry) => entry.kind === "diverged")).toEqual([]);
  });

  test("clean is true when no homes exist at all", () => {
    const home = tempHome();
    const census = censusHomeDrift({ homeDir: home });
    expect(census.homesChecked).toBe(0);
    expect(census.clean).toBe(true);
    expect(existsSync(join(home, ".hasna", "skills"))).toBe(false);
  });
});
