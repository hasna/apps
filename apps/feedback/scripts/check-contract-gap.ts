// Hold the distance between this repo and the Hasna Service Contract at a
// measured, committed number, and fail when it moves in either direction.
//
// WHY THIS EXISTS RATHER THAN `bun run contract-check` IN CI.
// `contract-check` exits 1 today and will keep exiting 1 until the storage
// migration in docs/contract-conformance.md lands. Wiring it into CI as-is
// makes the build permanently red, and a permanently red gate is one nobody
// reads. Dropping it from CI instead — which is where this repo stood — means
// the manifest can drift with nothing noticing. This script is the third
// option: the failure set is data, and CI asserts the data has not changed.
//
// WHY IT PROBES BEHIND THE MANIFEST GATE, AND WHY THAT IS THE LOAD-BEARING HALF.
// `repo-conformance` returns after `manifest_valid` fails, so the real report
// today is exactly one line. A ratchet built on that output alone would baseline
// a single failure and pass forever while five further violations sat unseen
// behind the early return — a gate that cannot fail for the case it exists to
// catch, which is the same mistake scan-artifact.ts documents about scanning
// `src/` instead of the tarball.
//
// So the check runs TWICE: once against the repo as it stands, and once against
// a throwaway copy whose manifest carries a minimal schema-valid `storage`
// block. That second run is a PROBE, not a claim — the block is never written
// to the real manifest, because no `storage` value here would be true while the
// only implemented backend is an append-only JSONL file. Its only job is to get
// past the early return so the checks underneath are visible and pinned.
//
// BOTH OUTCOMES ARE REACHABLE, which is the property that makes this evidence:
// add a violation and the set grows and this fails; fix one and the set shrinks
// and this also fails, forcing the baseline down in the same commit as the fix.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const baselinePath = join(import.meta.dir, "contract-gap-baseline.json");
const scanner = join(repoRoot, "node_modules", ".bin", "contracts");
const update = process.argv.includes("--update");

// The probe block is the smallest value that satisfies StorageContractSchema for
// a cli-with-store repo: `mode` admits only sqlite|postgres, and sqlite mode
// additionally requires a `.db` sqlitePath. It exists to unblock the early
// return and for no other purpose.
const PROBE_STORAGE = { mode: "sqlite", sqlitePath: "~/.hasna/feedback/feedback.db" };

interface ConformanceCheck { id: string; status: string; detail: string }
interface ConformanceFailure { id: string; detail: string }

function conformance(root: string): ConformanceCheck[] {
  const result = Bun.spawnSync([scanner, "repo-conformance", root, "--json"], { stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  if (!stdout) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`repo-conformance produced no JSON for ${root} (exit ${result.exitCode})\n${stderr}`);
  }
  return (JSON.parse(stdout).checks ?? []) as ConformanceCheck[];
}

function failingChecks(checks: ConformanceCheck[]): ConformanceFailure[] {
  return checks
    .filter((check) => check.status === "fail")
    .map(({ id, detail }) => ({ id, detail }))
    .sort((left, right) => left.id.localeCompare(right.id) || left.detail.localeCompare(right.detail));
}

/** Copy the tracked tree somewhere disposable so the probe never touches the real manifest. */
function probeTree(): string {
  const workspace = mkdtempSync(join(tmpdir(), "feedback-contract-gap-"));
  const copy = Bun.spawnSync([
    "tar", "-cf", "-",
    "--exclude=./node_modules", "--exclude=./.git", "--exclude=./dist", ".",
  ], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  if (copy.exitCode !== 0) {
    rmSync(workspace, { recursive: true, force: true });
    throw new Error(`tar failed: ${new TextDecoder().decode(copy.stderr).trim()}`);
  }
  const extract = Bun.spawnSync(["tar", "-xf", "-", "-C", workspace], { stdin: copy.stdout, stderr: "pipe" });
  if (extract.exitCode !== 0) {
    rmSync(workspace, { recursive: true, force: true });
    throw new Error(`tar extract failed: ${new TextDecoder().decode(extract.stderr).trim()}`);
  }
  const manifestPath = join(workspace, "hasna.contract.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.storage = PROBE_STORAGE;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return workspace;
}

function failureKey(failure: ConformanceFailure): string {
  return JSON.stringify([failure.id, failure.detail]);
}

function failureLabel(failure: ConformanceFailure): string {
  return `${failure.id} (${failure.detail})`;
}

function failureIds(failures: ConformanceFailure[]): string {
  return failures.map((failure) => failure.id).join(", ") || "(none)";
}

function diff(label: string, actual: ConformanceFailure[], expected: ConformanceFailure[]): string[] {
  const actualKeys = new Set(actual.map(failureKey));
  const expectedKeys = new Set(expected.map(failureKey));
  const appeared = actual.filter((failure) => !expectedKeys.has(failureKey(failure)));
  const cleared = expected.filter((failure) => !actualKeys.has(failureKey(failure)));
  const problems: string[] = [];
  if (appeared.length > 0) {
    problems.push(`${label}: NEW conformance failures: ${appeared.map(failureLabel).join("; ")}`);
  }
  if (cleared.length > 0) {
    problems.push(
      `${label}: these no longer fail: ${cleared.map(failureLabel).join("; ")} — progress. Rerun with --update and commit the smaller baseline alongside the fix.`,
    );
  }
  return problems;
}

const reported = failingChecks(conformance(repoRoot));

let behindManifestGate: ConformanceFailure[];
const workspace = probeTree();
try {
  const probed = failingChecks(conformance(workspace));
  // manifest_valid passes under the probe by construction; it is tracked by the
  // `reported` set and would otherwise show up here as a phantom improvement.
  behindManifestGate = probed.filter((failure) => failure.id !== "manifest_valid");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

if (update) {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  baseline.reported = reported;
  baseline.behindManifestGate = behindManifestGate;
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`updated ${baselinePath}`);
  console.log(`  reported:           ${failureIds(reported)}`);
  console.log(`  behindManifestGate: ${failureIds(behindManifestGate)}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const problems = [
  ...diff("reported", reported, baseline.reported ?? []),
  ...diff("behind the manifest gate", behindManifestGate, baseline.behindManifestGate ?? []),
];

if (problems.length > 0) {
  console.error("Contract conformance gap changed:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("\nThe remaining conformance work is enumerated in docs/contract-conformance.md.");
  process.exit(1);
}

console.log(`contract gap unchanged: ${reported.length} reported, ${behindManifestGate.length} behind the manifest gate`);
console.log(`  reported:           ${failureIds(reported)}`);
console.log(`  behindManifestGate: ${failureIds(behindManifestGate)}`);
