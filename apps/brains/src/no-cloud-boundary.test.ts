import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const BLOCKED_PATTERNS = [
  new RegExp(["@hasna", "cloud"].join("/").replace("/", "\\/")),
  new RegExp(["open", "cloud"].join("-")),
  new RegExp(["cloud", "mcp"].join("-")),
  new RegExp(["register", "Cloud", "Tools"].join("")),
  new RegExp(["register", "Cloud", "Commands"].join("")),
  new RegExp(["\\.hasna", "cloud"].join("\\/")),
  new RegExp(["HASNA", "CLOUD"].join("_")),
  new RegExp(["HASNA", "RDS", "PASSWORD"].join("_")),
  new RegExp(["--", "cloud"].join("")),
  new RegExp(["rejectUnauthorized:", " false"].join("")),
];

const SCAN_ROOTS = [
  "package.json",
  "bun.lock",
  "README.md",
  "src",
] as const;

const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".git"]);
const EXCLUDED_FILES = new Set(["src/no-cloud-boundary.test.ts"]);

function collectFiles(path: string, files: string[] = []): string[] {
  if (!existsSync(path)) return files;

  const stat = statSync(path);
  if (stat.isFile()) {
    files.push(path);
    return files;
  }

  if (!stat.isDirectory()) return files;

  for (const entry of readdirSync(path)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    collectFiles(join(path, entry), files);
  }

  return files;
}

describe("no-cloud boundary", () => {
  test("keeps package metadata and runtime source free of retired cloud surfaces", () => {
    const violations: string[] = [];

    for (const scanRoot of SCAN_ROOTS) {
      for (const file of collectFiles(join(ROOT, scanRoot))) {
        const rel = relative(ROOT, file);
        if (EXCLUDED_FILES.has(rel)) continue;

        const content = readFileSync(file, "utf8");
        for (const pattern of BLOCKED_PATTERNS) {
          if (pattern.test(content)) violations.push(`${rel}: ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
