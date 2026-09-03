import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

// Scan first-party source and hand-authored manifests only. The `dist`
// bundle is deliberately self-contained (it vendors @hasna/contracts and the
// in-tree mcp harness module), and those dependencies legitimately carry the
// retired-marker strings inside their own no-cloud validators/schemas —
// scanning the bundled output would flag a dependency's internal identifiers,
// not any first-party coupling. The guard here is that OUR code and manifests
// never depend on the retired shared cloud package.
const roots = Array.from(new Set([
  "package.json",
  "bun.lock",
  "LICENSE",
  "README.md",
  "src",
]));

const ignoredDirs = new Set(["node_modules", ".git", ".hasna"]);
const checkedBasenames = new Set(["LICENSE"]);
const checkedExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".jsx",
  ".js",
  ".json",
  ".lock",
  ".map",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
]);

function extensionFor(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot);
}

function collectFiles(path: string, out: string[] = []): string[] {
  if (!existsSync(path)) return out;
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (ignoredDirs.has(entry)) continue;
      collectFiles(join(path, entry), out);
    }
    return out;
  }
  if (checkedBasenames.has(basename(path)) || checkedExtensions.has(extensionFor(path))) {
    out.push(path);
  }
  return out;
}

describe("no shared cloud package boundary", () => {
  test("source and package files do not depend on retired shared cloud markers", () => {
    const files = roots.flatMap((root) => collectFiles(join(process.cwd(), root)));
    const combined = files
      .map((file) => `\n--- ${relative(process.cwd(), file)} ---\n${readFileSync(file, "utf8")}`)
      .join("\n");

    const retiredMarkers = [
      ["@hasna", "cloud"].join("/"),
      ["@hasna", ["open", "cloud"].join("-")].join("/"),
      ["open", "cloud"].join("-"),
      ["cloud", "tool"].join("-"),
      ["cloud", "mcp"].join("-"),
      ["register", "Cloud", "Tools"].join(""),
      ["register", "Cloud", "Commands"].join(""),
      [".hasna", "cloud"].join("/"),
      ["HASNA", "CLOUD"].join("_"),
      ["HASNA", "RDS", "PASSWORD"].join("_"),
      ["--", "cloud"].join(""),
    ];

    expect(combined).not.toMatch(new RegExp(retiredMarkers.join("|")));
  });
});
