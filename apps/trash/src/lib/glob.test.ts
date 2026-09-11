/**
 * The exclude-glob matcher.
 *
 * This is not a formatting utility: §11.7 makes `capture.excludeGlobs` the
 * boundary between "we could not capture it, so we refuse to delete it" and
 * "we could not capture it, but the delete proceeds anyway". A matcher that is
 * too greedy turns the safe branch into the unsafe one; one that is too narrow
 * makes the trash self-lock on a full disk.
 */

import { describe, expect, test } from "bun:test";
import { DEFAULT_TRASH_CONFIG } from "./config.js";
import { firstMatchingGlob, globToRegExp, isExcludedPath, normalizeForMatch } from "./glob.js";

const EXCLUDES = DEFAULT_TRASH_CONFIG.capture.excludeGlobs;

describe("globToRegExp — the supported grammar", () => {
  test("a pattern never matches a mere string PREFIX", () => {
    // The failure this avoids: `/a/dist2` treated as "dist output" and deleted
    // without a capture.
    expect(isExcludedPath("/a/dist2", EXCLUDES)).toBe(false);
    expect(isExcludedPath("/a/dist2/keep.txt", EXCLUDES)).toBe(false);
    expect(isExcludedPath("/a/node_modules-notes/x", EXCLUDES)).toBe(false);
    expect(isExcludedPath("/a/targets/x", EXCLUDES)).toBe(false);
  });

  test("`/**` matches the directory itself AND everything under it", () => {
    expect(isExcludedPath("/a/dist", EXCLUDES)).toBe(true);
    expect(isExcludedPath("/a/dist/", EXCLUDES)).toBe(true);
    expect(isExcludedPath("/a/dist/bundle.js", EXCLUDES)).toBe(true);
    expect(isExcludedPath("/a/dist/deep/nested/file", EXCLUDES)).toBe(true);
  });

  test("`**/` matches zero or more whole segments, so a top-level match is included", () => {
    expect(isExcludedPath("/node_modules/x", EXCLUDES)).toBe(true);
    expect(isExcludedPath("node_modules/x", EXCLUDES)).toBe(true);
    expect(isExcludedPath("/home/u/proj/node_modules/@scope/pkg/index.js", EXCLUDES)).toBe(true);
    expect(isExcludedPath("/a/.git/objects/ab/cdef", EXCLUDES)).toBe(true);
  });

  test("`*` stays inside one segment", () => {
    const re = globToRegExp("*.txt");
    expect(re.test("a.txt")).toBe(true);
    expect(re.test("a/b.txt")).toBe(false);
    expect(globToRegExp("/a/*/c").test("/a/b/c")).toBe(true);
    expect(globToRegExp("/a/*/c").test("/a/b/d/c")).toBe(false);
  });

  test("`?` is exactly one character, inside one segment", () => {
    expect(globToRegExp("a?c").test("abc")).toBe(true);
    expect(globToRegExp("a?c").test("ac")).toBe(false);
    expect(globToRegExp("a?c").test("a/c")).toBe(false);
  });

  test("a trailing slash changes nothing about a decision", () => {
    expect(normalizeForMatch("/a/b/")).toBe("/a/b");
    expect(normalizeForMatch("/a/b///")).toBe("/a/b");
    expect(normalizeForMatch("/")).toBe("/");
    expect(isExcludedPath("/a/dist/", EXCLUDES)).toBe(isExcludedPath("/a/dist", EXCLUDES));
  });

  test("an empty pattern is refused rather than matching everything", () => {
    expect(() => globToRegExp("   ")).toThrow(/empty pattern/);
  });
});

describe("isExcludedPath / firstMatchingGlob", () => {
  test("no globs means nothing is excluded — never everything", () => {
    expect(isExcludedPath("/a/dist/bundle.js", [])).toBe(false);
    expect(firstMatchingGlob("/a/dist/bundle.js", [])).toBeNull();
  });

  test("the FIRST matching glob is the one the refusal record names", () => {
    const globs = ["**/dist/**", "**/node_modules/**"];
    expect(firstMatchingGlob("/a/dist/x", globs)).toBe("**/dist/**");
    expect(firstMatchingGlob("/a/node_modules/x", globs)).toBe("**/node_modules/**");
    expect(firstMatchingGlob("/a/src/x", globs)).toBeNull();
  });

  test("the default list covers the not-precious class and nothing else", () => {
    const excluded = [
      "/w/proj/node_modules/left-pad/index.js",
      "/w/proj/.git/objects/ab/cdef",
      "/w/proj/target/debug/app",
      "/w/proj/dist/main.js",
      "/w/proj/.venv/lib/python3.12/site-packages/x.py",
      "/w/proj/__pycache__/mod.cpython-312.pyc",
    ];
    for (const path of excluded) expect(isExcludedPath(path, EXCLUDES)).toBe(true);

    const precious = [
      "/w/proj/src/main.ts",
      "/w/proj/.git/config",
      "/w/proj/README.md",
      "/w/proj/target.md",
      "/w/proj/distinct/x",
      "/w/proj/node_modules.md",
      "/home/u/documents/thesis.docx",
    ];
    for (const path of precious) expect(isExcludedPath(path, EXCLUDES)).toBe(false);
  });
});
