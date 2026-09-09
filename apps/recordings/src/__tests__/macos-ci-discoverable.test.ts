// Regression tests for the apps-ship-macos-app lane (todos 1a2ba6ad, stale-sweep
// "the CI build-and-sign path").
//
// Measured 2026-08-20: the recordings macOS native CI job (Swift/C compile gate,
// `bun run verify:ci-native`) lives in `apps/recordings/.github/workflows/ci.yml` —
// a NESTED workflow. GitHub Actions discovers workflows ONLY at the repo root
// `.github/workflows/` (this repo's own deploy-lane gate documents the same defect
// class for nested deploy lanes, todos 9b1828c9). The workflows API for hasna/apps
// lists exactly six root workflows and none under apps/recordings, so the Swift
// half compiles NOWHERE in the monorepo and no automation assembles
// Hasna Recordings.app from main. The stale-sweep comment named this the "CI
// build-and-sign path" — a merged main still produces no installable artifact.
//
// These tests lock the fix: the native compile gate must be discoverable at the
// repo root (`.github/workflows/recordings-macos.yml`), must run on macOS with
// the package's own compile gate, and the nested dead lane that advertised a
// native job that never ran must be gone (a silent dead lane that looks
// authoritative is exactly the defect class the deploy-lane gate exists to stop).

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Test file lives at apps/recordings/src/__tests__/; repo root is four levels up.
const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
const rootWorkflowPath = join(repoRoot, ".github", "workflows", "recordings-macos.yml");
const nestedWorkflowDir = join(import.meta.dir, "..", "..", ".github", "workflows");
const nestedWorkflowPath = join(nestedWorkflowDir, "ci.yml");
type Step = { id?: string; uses?: string; run?: string; if?: string; shell?: string;
  "continue-on-error"?: unknown; "timeout-minutes"?: number; with?: Record<string, unknown> };
type Workflow = { on: Record<string, { paths?: string[] }>; jobs: { native: {
  "continue-on-error"?: unknown; steps: Step[];
} } };
const readWorkflow = () => Bun.YAML.parse(readFileSync(rootWorkflowPath, "utf8")) as Workflow;

describe("recordings macOS CI is discoverable at the repo root (CI build-and-sign path)", () => {
  test("a root-discoverable workflow carries the recordings native compile gate", () => {
    expect(
      existsSync(rootWorkflowPath),
      "missing root workflow .github/workflows/recordings-macos.yml — GitHub Actions only discovers workflows at the repo root, so the Swift half compiles nowhere",
    ).toBe(true);
    const workflow = readFileSync(rootWorkflowPath, "utf8");
    // Runs on a macOS runner so the Swift/C half actually compiles.
    expect(workflow).toContain("macos-latest");
    // Carries the package's own compile gate (empty native-known-errors baseline =
    // plain build gate), not a loose swift invocation.
    expect(workflow).toContain("verify:ci-native");
    // The compile gate must run from the member directory so it resolves the
    // member's .github/native-known-errors.txt and Package.swift.
    expect(workflow).toContain("working-directory: apps/recordings");
    // Scoped to the member so a push to any other app does not burn macOS minutes.
    expect(workflow).toMatch(/paths:\s*\n\s*- apps\/recordings\/\*\*/);
  });

  test("the nested dead lane that advertised a native job is gone", () => {
    // apps/recordings/.github/workflows/ci.yml is never discovered by GitHub
    // Actions (nested path), so its native job has never run in the monorepo. A
    // reader finding it — as the stale-sweep did — concludes CI compiles the
    // Swift half when it does not. The gate moved to the root workflow; the dead
    // lane must not remain to advertise coverage that does not exist.
    expect(existsSync(nestedWorkflowPath)).toBe(false);
  });

  test("the root workflow pins the same toolchain floor the package declares", () => {
    const workflow = readFileSync(rootWorkflowPath, "utf8");
    expect(workflow).toContain("swift-tools-version");
    expect(workflow).toContain("Package.resolved");
  });

  test("unexpected native test failures fail the job and workflow edits trigger it", () => {
    const workflow = readWorkflow();
    const job = workflow.jobs.native;
    const step = job.steps.find(value => value.id === "native_tests")!;
    expect(job["continue-on-error"]).toBeUndefined();
    expect(step["continue-on-error"]).toBeUndefined();
    expect(step.if).toBe("steps.compile.outputs.compiled == 'true'");
    expect(step.shell).toBe("bash");
    expect(step["timeout-minutes"]).toBe(12);
    for (const trigger of ["pull_request", "push"]) {
      expect(workflow.on[trigger]?.paths).toContain(".github/workflows/recordings-macos.yml");
    }
  });

  test.each([
    ["known-issue probes and the opt-in skip", 0,
      '◇ Test "realtime settle latency" skipped.\n✘ Test run with 418 tests in 60 suites passed after 1.000 seconds with 3 known issues.'],
    ["four unexpected issues alongside three known issues", 1,
      '✘ Test run with 418 tests in 60 suites failed after 12.798 seconds with 7 issues (including 3 known issues).'],
  ] as const)("the actual Bash pipeline preserves Swift's exit for %s", (_name, exit, summary) => {
    const step = readWorkflow().jobs.native.steps.find(value => value.id === "native_tests")!;
    const directory = mkdtempSync(join(tmpdir(), "recordings-native-ci-"));
    try {
      const bin = join(directory, "bin"); mkdirSync(bin);
      const member = join(directory, "apps", "recordings"); mkdirSync(member, { recursive: true });
      const tooling = join(directory, "tooling", "ci"); mkdirSync(tooling, { recursive: true });
      const runnerTemp = join(directory, "runner-temp"); mkdirSync(runnerTemp);
      const outputs = join(directory, "outputs");
      // Exercise the workflow's real pipeline and cleanup trap without Swift or
      // process sampling. The watcher's own unit tests cover its native checks.
      writeFileSync(join(tooling, "watch-recordings-native-stall.py"), `import pathlib, sys, time
output = pathlib.Path(sys.argv[sys.argv.index("--output") + 1])
deadline = time.monotonic() + 2
while not (output / "stop").exists():
    if time.monotonic() > deadline: raise SystemExit(99)
    time.sleep(0.01)
(output / "status.json").write_text('{"status":"stopped_without_sample"}')
`);
      writeFileSync(join(bin, "swift"), `#!/bin/sh
test "$#" -eq 3 && test "$1" = test && test "$2" = --package-path && test "$3" = src/native/Recordings || exit 99
printf '%s\\n' "$RECORDINGS_SWIFT_FIXTURE_SUMMARY"
exit "$RECORDINGS_SWIFT_FIXTURE_STATUS"
`, { mode: 0o700 });
      const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", step.run!], {
        cwd: member, encoding: "utf8", timeout: 3000,
        env: { HOME: directory, TMPDIR: directory, PATH: `${bin}:/usr/bin:/bin`,
          RUNNER_TEMP: runnerTemp, GITHUB_OUTPUT: outputs,
          RECORDINGS_SWIFT_FIXTURE_SUMMARY: summary, RECORDINGS_SWIFT_FIXTURE_STATUS: String(exit) },
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(exit);
      expect(readFileSync(join(member, "swift-test.log"), "utf8")).toBe(summary + "\n");
      const diagnostics = readFileSync(outputs, "utf8").trim().replace(/^diagnostics=/, "");
      expect(JSON.parse(readFileSync(join(diagnostics, "status.json"), "utf8")))
        .toEqual({ status: "stopped_without_sample" });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test("diagnostic reporting and upload still run after a native failure", () => {
    const steps = readWorkflow().jobs.native.steps;
    const report = steps.find(value => value.run?.includes("Native tests ran and did NOT pass"))!;
    expect(report.if).toBe("always() && steps.compile.outputs.compiled == 'true'");
    const upload = steps.find(value => value.uses?.startsWith("actions/upload-artifact@"))!;
    expect(upload.if).toBe("always()");
    expect(String(upload.with?.path).trim().split("\n")).toEqual([
      "apps/recordings/swift-test.log",
      "${{ steps.native_tests.outputs.diagnostics }}/sample.txt",
      "${{ steps.native_tests.outputs.diagnostics }}/status.json",
    ]);
  });
});
