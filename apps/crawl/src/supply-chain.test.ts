import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../package.json";

// Regression for dep-crawl-1 (P1 supply-chain pin violation, apps/crawl):
// "e2b" was declared as a caret range "^2.14.1", which admits e2b@2.46.0
// (published 2026-08-25) — a version inside the fleet 7-day
// minimum-release-age quarantine. The quarantine blocks resolution only at
// install time; the declared range can still walk onto a brand-new release
// the instant a consumer grants an exact-name quarantine exclude. A range on
// a dependency that ships new minors daily is the root cause.
// An exact pin admits exactly one version, and the app's own lockfile (the
// one the Docker deploy lane installs frozen) must declare and resolve to
// that same version.
const EXACT = /^\d+\.\d+\.\d+$/;

const lockfileText = readFileSync(join(import.meta.dir, "..", "bun.lock"), "utf8");
// Same normalization the repo's own frozen-locks gate uses: bun.lock is JSON
// with trailing commas tolerated.
const lock = JSON.parse(lockfileText.replace(/,(\s*[}\]])/g, "$1")) as {
  workspaces?: Record<string, { optionalDependencies?: Record<string, string> }>;
  packages?: Record<string, string[]>;
};

test("e2b is declared as an exact pin, not a caret range", () => {
  const spec = packageJson.optionalDependencies?.e2b;
  expect(spec).toBeDefined();
  expect(String(spec)).toMatch(EXACT);
});

test("the app lockfile declares and resolves e2b at the pinned exact version", () => {
  const spec = String(packageJson.optionalDependencies?.e2b);
  expect(lock.workspaces?.[""]?.optionalDependencies?.e2b).toBe(spec);
  expect(lock.packages?.["e2b"]?.[0]).toBe(`e2b@${spec}`);
});
