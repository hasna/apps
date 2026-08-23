#!/usr/bin/env bun
/**
 * Release-suite gate (wired into `prepublishOnly`).
 *
 * Runs the app's own Linux-CI-partitioned suite — `test:gated`, which covers
 * every discovered `*.test.ts` (the quarantine file is empty by design) — and
 * fails on ANY failure.
 *
 * The allowlist is SELF-INVALIDATING, the same property as
 * `.github/linux-quarantine.txt`: if an allowlisted failure stops failing
 * (the owning lane lands its fix, or a quarantined package ages out of the
 * 7-day window), the gate exits 1 and demands the entry be removed. Any
 * failure outside the allowlist fails the gate.
 *
 * Allowlist history (both entries removed 2026-08-23 by the 0.3.9 release
 * lane, publish-all-recordings, per this gate's own self-invalidation
 * contract — each failure stopped failing at head 15b6181c6):
 *   - service-contract-manifest.test.ts (credential_seam_compliance): the
 *     contracts-surface migration landed in hasna/apps PR #957
 *     (resolveStorageClient now imported from @hasna/contracts/client), so
 *     the conformance check passes; the entry's own reason said "Remove this
 *     entry when the lane lands."
 *   - native-app-companion-contract.test.ts (release supply-chain policy):
 *     the companion build's --minimum-release-age=604800 quarantine no longer
 *     bites because @hasna/contracts is on the fleet minimumReleaseAgeExcludes
 *     list (the sanctioned mechanism for fresh publishes); the test passes.
 * Both removals are the gate's designed behaviour, not a weakening: any
 * future failure now fails the gate with zero allowlisted exceptions.
 *
 * The gate FAILS CLOSED on abnormal termination: a non-zero suite exit is
 * acceptable only when it is fully explained by allowlisted failures — the
 * runner completed (its summary line is present), every parsed failure is
 * allowlisted, at least one allowlisted failure fired, and the runner's
 * reported failure count equals the parsed count. A crash, signal kill,
 * timeout, or runner error that produces a non-zero exit without a complete
 * summary fails the gate (remediation cycle 2 of PR hasna/apps#826).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SEP = "::";

const GATED_KEYS: Array<{ file: string; test: string; owner: string; reason: string }> = [];

function run(argv: string[], env: Record<string, string>): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, argv, { encoding: "utf8", env: { ...process.env, ...env } });
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

// 1. Validate the partition (quarantine file must be consistent).
const check = run(["scripts/ci-linux-suite.ts", "--check"], {});
if (check.status !== 0) {
  console.error("release-suite-gate: partition check failed:\n" + (check.stderr || check.stdout));
  process.exit(1);
}

// 2. Collect the gated file list.
const gated = run(["scripts/ci-linux-suite.ts", "--gated"], {});
if (gated.status !== 0) {
  console.error("release-suite-gate: could not enumerate gated files:\n" + (gated.stderr || gated.stdout));
  process.exit(1);
}
const gatedFiles = gated.stdout.split("\n").filter(Boolean);
if (gatedFiles.length === 0) {
  console.error("release-suite-gate: zero gated files - refusing to pass on an empty suite.");
  process.exit(1);
}

// 3. Run the gated suite exactly like `test:gated`.
const logDir = mkdtempSync(join(tmpdir(), "recordings-release-gate-"));
const logPath = join(logDir, "suite.log");
const suite = spawnSync(
  process.execPath,
  ["test", "--timeout", "120000", ...gatedFiles],
  {
    encoding: "utf8",
    env: { ...process.env, RECORDINGS_TEST_TIMEOUT_MS: "120000" },
    maxBuffer: 64 * 1024 * 1024,
  },
);
const output = (suite.stdout ?? "") + (suite.stderr ?? "");
try {
  writeFileSync(logPath, output);
} catch {
  /* log capture is best-effort */
}
const suiteStatus = suite.status ?? -1;

// 4. Parse failing tests as (file, description) pairs, in output order.
const failPairs: Array<{ file: string; test: string }> = [];
let currentFile = "";
for (const line of output.split("\n")) {
  const fileMatch = /^(?:\.\/)?(src\/[^\s:]+\.test\.ts):$/.exec(line);
  if (fileMatch) {
    currentFile = fileMatch[1];
    continue;
  }
  const failMatch = /^\(fail\) (.+) \[\d+.*\]$/.exec(line);
  if (failMatch) {
    failPairs.push({ file: currentFile, test: failMatch[1].trim() });
  }
}

// 5. Classify.
const failuresByKey = new Map<string, number>();
for (const key of GATED_KEYS) {
  failuresByKey.set(key.file + SEP + key.test, 0);
}
const unexpected: Array<{ file: string; test: string }> = [];
for (const pair of failPairs) {
  const key = pair.file + SEP + pair.test;
  if (failuresByKey.has(key)) {
    failuresByKey.set(key, (failuresByKey.get(key) ?? 0) + 1);
  } else {
    unexpected.push(pair);
  }
}

if (unexpected.length > 0) {
  console.error(
    "release-suite-gate: FAIL - unexpected test failures:\n" +
      unexpected.map((u) => "  " + u.file + " :: " + u.test).join("\n"),
  );
  console.error("Full suite log: " + logPath);
  process.exit(1);
}

// 6. Fail closed on abnormal termination. A non-zero suite exit is only
// acceptable when it is fully explained by the allowlisted failures: the
// runner completed (summary line present), every parsed failure is
// allowlisted, at least one allowlisted failure fired, and the runner's
// reported failure count equals the parsed count (no unparsed failures).
// A crash, signal kill, timeout, or runner error produces a non-zero exit
// without a complete summary and must fail the gate.
if (suiteStatus !== 0) {
  const summaryMatch = /Ran (\d+) tests across (\d+) files/.exec(output);
  // The tally is "N pass[,/ ] M fail" in the runner's closing summary. The
  // LAST match is taken (bun prints the tally once, but a naive first match
  // can hit "0.13.3 failed to resolve" -> "3 fail" inside a version string).
  const tallyMatches = [...output.matchAll(/(\d+) pass[\s,/]+(\d+) fail/g)];
  const failCountMatch = tallyMatches.length > 0 ? tallyMatches[tallyMatches.length - 1] : null;
  const reportedFails = failCountMatch ? Number(failCountMatch[2]) : null;
  const anyAllowlistedFired = failPairs.length > 0;
  const complete = summaryMatch !== null && reportedFails !== null && reportedFails === failPairs.length;
  if (!anyAllowlistedFired || !complete) {
    console.error(
      "release-suite-gate: FAIL - suite exited " + suiteStatus +
        " with " + failPairs.length + " parsed failure(s) but the run is incomplete or unexplained:" +
        "\n  summary line present: " + (summaryMatch !== null) +
        "\n  reported failure count: " + String(reportedFails) +
        "\n  parsed failure count: " + failPairs.length,
    );
    console.error("Full suite log: " + logPath);
    process.exit(1);
  }
}

// 7. Self-invalidation: an allowlisted failure that no longer fails must be removed.
const stale = GATED_KEYS.filter((key) => (failuresByKey.get(key.file + SEP + key.test) ?? 0) === 0);
if (stale.length > 0) {
  console.error(
    "release-suite-gate: FAIL - allowlisted failure no longer fails; remove the entry from scripts/release-suite-gate.ts:\n" +
      stale.map((s) => "  " + s.file + " :: " + s.test + " - " + s.owner).join("\n"),
  );
  process.exit(1);
}

console.log(
  "release-suite-gate: PASS - " + failPairs.length + " classified pre-existing failure(s) allowlisted:" +
    failPairs.map((p) => "\n  " + p.file + " :: " + p.test).join(""),
);
process.exit(0);
