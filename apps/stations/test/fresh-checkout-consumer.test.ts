// Fresh-checkout consumer resolution — regression for wave #670 machines class.
//
// Wave PR hasna/apps#670 rewrote loops' optionalDependencies onto the
// workspace @hasna/machines member. In a fresh checkout that member has no
// dist/ (gitignored) and no install-time build (no prepare script), so the
// declared export subpaths — ./consumer among them — resolve to nothing, and
// loops' own declaration emit at install time fails deterministically with:
//
//   src/lib/machines.ts(6,8): error TS2307: Cannot find module
//   '@hasna/machines/consumer' or its corresponding type declarations.
//
// A workspace-linked consumer must resolve the declared subpaths from a fresh
// checkout WITHOUT any build step: the export-map "types" targets MUST be
// committed files (the @hasna/events committed-declarations precedent), and
// every non-committed runtime target (dist/*.js) MUST be covered by an
// install-time prepare script so the workspace link ships runtime js.
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const pkgDir = resolve(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as {
  exports: Record<string, { import?: string; types?: string }>;
  scripts?: Record<string, string>;
};

function declaredEntries(): Array<[string, { import?: string; types?: string }]> {
  return Object.entries(pkg.exports ?? {}).filter(
    (entry): entry is [string, { import?: string; types?: string }] =>
      entry[1] !== null && typeof entry[1] === "object",
  );
}

function isTracked(relPath: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", relPath], {
      cwd: pkgDir,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

describe("workspace-linked consumer resolution in a fresh checkout", () => {
  test("every declared subpath's types file is a committed file (no dist dependency)", () => {
    const missing: string[] = [];
    const untracked: string[] = [];
    for (const [subpath, entry] of declaredEntries()) {
      if (!entry.types) continue;
      const rel = relative(pkgDir, join(pkgDir, entry.types));
      if (!existsSync(join(pkgDir, entry.types))) {
        missing.push(`${subpath} -> ${entry.types}`);
      } else if (!isTracked(rel)) {
        untracked.push(`${subpath} -> ${entry.types}`);
      }
    }
    expect(
      { missing, untracked },
      "declared types must exist and be committed: a fresh checkout has no dist/ and nothing builds it at install if there is no prepare script",
    ).toEqual({ missing: [], untracked: [] });
  });

  test("every non-committed runtime target is covered by an install-time prepare script", () => {
    const prepare = pkg.scripts?.prepare;
    const uncovered: string[] = [];
    for (const [subpath, entry] of declaredEntries()) {
      if (!entry.import) continue;
      const rel = relative(pkgDir, join(pkgDir, entry.import));
      if (existsSync(join(pkgDir, entry.import)) && isTracked(rel)) continue; // committed runtime target
      uncovered.push(`${subpath} -> ${entry.import}`);
    }
    expect(
      prepare,
      `uncommitted runtime targets ${uncovered.join(", ")} require a prepare script that builds dist at install`,
    ).toBeTruthy();
  });
});
