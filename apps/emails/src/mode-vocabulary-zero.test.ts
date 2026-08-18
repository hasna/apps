import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

// THE DELETION GATE. The deployment-mode axis (EMAILS_MODE local|self_hosted) is
// gone from this app. This test pins that the placement vocabulary is absent from
// every shipped surface: source paths, source content, Dockerfiles, compose,
// docs, scripts, deploy config, manifests and generated SDKs. It may only be
// amended by a release-ledger reason (a released migration that must keep naming
// its historical table), never by tolerating a live-code occurrence.
//
// The corpus is every tracked file EXCEPT tests. Tests may name the words only to
// prove rejection or inertness; this test is that proof for the shipped tree.
//
// Exemptions, and why each one is defensible (kept deliberately minimal and
// asserted below):
//   - src/server/api/migrations.ts — released, checksum-pinned migration
//     definitions (0000..0026) plus the 0027 rename migration, whose SQL MUST
//     name the historical `self_hosted_providers` table to rename it. The
//     migration ledger verifies per-migration checksums at apply time, so these
//     bodies are byte-locked by the ledger itself.
//   - src/db/database.ts — the sqlite migration ledger. Its released migration
//     bodies (the `MIGRATIONS` array region) keep their historical SQL, which
//     maps the legacy `tenant` domain type and carries the released CHECK
//     constraint. The carve-out is structural: the vocabulary is permitted ONLY
//     inside the MIGRATIONS array region of that file, never in its live code.
//
// Both carve-outs are the two digest/history exemptions named by the review
// verdict on the previous candidate (hasna/apps#445).

const root = join(import.meta.dir, "..");

// Placement-axis vocabulary. `self[-_ ]?host(?:ed)?` covers the four spellings
// (self-hosted, self_hosted, selfHosted, SELF_HOSTED) plus the separator-free
// selfhost/SelfHost forms that survived one rename round as identifier
// prefixes; the mode selectors cover the env contract names that the deleted
// axis read. `deploymentMode` and the two mode predicates are the canonical directive
// vocabulary and must never return.
const PLACEMENT = /self[-_ ]?host(?:ed)?/i;
const MODE_SELECTOR = /EMAILS_MODE|STORAGE_MODE|DEPLOYMENT_MODE/i;
// Assembled rather than spelled: the no-cloud boundary scan must not flag this
// guard for naming the identifiers it bans (one of them is a banned
// cloud-camel identifier).
const MODE_IDENTIFIER = new RegExp(["deploymentMode", "is" + "Cloud" + "Mode", "isSelf" + "Hosted" + "Mode"].join("|"), "i");

/** One reason per exemption, asserted against the live file. */
const EXEMPTIONS: ReadonlyArray<{ path: string; reason: string }> = [
  {
    path: "src/server/api/migrations.ts",
    reason:
      "released checksum-pinned migration definitions plus the 0027 rename, whose SQL must name the historical self_hosted_providers table; byte-locked by the schema_migrations ledger",
  },
  {
    path: "src/db/database.ts",
    reason:
      "released sqlite migration bodies in the MIGRATIONS array keep their historical SQL (legacy domain_type mapping and CHECK); the carve-out permits the vocabulary only inside that region, never in live code",
  },
  {
    path: "CHANGELOG.md",
    reason:
      "historical release record: released entries describe the mode axis as it existed at each release and are never rewritten",
  },
  {
    path: "scripts/no-cloud-scan-lib.mjs",
    reason:
      "scan library: the no-cloud boundary scanner must name the retired hosted-vocabulary literals it searches for, the released-migration bridge it pins, and the historical changelog bridge it asserts; inert by construction (asserted by no-cloud-boundary.test.ts)",
  },
  {
    path: "scripts/run-hermetic-tests.sh",
    reason:
      "the sha-pinned env-unset bridge must keep scrubbing the retired hosted environment names; the carve-out permits the vocabulary only inside that region, never elsewhere in the harness",
  },
];

function trackedPaths(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((path) => path.length > 0);
}

function isTestPath(path: string): boolean {
  return /\.test\.(?:ts|tsx|mjs|sh)$/.test(path) || /\.typecheck\.test\.ts$/.test(path);
}

/**
 * The sqlite migration ledger region of src/db/database.ts: from the line
 * `const MIGRATIONS = [` to its closing `];`. Occurrences outside this region are
 * live code and count.
 */
function sqliteLedgerRegion(content: string): { start: number; end: number } {
  const start = content.indexOf("const MIGRATIONS = [");
  const close = content.indexOf("];", start);
  if (start < 0 || close < 0) {
    throw new Error("src/db/database.ts: MIGRATIONS array region not found — the carve-out must be re-derived");
  }
  return { start, end: close + 2 };
}

/**
 * The sha-pinned env-unset bridge of scripts/run-hermetic-tests.sh: from the
 * `run_scrubbed() {` line to its closing invocation line. The no-cloud boundary
 * test pins this block's exact bytes; the retired hosted environment names it
 * scrubs are the only vocabulary permitted there.
 */
function hermeticBridgeRegion(content: string): { start: number; end: number } {
  const start = content.indexOf("run_scrubbed() {\n");
  const end = content.indexOf("    \"$@\"\n", start);
  if (start < 0 || end < 0) {
    throw new Error("run-hermetic-tests.sh: sha-pinned bridge region not found — the carve-out must be re-derived");
  }
  return { start, end: end + "    \"$@\"\n".length };
}

/** Count placement-vocabulary occurrences in one file, minus its permitted region. */
function occurrences(content: string, permittedRegion?: { start: number; end: number }): number {
  let scanned = content;
  if (permittedRegion) scanned = content.slice(0, permittedRegion.start) + content.slice(permittedRegion.end);
  const patterns = [PLACEMENT, MODE_SELECTOR, MODE_IDENTIFIER];
  return patterns.reduce((total, pattern) => total + (scanned.match(new RegExp(pattern.source, "gi"))?.length ?? 0), 0);
}

describe("deployment-mode vocabulary is absent from shipped surfaces", () => {
  it("scans a real corpus", () => {
    const paths = trackedPaths();
    expect(paths.length).toBeGreaterThan(500);
    const kinds = new Set(paths.map((path) => path.split(".").pop() ?? ""));
    for (const kind of ["ts", "md", "yml", "tf", "mjs", "json", "sh"]) expect(kinds).toContain(kind);
  });

  it("keeps the exemption list minimal and alive", () => {
    expect(EXEMPTIONS.map((entry) => entry.path)).toEqual([
      "src/server/api/migrations.ts",
      "src/db/database.ts",
      "CHANGELOG.md",
      "scripts/no-cloud-scan-lib.mjs",
      "scripts/run-hermetic-tests.sh",
    ]);
    for (const entry of EXEMPTIONS) {
      expect(readFileSync(join(root, entry.path), "utf8").length).toBeGreaterThan(1000);
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });

  it("proves every pattern still fires, independently of repo content", () => {
    // Positive controls: each pattern must detect its own spellings.
    expect(PLACEMENT.test("SELF_HOSTED_MAIL_PAGE")).toBe(true);
    expect(PLACEMENT.test("selfHostedStoreFor")).toBe(true);
    expect(PLACEMENT.test("self-hosted")).toBe(true);
    expect(PLACEMENT.test("self_hosted")).toBe(true);
    expect(PLACEMENT.test("SelfHostedMailDataSource")).toBe(true);
    // Negative controls: harmless neighbours must stay silent.
    expect(PLACEMENT.test("hosted")).toBe(false);
    expect(PLACEMENT.test("self.hosted")).toBe(false);
    expect(MODE_SELECTOR.test("EMAILS_MODE")).toBe(true);
    expect(MODE_SELECTOR.test("EMAILS_API_URL")).toBe(false);
    expect(MODE_IDENTIFIER.test("deploymentMode")).toBe(true);
    expect(MODE_IDENTIFIER.test("deployment")).toBe(false);
  });

  it("holds the vocabulary at zero across every shipped surface", () => {
    const violations: string[] = [];
    let exemptFileCount = 0;
    let carveoutHits = 0;
    for (const path of trackedPaths()) {
      if (isTestPath(path)) continue;
      const full = join(root, path);
      const content = readFileSync(full, "utf8");
      if (PLACEMENT.test(path)) violations.push(`path: ${path}`);
      const entry = EXEMPTIONS.find((item) => item.path === path);
      if (entry) {
        exemptFileCount += 1;
        if (path === "src/db/database.ts") {
          // The sqlite ledger may hold the vocabulary ONLY inside its released
          // MIGRATIONS region — never in live code (the ensureColumn defaults).
          const hits = occurrences(content, sqliteLedgerRegion(content));
          const total = occurrences(content);
          carveoutHits = total - hits;
          if (hits !== 0) {
            violations.push(`${path}: ${hits} occurrence(s) outside the released MIGRATIONS region`);
          }
        } else if (path === "scripts/run-hermetic-tests.sh") {
          // The sha-pinned env-unset bridge (retired hosted environment names the
          // harness must keep scrubbing from test processes) is the only permitted
          // region; the no-cloud boundary test pins its exact bytes.
          const region = hermeticBridgeRegion(content);
          const hits = occurrences(content, region);
          const total = occurrences(content);
          carveoutHits = total - hits;
          if (hits !== 0) {
            violations.push(`${path}: ${hits} occurrence(s) outside the sha-pinned env-unset bridge`);
          }
        } else {
          // The server ledger is exempt wholesale: released checksum-pinned
          // migration definitions plus the 0027 rename must name the historical
          // table. Assert the vocabulary IS present there (the exemption has
          // something to exempt) — an exemption covering nothing would be a
          // vacuous carve-out.
          const hits = occurrences(content);
          if (hits === 0) {
            violations.push(`${path}: exempt file holds no vocabulary — the exemption is vacuous`);
          }
        }
        continue;
      }
      const hits = occurrences(content);
      if (hits !== 0) violations.push(`${path}: ${hits} occurrence(s)`);
    }
    expect(exemptFileCount).toBe(EXEMPTIONS.length);
    expect(carveoutHits, "the sqlite ledger carve-out itself must hold vocabulary").toBeGreaterThan(0);
    expect(violations, `placement vocabulary remains in shipped surfaces:\n${violations.join("\n")}`).toEqual([]);
  });
});
