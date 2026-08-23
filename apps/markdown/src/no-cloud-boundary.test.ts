import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const forbiddenMarkers = [
  "@hasna/" + "cloud",
  "open-" + "cloud",
  "cloud" + "-mcp",
  "register" + "CloudTools",
  "register" + "CloudCommands",
  ".hasna/" + "cloud",
  "HASNA_" + "CLOUD_",
  "HASNA_RDS_" + "PASSWORD",
  "--" + "cloud",
  "Sqlite" + "Adapter",
  "Pg" + "Adapter",
  "reject" + "Unauthorized",
];

const scannedRoots = ["README.md", "package.json", "bun.lock", "src"];
const skippedDirs = new Set(["node_modules", "dist", ".git"]);

describe("no cloud boundary", () => {
  test("source, docs, and package metadata do not reference retired cloud runtime", () => {
    const hits: string[] = [];

    for (const file of collectFiles(scannedRoots)) {
      const content = readFileSync(file, "utf8");
      for (const marker of forbiddenMarkers) {
        if (content.includes(marker)) {
          hits.push(`${relative(root, file)} contains ${marker}`);
        }
      }
    }

    expect(hits).toEqual([]);
  });

  test("package manifest has no retired cloud dependency", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    };

    expect(Object.keys(allDeps)).not.toContain("@hasna/" + "cloud");
  });
});

function collectFiles(entries: string[]): string[] {
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry);
    // Some entries (e.g. a per-package bun.lock) do not exist in this
    // monorepo layout; skip them instead of crashing the whole suite.
    if (!existsSync(path)) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, files);
    } else {
      files.push(path);
    }
  }

  return files.filter((file) => /\.(ts|json|md|lock)$/.test(file));
}

function walk(dir: string, files: string[]) {
  for (const entry of readdirSync(dir)) {
    if (skippedDirs.has(entry)) continue;

    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, files);
    } else {
      files.push(path);
    }
  }
}
