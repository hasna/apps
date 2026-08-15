import { describe, expect, test } from "bun:test";
import { extractRegexLiterals, buildFtsQueryFromRegex, compileSearchRegex } from "./regex.js";

function literals(pattern: string): string[][] | null {
  const r = extractRegexLiterals(pattern);
  return r ? r.map((b) => b.literals) : null;
}

describe("extractRegexLiterals", () => {
  test("plain literal", () => {
    expect(literals("getDbPath")).toEqual([["getdbpath"]]);
  });

  test("literal with regex metachar splits runs", () => {
    expect(literals("export.*function")).toEqual([["export", "function"]]);
    expect(literals("foo\\d+bar")).toEqual([["foo", "bar"]]);
  });

  test("escaped literals are kept", () => {
    expect(literals("config\\.json")).toEqual([["config.json"]]);
    expect(literals("a\\*b\\*cdef")).toEqual([["a*b*cdef"]]);
  });

  test("optional atoms are excluded", () => {
    // 's?' optional: required part is 'export' minus the optional s
    expect(literals("exports?")).toEqual([["export"]]);
    expect(literals("colou?r theory")).toEqual([["colo", "r theory"]]);
  });

  test("star drops the atom, plus keeps one", () => {
    expect(literals("abc*def")).toEqual([["ab", "def"]].map((b) => b.filter((l) => l.length >= 3)));
    expect(literals("abc+def")).toEqual([["abc", "def"]]);
  });

  test("top-level alternation produces OR branches", () => {
    expect(literals("foobar|bazqux")).toEqual([["foobar"], ["bazqux"]]);
  });

  test("alternation with a short branch rejects", () => {
    expect(literals("foobar|ab")).toBeNull();
  });

  test("character classes break runs", () => {
    expect(literals("handle[A-Z]lick")).toEqual([["handle", "lick"]]);
  });

  test("groups contribute required literals", () => {
    expect(literals("(import|export) function")).toEqual([[" function"]]);
    expect(literals("(foobar) baz")).toEqual([["foobar", " baz"]]);
  });

  test("optional group contributes nothing", () => {
    expect(literals("(foobar)? required")).toEqual([[" required"]]);
  });

  test("negative lookahead literals are not required", () => {
    expect(literals("(?!forbidden)allowed")).toEqual([["allowed"]]);
  });

  test("pattern with no extractable literal rejects", () => {
    expect(literals("\\d+")).toBeNull();
    expect(literals(".*")).toBeNull();
    expect(literals("[a-z]+")).toBeNull();
    expect(literals("ab")).toBeNull();
  });

  test("anchors are ignored", () => {
    expect(literals("^import .* from")).toEqual([["import ", " from"]]);
  });

  test("braces quantifier with min>=1 keeps literal once", () => {
    expect(literals("ab{2,3}cdef")).toEqual([["ab", "cdef"]].map((b) => b.filter((l) => l.length >= 3)));
    expect(literals("ab{0,3}cdef")).toEqual([["cdef"]]);
  });

  test("control/hex/unicode escapes are never treated as literal text", () => {
    // \t is a TAB, not the letter t — requiring "footbar" would silently
    // drop every real match (regression: round-2 adversarial finding)
    expect(literals("foo\\tbar")).toEqual([["foo", "bar"]]);
    expect(literals("foo\\nbar")).toEqual([["foo", "bar"]]);
    expect(literals("foo\\vbar")).toEqual([["foo", "bar"]]);
    expect(literals("\\x41bcdef")).toEqual([["bcdef"]]);
    expect(literals("\\u0041bcdef")).toEqual([["bcdef"]]);
    expect(literals("\\u{1F600}abcdef")).toEqual([["abcdef"]]);
    expect(literals("foo\\cMbar")).toEqual([["foo", "bar"]]);
    expect(literals("(?<g>foo)\\k<g>barbaz")).toEqual([["foo", "barbaz"]]);
    expect(literals("\\p{L}+abcdef")).toEqual([["abcdef"]]);
  });
});

describe("buildFtsQueryFromRegex", () => {
  test("single branch ANDs literals", () => {
    expect(buildFtsQueryFromRegex("export.*function")).toBe('"export" AND "function"');
  });

  test("alternation ORs branch groups", () => {
    expect(buildFtsQueryFromRegex("foobar|bazqux")).toBe('("foobar") OR ("bazqux")');
  });

  test("unsupported pattern returns null", () => {
    expect(buildFtsQueryFromRegex("\\w+")).toBeNull();
  });

  test("escapes embedded quotes", () => {
    expect(buildFtsQueryFromRegex('say"hello"')).toBe('"say""hello"""');
  });
});

describe("compileSearchRegex", () => {
  test("case-insensitive by default", () => {
    expect(compileSearchRegex("Foo").test("foo")).toBe(true);
    expect(compileSearchRegex("Foo", true).test("foo")).toBe(false);
  });

  test("invalid pattern throws", () => {
    expect(() => compileSearchRegex("(unclosed")).toThrow();
  });
});
