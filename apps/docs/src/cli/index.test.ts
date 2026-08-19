/**
 * CLI surface tests: spawn the real `docs` CLI as a subprocess against fixture
 * files and assert on stdout, stderr, and exit codes. This is the only way to
 * exercise `commander` argument parsing, the `-t` format dispatch, chalk
 * rendering, and the error path (`program.parseAsync(...).catch`), none of
 * which are reachable through the library API.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const CLI = join(import.meta.dir, "index.ts");
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "docs-cli-test-"));
  writeFileSync(join(dir, "basic.md"), "# Title\n\nHello **world**.");
  writeFileSync(join(dir, "empty.md"), "");
  writeFileSync(join(dir, "doc.html"), "<h2>Sub</h2><p>Body</p>");
  writeFileSync(join(dir, "noheads.html"), "<p>just text</p>");
  writeFileSync(join(dir, "doc.json"), JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "json text" }] }] }));
  writeFileSync(join(dir, "bad.json"), "{not json");
  writeFileSync(join(dir, "notes.txt"), "plain text file");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("bun", ["run", CLI, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

describe("docs convert", () => {
  test("markdown -> html", () => {
    const r = run(["convert", join(dir, "basic.md"), "-t", "html"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("<h1>Title</h1>");
    expect(r.stdout).toContain("<strong>world</strong>");
  });

  test("markdown -> json is parseable and faithful", () => {
    const r = run(["convert", join(dir, "basic.md"), "-t", "json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.type).toBe("doc");
    expect(parsed.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
  });

  test("markdown -> text strips formatting", () => {
    const r = run(["convert", join(dir, "basic.md"), "-t", "text"]);
    expect(r.status).toBe(0);
    // toText joins top-level blocks with a single newline (no blank line).
    expect(r.stdout.trim()).toBe("Title\nHello world.");
    expect(r.stdout).not.toContain("**");
  });

  test("default target format is markdown", () => {
    const r = run(["convert", join(dir, "doc.html")]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toContain("## Sub");
  });

  test("html -> markdown", () => {
    const r = run(["convert", join(dir, "doc.html"), "-t", "md"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toContain("## Sub");
    expect(r.stdout.trim()).toContain("Body");
  });

  test("json -> markdown by extension dispatch", () => {
    const r = run(["convert", join(dir, "doc.json"), "-t", "md"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("json text");
  });

  test("unknown extension falls back to markdown parsing", () => {
    const r = run(["convert", join(dir, "notes.txt"), "-t", "json"]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).content?.[0]?.content?.[0]?.text).toBe("plain text file");
  });

  test("missing input file exits 1 with a docs: error on stderr", () => {
    const r = run(["convert", join(dir, "nope.md")]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^docs: /);
  });

  test("invalid JSON input exits 1 without crashing", () => {
    const r = run(["convert", join(dir, "bad.json")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^docs: /);
  });
});

describe("docs outline", () => {
  test("prints headings with level and indentation", () => {
    const r = run(["outline", join(dir, "basic.md")]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("h1 Title");
  });

  test("document without headings prints the no-headings notice", () => {
    const r = run(["outline", join(dir, "noheads.html")]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("(no headings)");
  });

  test("missing file exits 1", () => {
    const r = run(["outline", join(dir, "nope.md")]);
    expect(r.status).toBe(1);
  });
});

describe("docs stats", () => {
  test("prints all seven statistic rows", () => {
    const r = run(["stats", join(dir, "basic.md")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Words");
    expect(r.stdout).toContain("Characters");
    expect(r.stdout).toContain("No spaces");
    expect(r.stdout).toContain("Paragraphs");
    expect(r.stdout).toContain("Headings");
    expect(r.stdout).toContain("Sentences");
    expect(r.stdout).toContain("Reading time");
  });

  test("empty document reports zeroes", () => {
    const r = run(["stats", join(dir, "empty.md")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Words            0");
    expect(r.stdout).toContain("Reading time     0 min");
  });

  test("missing file exits 1", () => {
    const r = run(["stats", join(dir, "nope.md")]);
    expect(r.status).toBe(1);
  });
});

describe("docs argument handling", () => {
  test("unknown command exits non-zero", () => {
    const r = run(["frobnicate"]);
    expect(r.status).not.toBe(0);
  });

  test("missing required file argument exits non-zero", () => {
    const r = run(["convert"]);
    expect(r.status).not.toBe(0);
  });

  test("--version prints the package version", () => {
    const r = run(["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
