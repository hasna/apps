import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SYNC_MARKER_FILE, SYNC_MARKER_MANAGED_BY, type SyncMarker } from "./agent-sync.js";
import { INSTALLED_SKILLS_DIRNAME } from "./config.js";
import {
  CONFLICTS_LEDGER_FILE,
  ROLLBACK_DIRNAME,
  adoptUnmarkedHomes,
  pruneStrayHomes,
  scanUnmarkedHomes,
  type HomeConflict,
} from "./home-adoption.js";
import { hashSkillMarkdown } from "./skill-hash.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * Unmarked-home adoption: hash each unmarked home SKILL.md against the
 * canonical corpus; exact match -> marker + adopt, differs -> conflicts ledger
 * + skip, no canonical entry -> unknown + skip. Dry-run by default; --apply
 * writes markers. Prune removes only marked-and-stray dirs, recorded before
 * removal. Nothing is ever deleted by adoption.
 */

const created: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "skills-adoption-home-"));
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

const SKILL_CONTENT = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\nbody\n`;

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function readMarker(dir: string): SyncMarker {
  return JSON.parse(readFileSync(join(dir, SYNC_MARKER_FILE), "utf-8")) as SyncMarker;
}

describe("scanUnmarkedHomes", () => {
  test("exact match (modulo user_invocable) is adoptable; claude-style copies match canonical", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    // A claude home copy carries user_invocable; the canonical one does not.
    const claudeCopy = SKILL_CONTENT("alpha").replace("description:", "user_invocable: true\ndescription:");
    writeSkillMd(join(home, ".claude", "skills", "alpha"), claudeCopy);
    // A codex home copy had user_invocable stripped by sed — identical bytes.
    writeSkillMd(join(home, ".codex", "skills", "alpha"), SKILL_CONTENT("alpha"));

    const scan = scanUnmarkedHomes({ homeDir: home });

    expect(scan.adoptable.map((entry) => `${entry.agent}/${entry.skill}`).sort()).toEqual([
      "claude/alpha",
      "codex/alpha",
    ]);
    expect(scan.conflicts).toEqual([]);
    expect(scan.unknown).toEqual([]);
  });

  test("content differs -> conflict entry with home hash, canonical hash and mtime", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha") + "drift\n");

    const scan = scanUnmarkedHomes({ homeDir: home });

    expect(scan.adoptable).toEqual([]);
    expect(scan.conflicts).toHaveLength(1);
    const conflict = scan.conflicts[0] as HomeConflict;
    expect(conflict.agent).toBe("claude");
    expect(conflict.skill).toBe("alpha");
    expect(conflict.hash).toBe(hashSkillMarkdown(SKILL_CONTENT("alpha") + "drift\n"));
    expect(conflict.canonicalHash).toBe(hashSkillMarkdown(SKILL_CONTENT("alpha")));
    expect(conflict.mtime).toBeTruthy();
  });

  test("no canonical entry -> unknown and skipped", () => {
    const home = tempHome();
    writeSkillMd(join(home, ".claude", "skills", "orphan"), SKILL_CONTENT("orphan"));

    const scan = scanUnmarkedHomes({ homeDir: home });

    expect(scan.adoptable).toEqual([]);
    expect(scan.unknown.map((entry) => entry.skill)).toEqual(["orphan"]);
  });

  test("marked dirs are counted as managed, never re-scanned", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "managed-only"), SKILL_CONTENT("managed-only"));
    writeFileSync(join(home, ".claude", "skills", "managed-only", SYNC_MARKER_FILE), JSON.stringify({ managedBy: SYNC_MARKER_MANAGED_BY }));

    const scan = scanUnmarkedHomes({ homeDir: home });

    expect(scan.managed).toBe(1);
    expect(scan.adoptable.map((entry) => entry.skill)).toEqual(["alpha"]);
  });

  test("unmarked dirs without SKILL.md are never touched or reported", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    mkdirSync(join(home, ".claude", "skills", "empty-dir"), { recursive: true });

    const scan = scanUnmarkedHomes({ homeDir: home });

    expect(scan.adoptable).toEqual([]);
    expect(scan.unknown).toEqual([]);
  });
});

describe("adoptUnmarkedHomes", () => {
  test("dry-run writes no marker, no ledger, no rollback record", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "beta"), SKILL_CONTENT("beta") + "drift\n");
    writeSkillMd(join(corpus, "beta"), SKILL_CONTENT("beta"));

    const result = adoptUnmarkedHomes({ homeDir: home });

    expect(result.applied).toBe(false);
    expect(result.rollbackFile).toBeUndefined();
    expect(existsSync(join(home, ".claude", "skills", "alpha", SYNC_MARKER_FILE))).toBe(false);
    expect(existsSync(join(home, ".hasna", "skills", CONFLICTS_LEDGER_FILE))).toBe(false);
    expect(existsSync(join(home, ".hasna", "skills", ROLLBACK_DIRNAME))).toBe(false);
    // The skill content itself is untouched either way.
    expect(readFileSync(join(home, ".claude", "skills", "beta", "SKILL.md"), "utf-8")).toContain("drift");
  });

  test("apply writes markers for exact matches, lands divergers in the ledger, skips both", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(corpus, "beta"), SKILL_CONTENT("beta"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "beta"), SKILL_CONTENT("beta") + "drift\n");
    writeSkillMd(join(home, ".claude", "skills", "orphan"), SKILL_CONTENT("orphan"));

    const result = adoptUnmarkedHomes({ homeDir: home, apply: true });

    expect(result.applied).toBe(true);
    // alpha: marker written; beta (diverged) and orphan (unknown): untouched.
    const marker = readMarker(join(home, ".claude", "skills", "alpha"));
    expect(marker.managedBy).toBe(SYNC_MARKER_MANAGED_BY);
    expect(marker.skill).toBe("alpha");
    expect(existsSync(join(home, ".claude", "skills", "beta", SYNC_MARKER_FILE))).toBe(false);
    expect(existsSync(join(home, ".claude", "skills", "orphan", SYNC_MARKER_FILE))).toBe(false);
    // Nothing was deleted or rewritten.
    expect(readFileSync(join(home, ".claude", "skills", "beta", "SKILL.md"), "utf-8")).toContain("drift");
    expect(existsSync(join(home, ".claude", "skills", "orphan", "SKILL.md"))).toBe(true);

    // Ledger carries the conflict with the machine-readable fields.
    const ledger = JSON.parse(readFileSync(join(home, ".hasna", "skills", CONFLICTS_LEDGER_FILE), "utf-8"));
    expect(ledger.version).toBe(1);
    expect(ledger.entries).toHaveLength(1);
    const conflict = ledger.entries[0] as HomeConflict;
    expect(conflict.path).toBe(join(home, ".claude", "skills", "beta"));
    expect(conflict.home).toBe(join(home, ".claude", "skills"));
    expect(conflict.skill).toBe("beta");
    expect(conflict.agent).toBe("claude");
    expect(conflict.hash).toBe(hashSkillMarkdown(SKILL_CONTENT("beta") + "drift\n"));
    expect(conflict.canonicalHash).toBe(hashSkillMarkdown(SKILL_CONTENT("beta")));
    expect(conflict.mtime).toBeTruthy();

    // Rollback record lists every marker written.
    expect(result.rollbackFile).toBeTruthy();
    expect(result.rollbackFile).toContain(ROLLBACK_DIRNAME);
    const rollback = JSON.parse(readFileSync(result.rollbackFile as string, "utf-8"));
    expect(rollback.mode).toBe("adopt");
    expect(rollback.entries).toHaveLength(1);
    expect(rollback.entries[0]).toMatchObject({
      agent: "claude",
      skill: "alpha",
      path: join(home, ".claude", "skills", "alpha"),
    });
  });

  test("a re-scan after apply sees the adopted dir as managed", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "alpha"), SKILL_CONTENT("alpha"));
    writeSkillMd(join(home, ".claude", "skills", "alpha"), SKILL_CONTENT("alpha"));

    adoptUnmarkedHomes({ homeDir: home, apply: true });
    const scan = scanUnmarkedHomes({ homeDir: home });

    expect(scan.managed).toBe(1);
    expect(scan.adoptable).toEqual([]);
  });
});

describe("pruneStrayHomes", () => {
  test("dry-run lists marked-and-stray dirs and removes nothing", () => {
    const home = tempHome();
    writeSkillMd(join(home, ".claude", "skills", "stray"), SKILL_CONTENT("stray"));
    writeFileSync(join(home, ".claude", "skills", "stray", SYNC_MARKER_FILE), JSON.stringify({ managedBy: SYNC_MARKER_MANAGED_BY, skill: "stray" }));
    writeSkillMd(join(home, ".claude", "skills", "unmarked-stray"), SKILL_CONTENT("unmarked-stray"));

    const result = pruneStrayHomes({ homeDir: home });

    expect(result.dryRun).toBe(true);
    expect(result.candidates.map((entry) => entry.skill)).toEqual(["stray"]);
    expect(result.pruned).toBe(0);
    expect(existsSync(join(home, ".claude", "skills", "stray", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".hasna", "skills", ROLLBACK_DIRNAME))).toBe(false);
  });

  test("apply removes only marked-and-stray dirs, recorded before removal", () => {
    const home = tempHome();
    const corpus = corpusDir(home);
    writeSkillMd(join(corpus, "canonical"), SKILL_CONTENT("canonical"));
    // Marked + no canonical entry -> prune candidate.
    writeSkillMd(join(home, ".claude", "skills", "stray"), SKILL_CONTENT("stray"));
    writeFileSync(join(home, ".claude", "skills", "stray", SYNC_MARKER_FILE), JSON.stringify({ managedBy: SYNC_MARKER_MANAGED_BY, skill: "stray" }));
    // Marked + canonical entry -> kept.
    writeSkillMd(join(home, ".claude", "skills", "canonical"), SKILL_CONTENT("canonical"));
    writeFileSync(join(home, ".claude", "skills", "canonical", SYNC_MARKER_FILE), JSON.stringify({ managedBy: SYNC_MARKER_MANAGED_BY, skill: "canonical" }));
    // Unmarked + no canonical entry -> never touched.
    writeSkillMd(join(home, ".claude", "skills", "hand-authored"), SKILL_CONTENT("hand-authored"));

    const result = pruneStrayHomes({ homeDir: home, apply: true });

    expect(result.dryRun).toBe(false);
    expect(result.pruned).toBe(1);
    expect(result.candidates.map((entry) => entry.skill)).toEqual(["stray"]);
    expect(existsSync(join(home, ".claude", "skills", "stray"))).toBe(false);
    expect(existsSync(join(home, ".claude", "skills", "canonical", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".claude", "skills", "hand-authored", "SKILL.md"))).toBe(true);

    // The rollback record was written BEFORE the removal and carries the hash + marker.
    expect(result.rollbackFile).toBeTruthy();
    const rollback = JSON.parse(readFileSync(result.rollbackFile as string, "utf-8"));
    expect(rollback.mode).toBe("prune");
    expect(rollback.entries).toHaveLength(1);
    expect(rollback.entries[0]).toMatchObject({
      agent: "claude",
      skill: "stray",
      path: join(home, ".claude", "skills", "stray"),
      hash: hashSkillMarkdown(SKILL_CONTENT("stray")),
    });
  });
});
