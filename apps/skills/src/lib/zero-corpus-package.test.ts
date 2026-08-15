/**
 * zero-corpus-package.test.ts — the published npm tarball must ship ZERO skill corpus.
 *
 * The canonical corpus stays in the repo (skills/ + agent-skills/) as git source of
 * truth; distribution is CI-built signed bundles + `skills pull`. If a single corpus
 * file re-enters the tarball, a fleet install silently regresses to "bundled
 * distribution" — the exact state this test exists to keep from coming back.
 *
 * Two instruments, deliberately: the packer's own dry-run file list (what `files[]`
 * produces) AND a real packed tarball inspected with tar, because the dry run and the
 * tarball have drifted apart before in this repo's history (the boundary guards run
 * against the dry-run list; the tarball is what npm actually ships).
 */
import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getPackedFiles } from "./packlist.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const PACKAGE_DIR = join(import.meta.dir, "..", "..");

/** Every corpus path prefix that must never appear in the tarball. */
const CORPUS_PREFIXES = ["skills/", "agent-skills/"];

function corpusEntries(paths: string[]): string[] {
  return paths.filter((path) => CORPUS_PREFIXES.some((prefix) => path.startsWith(prefix)));
}

describe("zero-corpus package", () => {
  test("the packer's dry-run file list contains no corpus paths", () => {
    const packed = getPackedFiles(PACKAGE_DIR);
    expect(packed.length).toBeGreaterThan(0);
    expect(corpusEntries(packed)).toEqual([]);
    // The corpus still EXISTS in the repo — this is about the tarball, not the tree.
    expect(existsSync(join(PACKAGE_DIR, "skills"))).toBe(true);
    expect(existsSync(join(PACKAGE_DIR, "agent-skills"))).toBe(true);
  });

  test("a real packed tarball contains no corpus paths", () => {
    const out = mkdtempSync(join(tmpdir(), "skills-pack-"));
    try {
      const result = spawnSync("npm", ["pack", "--ignore-scripts", "--pack-destination", out], {
        cwd: PACKAGE_DIR,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      expect(result.status, result.stderr).toBe(0);
      const tarballs = execFileSync("ls", [out], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
      expect(tarballs).toHaveLength(1);
      const listing = execFileSync("tar", ["-tzf", join(out, tarballs[0]!)], { encoding: "utf8" });
      const paths = listing.split("\n").filter(Boolean);
      expect(paths.length).toBeGreaterThan(0);
      expect(corpusEntries(paths)).toEqual([]);
      // Sanity: the tarball is not empty of package content — the guard is on the
      // corpus, not on the package.
      expect(paths.some((path) => path.endsWith("package.json"))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
