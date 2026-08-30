import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";

// Regression guard for O15-05112: runtime state artifacts were written into
// the repo tree (heartbeat-state blobs, CLI export output, test-run markers,
// the sync script's own log) and committed via an auto-commit-before-sync
// helper. The writers must use a state dir outside the repo, and the
// artifact classes must stay out of the tree.

const PKG_ROOT = join(import.meta.dir, "../..");

// Paths (relative to the package root) of the artifact classes that must
// never exist in the tree.
const FORBIDDEN_ARTIFACTS = [
  "<db>:heartbeat_state:1795f400-8d8f-47c8-a866-0e1b889cbdce",
  "<db>:heartbeat_state:601a1680-4600-4c1d-a70c-76136a8eaafe",
  "test-results/.last-run.json",
  "testers-export.json",
  ".scripts/sync.log",
];

describe("repo hygiene — runtime state artifacts stay out of the tree", () => {
  it("forbids committed heartbeat-state blobs", () => {
    const heartbeat = FORBIDDEN_ARTIFACTS.filter((p) => p.startsWith("<db>:"));
    for (const rel of heartbeat) {
      expect(
        existsSync(join(PKG_ROOT, rel)),
        `${rel} must not exist in the package tree`,
      ).toBe(false);
    }
  });

  it("forbids committed CLI export, test-run and sync-log artifacts", () => {
    const others = FORBIDDEN_ARTIFACTS.filter((p) => !p.startsWith("<db>:"));
    for (const rel of others) {
      expect(
        existsSync(join(PKG_ROOT, rel)),
        `${rel} must not exist in the package tree`,
      ).toBe(false);
    }
  });

  it("gitignore carries the artifact-class guards (git check-ignore)", () => {
    // The guard must actually match: `git check-ignore` returning rc=0 for
    // each artifact path is the functional proof that a stray state file
    // would be ignored rather than committed.
    for (const rel of FORBIDDEN_ARTIFACTS) {
      const res = spawnSync("git", ["check-ignore", "-q", join(PKG_ROOT, rel)], {
        cwd: PKG_ROOT,
        encoding: "utf8",
      });
      expect(
        res.status,
        `git check-ignore must match ${rel} (pattern missing from .gitignore?)`,
      ).toBe(0);
    }
  });

  it("keeps the ignore patterns documented in .gitignore", () => {
    const gitignore = readFileSync(join(PKG_ROOT, ".gitignore"), "utf8");
    for (const pattern of [
      "<db>:heartbeat_state:*",
      "testers-export.json",
      "test-results/",
      ".scripts/sync.log",
    ]) {
      expect(
        gitignore.split("\n").map((l) => l.trim()),
        `.gitignore must carry the pattern ${pattern}`,
      ).toContain(pattern);
    }
  });
});
