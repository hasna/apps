import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

// Every EXACT-pinned @hasna/* dependency must resolve to a PUBLISHED registry
// version. Version waves pin sibling deps exactly (0.5.18-style); when the
// pinned version was never published (a ship-lane gap), consumer installs
// fail with "No version matching ... found for specifier" even though the
// workspace-local build passes — the workspace resolves the sibling from
// apps/, while the Dockerfile builder stage and any npm install of the
// published tarball resolve from the registry. Regression for BUG I38-00557
// (@hasna/browser@0.5.18 referenced but absent from the npm registry).
describe("registry pins", () => {
  test("exact-pinned @hasna/* dependencies exist on the npm registry", async () => {
    const manifest = JSON.parse(readRepoFile("package.json")) as {
      dependencies?: Record<string, string>;
    };
    const pinned = Object.entries(manifest.dependencies ?? {}).filter(
      ([name, spec]) => name.startsWith("@hasna/") && /^[0-9]/.test(spec),
    );
    expect(pinned.length).toBeGreaterThan(0);

    for (const [name, spec] of pinned) {
      const res = await fetch(`https://registry.npmjs.org/${name}`, {
        headers: { Accept: "application/vnd.npm.install-v1+json" },
      });
      expect(
        res.ok,
        `${name}: registry packument fetch failed (HTTP ${res.status})`,
      ).toBe(true);
      const packument = (await res.json()) as {
        versions?: Record<string, unknown>;
      };
      const published = Object.keys(packument.versions ?? {});
      const tail = published.slice(-3).join(", ");
      expect(
        published.includes(spec),
        `${name}@${spec} is pinned exactly but is not a published registry version (registry tops out at: ${tail || "none"})`,
      ).toBe(true);
    }
  });
});
