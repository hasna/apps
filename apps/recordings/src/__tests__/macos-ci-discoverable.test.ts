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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Test file lives at apps/recordings/src/__tests__/; repo root is four levels up.
const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
const rootWorkflowPath = join(repoRoot, ".github", "workflows", "recordings-macos.yml");
const nestedWorkflowDir = join(import.meta.dir, "..", "..", ".github", "workflows");
const nestedWorkflowPath = join(nestedWorkflowDir, "ci.yml");

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
});
