import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const repoRoot = join(import.meta.dir, "..");

const forbidden = [
  ["@hasna", "cloud"].join("/"),
  ["open", "cloud"].join("-"),
  ["cloud", "mcp"].join("-"),
  "register" + "Cloud",
  "Sqlite" + "Adapter",
  "Pg" + "Adapter",
  [".hasna", "cloud"].join("/"),
  "HASNA_" + "CLOUD_",
  "HASNA_" + "RDS",
  ["cloud", "sync"].join(" "),
];

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === ".git" || entry === "node_modules" || entry === "dist") continue;
    if (entry === "dashboard" || entry === "sdk") {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) files.push(...collectFiles(full));
      continue;
    }
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (/\.(json|ts|tsx|js|mjs|md|yml|yaml|lock|sh)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

test("package and runtime sources do not reference the retired shared cloud runtime", () => {
  const hits: string[] = [];
  for (const file of collectFiles(repoRoot)) {
    const text = readFileSync(file, "utf8");
    for (const needle of forbidden) {
      if (text.includes(needle)) {
        hits.push(`${relative(repoRoot, file)} contains ${needle}`);
      }
    }
  }
  expect(hits).toEqual([]);
});
