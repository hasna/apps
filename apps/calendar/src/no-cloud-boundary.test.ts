import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  files?: string[];
  bin?: Record<string, string>;
};

const roots = Array.from(new Set([
  "package.json",
  "bun.lock",
  "LICENSE",
  "src",
  ...(packageJson.files ?? []),
  ...Object.values(packageJson.bin ?? {}),
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
