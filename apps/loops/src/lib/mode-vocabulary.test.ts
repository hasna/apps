import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Retired deployment-mode vocabulary guard ─────────────────────────────────
//
// The three-way local | self_hosted | cloud deployment-mode axis was removed in
// favor of a single data-backend switch (client: sqlite | http, server: sqlite
// | postgres). This test keeps the retired vocabulary from being re-learned:
// any source line that reintroduces a mode identifier fails the suite.
//
// Scope and exemptions:
//   • `src/generated/**` is excluded: it is vendored verbatim from
//     @hasna/contracts, hash-locked by scripts/check-storage-kit.mjs, and is
//     replaced wholesale when the contracts package regenerates the kit.
//   • A line carrying the `LEGACY-DEPLOYMENT-MODE-ALIAS` marker is exempt.
//     Deployed fleets (and the installed @hasna/contracts conformance harness)
//     still set the retired env values, so the alias table that maps them onto
//     the backend switch must spell them once. The marker keeps each such line
//     deliberate, greppable, and countable.
//   • `*.test.ts` files are excluded from the token ban: alias-compat tests
//     must spell the retired values to prove they still select a backend.
//   • Plain `local` / `cloud` / `remote` as ordinary words are NOT banned —
//     the removal targets the mode axis, not two English words.

const REPO_SRC = resolve(fileURLToPath(new URL("../..", import.meta.url)), "src");
const GUARD_FILE = fileURLToPath(import.meta.url);
const ALIAS_MARKER = "LEGACY-DEPLOYMENT-MODE-ALIAS";

const RETIRED_TOKENS = [
  "self_hosted",
  "self-hosted",
  "selfHosted",
  "SelfHosted",
  "SELF_HOSTED",
  "deploymentMode",
  "DeploymentMode",
  "DEPLOYMENT_MODE",
  "isCloudMode",
  "cloud-http",
  "cloud_control_plane",
  "hosted_control_plane",
] as const;

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "generated" && relative(REPO_SRC, full) === "generated") continue;
      walk(full, files);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("retired deployment-mode vocabulary", () => {
  const files = walk(REPO_SRC).filter(
    (file) => file !== GUARD_FILE && !/\.test\.(ts|tsx|js|mjs)$/.test(file),
  );

  test("scans a real corpus (positive control on the scanner itself)", () => {
    // If the walker breaks, the guard silently proves nothing. Anchor it to
    // files that must exist and must be scanned.
    const relativeFiles = files.map((file) => relative(REPO_SRC, file));
    expect(files.length).toBeGreaterThan(50);
    expect(relativeFiles).toContain("lib/mode.ts");
    expect(relativeFiles).toContain("lib/store/index.ts");
    expect(relativeFiles.some((file) => file.startsWith("generated/"))).toBe(false);
  });

  test("no source line reintroduces a retired mode token", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (line.includes(ALIAS_MARKER)) return;
        for (const token of RETIRED_TOKENS) {
          if (line.includes(token)) {
            offenders.push(`${relative(REPO_SRC, file)}:${index + 1} [${token}] ${line.trim().slice(0, 120)}`);
            break;
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test("every alias-marker line actually spells a retired value (markers cannot rot)", () => {
    let markerLines = 0;
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const line of lines) {
        if (!line.includes(ALIAS_MARKER)) continue;
        markerLines += 1;
        expect(
          RETIRED_TOKENS.some((token) => line.includes(token)) ||
            line.includes("local") ||
            line.includes("cloud"),
        ).toBe(true);
      }
    }
    // The alias table is a deliberately small, bounded shim.
    expect(markerLines).toBeLessThanOrEqual(12);
  });
});
