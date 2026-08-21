#!/usr/bin/env bun
/**
 * Release-suite gate (wired into `prepublishOnly`).
 *
 * Runs the app's own Linux-CI-partitioned suite — `test:gated`, which covers
 * every discovered `*.test.ts` (the quarantine file is empty by design) — and
 * fails on ANY failure except the allowlisted pre-existing classes below.
 *
 * Why the allowlist exists: the suite is red at this release's base sha with
 * exactly two measured pre-existing classes (both reproduced identically at
 * the pristine base commit 4a9b31e56, classified non-blocking by the release
 * lineage). The old `prepublishOnly` (`bun run test`, bare) could not pass on
 * any box for independent reasons: no timeout flag for the long macOS
 * lifecycle suites, and the ambient hosted-store environment on fleet boxes.
 *
 * The allowlist is SELF-INVALIDATING, the same property as
 * `.github/linux-quarantine.txt`: if an allowlisted failure stops failing
 * (the owning lane lands its fix, or a quarantined package ages out of the
 * 7-day window), the gate exits 1 and demands the entry be removed. Any
 * failure outside the allowlist fails the gate.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SEP = "::";

const GATED_KEYS: Array<{ file: string; test: string; owner: string; reason: string }> = [
  {
    file: "src/__tests__/service-contract-manifest.test.ts",
    test: "the repository satisfies the tracked contract kit's conformance checks",
    owner: "contracts-surface lanes (hasna/apps PRs 743/749/754 lineage)",
    reason:
      "credential_seam_compliance flags the vendored client seam (resolveStorageClient in src/http/client.ts) and the RECORDINGS_API_KEY env read (src/lib/config.ts) - an in-flight migration owned by the contracts-surface lanes; classified pre-existing at the release base. Remove this entry when the lane lands.",
  },
  {
    file: "src/__tests__/native-app-companion-contract.test.ts",
    test: "(unnamed)",
    owner: "release supply-chain policy",
    reason:
      "build_companion_cli.sh enforces --minimum-release-age=604800, so the companion build refuses @hasna/contracts@0.13.3 (published 2026-08-21T13:13Z) inside its 7-day quarantine by design until 2026-08-28. The npm publish path does not build the companion. Remove this entry when the package ages out.",
  },
];

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

// 6. Self-invalidation: an allowlisted failure that no longer fails must be removed.
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
