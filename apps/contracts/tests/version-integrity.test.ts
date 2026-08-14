import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRACTS_PACKAGE_VERSION } from "../src/schemas.js";

// Repo-self version-integrity gate (P1-2, hasna/apps#81 re-review).
//
// Three surfaces carry the package version and they can drift apart silently:
// package.json "version" (the publish carrier), hasna.contract.json
// "kitVersion" (the manifest consumers read), and the CONTRACTS_PACKAGE_VERSION
// constant baked into src/schemas.ts (the CLI/schema carrier). The kit suite
// never noticed a seeded disagreement — kitVersion 0.12.0 against a 0.11.0
// package ran 7/7 pass — because no gate compared the repo to itself. This
// test is that gate: it fails on ANY pairwise disagreement and names all three
// values in its failure output.

const root = join(import.meta.dir, "..");

function readVersions(): Record<string, string> {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version?: unknown;
  };
  const manifest = JSON.parse(readFileSync(join(root, "hasna.contract.json"), "utf8")) as {
    kitVersion?: unknown;
  };
  return {
    "package.json version": String(packageJson.version),
    "hasna.contract.json kitVersion": String(manifest.kitVersion),
    CONTRACTS_PACKAGE_VERSION,
  };
}

describe("repo self version integrity", () => {
  test("package.json version, hasna.contract.json kitVersion and CONTRACTS_PACKAGE_VERSION agree", () => {
    const versions = readVersions();
    const distinct = new Set(Object.values(versions));
    expect(distinct.size).toBe(1);
  });
});
