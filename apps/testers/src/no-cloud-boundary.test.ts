import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("no-cloud boundary", () => {
  test("package manifest has no retired shared runtime dependency", () => {
    const manifest = JSON.parse(readRepoFile("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const retiredPackage = ["@hasna", "cloud"].join("/");
    const dependencySections = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ];

    for (const section of dependencySections) {
      expect(section ?? {}).not.toHaveProperty(retiredPackage);
    }
  });

  test("runtime files do not register retired shared runtime surfaces", () => {
    const retiredMarkers = [
      ["@hasna", "cloud"].join("/"),
      ["open", "cloud"].join("-"),
      ["cloud", "mcp"].join("-"),
      ["register", "Cloud", "Tools"].join(""),
      ["register", "Cloud", "Commands"].join(""),
      [".hasna", "cloud"].join("/"),
      ["HASNA", "CLOUD", ""].join("_"),
      ["HASNA", "RDS", "PASSWORD"].join("_"),
      ["--", "cloud"].join(""),
    ];
    const files = [
      "README.md",
      "src/db/database.ts",
      "src/lib/open-projects.ts",
      "src/mcp/server.ts",
    ];

    for (const file of files) {
      const text = readRepoFile(file);
      for (const marker of retiredMarkers) {
        expect(text.includes(marker), `${file} contains ${marker}`).toBe(false);
      }
    }
  });
});
