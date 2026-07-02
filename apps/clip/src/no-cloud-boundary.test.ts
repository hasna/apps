import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const PRIVATE_SERVICE_PATTERNS = [
  new RegExp("@hasna/" + "cloud\\b"),
  new RegExp("@hasna/" + "wallets\\b"),
  new RegExp("\\bopen-" + "cloud\\b"),
  new RegExp("clip-" + "cloud\\b"),
  new RegExp("command\\([\"']" + "cloud"),
] as const;

const SOURCE_ROOTS = [
  "bun.lock",
  "CONTRIBUTING.md",
  "Package.swift",
  "README.md",
  "SECURITY.md",
  "Sources",
  "docs",
  "package.json",
  "scripts",
  "src",
] as const;

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".css",
  ".html",
  ".js",
  ".json",
  ".lock",
  ".md",
  ".mjs",
  ".swift",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);

function extension(path: string): string {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index) : "";
}

function collectFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return TEXT_EXTENSIONS.has(extension(path)) ? [path] : [];
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  for (const entry of readdirSync(path)) {
    if (entry === "dist" || entry === "node_modules") continue;
    files.push(...collectFiles(join(path, entry)));
  }
  return files;
}

function privateServiceHits(files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of PRIVATE_SERVICE_PATTERNS) {
      if (pattern.test(text)) {
        hits.push(relative(root, file));
        break;
      }
    }
  }
  return hits.sort();
}

describe("local and self-hosted boundary", () => {
  it("keeps package metadata, lockfile, and runtime sources free of private hosted service packages and command stubs", () => {
    const files = SOURCE_ROOTS.flatMap((entry) => collectFiles(join(root, entry)));
    expect(privateServiceHits(files)).toEqual([]);
  });
});
