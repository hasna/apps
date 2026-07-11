import { describe, expect, test } from "bun:test";
import { IgnoreMatcher, IgnoreStack, DEFAULT_EXCLUDES } from "./ignore.js";

describe("IgnoreMatcher", () => {
  test("bare pattern matches basename at any depth", () => {
    const m = new IgnoreMatcher(["*.log"]);
    expect(m.ignores("debug.log", false)).toBe(true);
    expect(m.ignores("a/b/debug.log", false)).toBe(true);
    expect(m.ignores("debug.txt", false)).toBeUndefined();
  });

  test("anchored pattern only matches from base", () => {
    const m = new IgnoreMatcher(["src/*.log"]);
    expect(m.ignores("src/a.log", false)).toBe(true);
    expect(m.ignores("other/src/a.log", false)).toBeUndefined();
  });

  test("leading slash anchors", () => {
    const m = new IgnoreMatcher(["/build"]);
    expect(m.ignores("build", true)).toBe(true);
    expect(m.ignores("sub/build", true)).toBeUndefined();
  });

  test("trailing slash matches directories only", () => {
    const m = new IgnoreMatcher(["dist/"]);
    expect(m.ignores("dist", true)).toBe(true);
    expect(m.ignores("dist", false)).toBeUndefined();
    expect(m.ignores("a/dist", true)).toBe(true);
  });

  test("negation: last match wins", () => {
    const m = new IgnoreMatcher(["*.log", "!important.log"]);
    expect(m.ignores("a/debug.log", false)).toBe(true);
    expect(m.ignores("a/important.log", false)).toBe(false);
  });

  test("double star crosses directories", () => {
    const m = new IgnoreMatcher(["docs/**/*.md"]);
    expect(m.ignores("docs/a.md", false)).toBe(true);
    expect(m.ignores("docs/x/y/a.md", false)).toBe(true);
    expect(m.ignores("src/a.md", false)).toBeUndefined();
  });

  test("question mark matches single non-slash char", () => {
    const m = new IgnoreMatcher(["file?.txt"]);
    expect(m.ignores("file1.txt", false)).toBe(true);
    expect(m.ignores("file12.txt", false)).toBeUndefined();
  });

  test("character class", () => {
    const m = new IgnoreMatcher(["file[0-9].txt"]);
    expect(m.ignores("file5.txt", false)).toBe(true);
    expect(m.ignores("fileA.txt", false)).toBeUndefined();
  });

  test("comments and blanks are skipped", () => {
    const m = new IgnoreMatcher(["# comment", "", "*.tmp"]);
    expect(m.ignores("x.tmp", false)).toBe(true);
  });

  test("nested matcher base scoping", () => {
    const m = new IgnoreMatcher(["*.gen.ts"], "packages/core");
    expect(m.ignores("packages/core/a.gen.ts", false)).toBe(true);
    expect(m.ignores("packages/other/a.gen.ts", false)).toBeUndefined();
    expect(m.ignores("a.gen.ts", false)).toBeUndefined();
  });

  test("regex metacharacters in filenames are escaped", () => {
    const m = new IgnoreMatcher(["file(1).txt"]);
    expect(m.ignores("file(1).txt", false)).toBe(true);
    expect(m.ignores("file1.txt", false)).toBeUndefined();
  });
});

describe("IgnoreStack", () => {
  test("deeper soft matcher overrides shallower", () => {
    const stack = new IgnoreStack();
    stack.push(new IgnoreMatcher(["*.log"]));
    stack.push(new IgnoreMatcher(["!keep.log"], "sub"));
    expect(stack.ignores("sub/keep.log", false)).toBe(false);
    expect(stack.ignores("sub/other.log", false)).toBe(true);
    expect(stack.ignores("top.log", false)).toBe(true);
  });

  test("defaults exclude common noise dirs", () => {
    const stack = new IgnoreStack(new IgnoreMatcher(DEFAULT_EXCLUDES));
    expect(stack.ignores("node_modules", true)).toBe(true);
    expect(stack.ignores("a/b/node_modules", true)).toBe(true);
    expect(stack.ignores(".git", true)).toBe(true);
    expect(stack.ignores("src", true)).toBe(false);
    expect(stack.ignores(".DS_Store", false)).toBe(true);
  });

  test("hard excludes cannot be negated by pushed matchers", () => {
    const stack = new IgnoreStack(new IgnoreMatcher(DEFAULT_EXCLUDES));
    stack.push(new IgnoreMatcher(["!node_modules/", "!node_modules/**", "!.git/", "!.git/**"]));
    // The walker prunes ignored dirs, so the dir verdict is what matters.
    expect(stack.ignores("node_modules", true)).toBe(true);
    expect(stack.ignores(".git", true)).toBe(true);
  });

  test("hard matcher order prevents user excludes from re-including protected paths", () => {
    const stack = new IgnoreStack([
      new IgnoreMatcher(DEFAULT_EXCLUDES),
      new IgnoreMatcher(["!.git/", "!.git/**", "!.codewith/**", "!*.sqlite-wal"]),
    ]);
    expect(stack.ignores(".git", true)).toBe(true);
    expect(stack.ignores(".codewith/logs_2.sqlite-wal", false)).toBe(true);
    expect(stack.ignores("data/index.sqlite-wal", false)).toBe(true);
  });

  test("** only crosses directories as a whole segment (git semantics)", () => {
    const m = new IgnoreMatcher(["a**b"]);
    expect(m.ignores("axyb", false)).toBe(true);
    expect(m.ignores("ax/yb", false)).toBeUndefined();
  });

  test("character class with escaped or leading ]", () => {
    expect(new IgnoreMatcher(["[a\\]b]"]).ignores("]", false)).toBe(true);
    expect(new IgnoreMatcher(["[a\\]b]"]).ignores("a", false)).toBe(true);
    expect(new IgnoreMatcher(["[]]"]).ignores("]", false)).toBe(true);
    expect(new IgnoreMatcher(["[!]]"]).ignores("x", false)).toBe(true);
    expect(new IgnoreMatcher(["[!]]"]).ignores("]", false)).toBeUndefined();
  });
});
