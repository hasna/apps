import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const forbiddenReferences = [
  "@hasna/" + "cloud",
  "open-" + "cloud",
  "cloud-" + "mcp",
  "register" + "Cloud" + "Tools",
  "register" + "Cloud" + "Commands",
  ".hasna/" + "cloud",
  "HASNA_" + "CLOUD_",
  "HASNA_" + "RDS_" + "PASSWORD",
];

const skippedDirectories = new Set([".git", "dist", "node_modules"]);

function trackedFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (skippedDirectories.has(entry)) return [];
      return trackedFiles(path);
    }
    if (entry === "bun.lock" || /\.(json|md|ts|tsx|js|mjs)$/.test(entry)) return [path];
    return [];
  });
}

describe("shared cloud removal contract", () => {
  it("does not keep package, source, or doc references to the shared cloud runtime", () => {
    const offenders: string[] = [];

    for (const file of trackedFiles(repoRoot)) {
      const content = readFileSync(file, "utf8");
      for (const forbidden of forbiddenReferences) {
        if (content.includes(forbidden)) {
          offenders.push(`${file.replace(`${repoRoot}/`, "")}: ${forbidden}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
