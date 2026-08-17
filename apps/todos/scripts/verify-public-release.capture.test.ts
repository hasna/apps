// Regression test for OPE2-00174: runCapture/runCaptureBuffer used
// node:child_process spawnSync with the DEFAULT 1MB maxBuffer, so
// `git ls-tree -r --full-tree -z HEAD` on the monorepo-scale tree (measured
// 3,510,205 bytes on hasna/apps) exceeded it, spawnSync killed the child
// (status null, SIGTERM, stdout truncated mid-record), and the release gate
// failed "release-tracked-proof: could not enumerate HEAD", blocking all
// @hasna/todos publishes.
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCapture, runCaptureBuffer } from "./verify-public-release";

const HEAD_TREE_ARGS = ["ls-tree", "-r", "--full-tree", "-z", "HEAD"];
const RECORD_PATTERN = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/;
// Fixture generation (30k writes + git add + commit) exceeds bun's 5s default.
const FIXTURE_TEST_TIMEOUT_MS = 60_000;

// Independent reference capture: same command, explicit 256MB maxBuffer. This
// is a control for COMPLETENESS, not a re-implementation of the fix.
function referenceCapture(cwd: string): Buffer {
  return execFileSync("git", HEAD_TREE_ARGS, { cwd, maxBuffer: 256 * 1024 * 1024 });
}

function parseRecords(buffer: Buffer): string[] {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

describe("verify-public-release capture helpers (OPE2-00174)", () => {
  const fixtureDirs: string[] = [];

  // Synthetic git repo whose HEAD tree's `git ls-tree -r -z` output exceeds
  // 1MB (30,000 empty blobs, ~1.8MB of records), so the fixture discriminates
  // against the old default maxBuffer regardless of where the suite runs.
  function makeLargeTreeFixture(): string {
    const dir = mkdtempSync(join(tmpdir(), "todos-release-capture-"));
    fixtureDirs.push(dir);
    mkdirSync(join(dir, "src"), { recursive: true });
    for (let i = 0; i < 30_000; i += 1) {
      writeFileSync(join(dir, "src", `f${String(i).padStart(5, "0")}`), "");
    }
    const init = spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    if (init.status !== 0) throw new Error(`git init failed: ${init.stderr?.toString()}`);
    const add = spawnSync("git", ["add", "-A"], { cwd: dir });
    if (add.status !== 0) throw new Error(`git add failed: ${add.stderr?.toString()}`);
    // --no-verify: this machine's git shims a global lefthook pre-commit that
    // runs a staged-file scan; on a 30k-file fixture it fails/hangs and would
    // block the fixture commit for reasons unrelated to the code under test.
    const commit = spawnSync(
      "git",
      ["-c", "user.name=release-capture-test", "-c", "user.email=release-capture-test@hasna.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "fixture"],
      { cwd: dir },
    );
    if (commit.status !== 0) throw new Error(`fixture commit failed: ${commit.stderr?.toString()}`);
    return dir;
  }

  afterAll(() => {
    for (const dir of fixtureDirs) rmSync(dir, { recursive: true, force: true });
  });

  test("runCaptureBuffer captures a >1MB HEAD tree without killing the child", () => {
    const fixture = makeLargeTreeFixture();
    const reference = referenceCapture(fixture);
    // The fixture must actually discriminate; if this fails the fixture is
    // too small and the test would be vacuous.
    expect(reference.length).toBeGreaterThan(1024 * 1024);

    const capture = runCaptureBuffer("git", HEAD_TREE_ARGS, fixture);
    // Old code: child killed at the 1MB default -> status null -> mapped to 1.
    expect(capture.status).toBe(0);
    // Completeness: byte-identical to the independent full capture.
    expect(capture.stdout.length).toBe(reference.length);
    expect(capture.stdout.equals(reference)).toBe(true);
    // Every record parses — a killed child truncates mid-record, so the tail
    // record fails the format pattern.
    const records = parseRecords(capture.stdout);
    expect(records.length).toBe(30_000);
    for (const record of records) expect(RECORD_PATTERN.test(record)).toBe(true);
  }, FIXTURE_TEST_TIMEOUT_MS);

  test("runCapture (string-encoded) captures large output without killing the child", () => {
    const fixture = makeLargeTreeFixture();
    const reference = referenceCapture(fixture);
    const capture = runCapture("git", HEAD_TREE_ARGS, process.env, fixture);
    expect(capture.status).toBe(0);
    // Completeness through the string-encoded path: byte length matches the
    // independent reference and the last (lexicographically final) record is
    // present intact — a killed child truncates mid-record instead.
    expect(capture.stdout.length).toBe(reference.length);
    const records = capture.stdout.split("\0").filter(Boolean);
    expect(records.length).toBe(30_000);
    expect(records[records.length - 1]).toBe("100644 blob e69de29bb2d1d6434b8b29ae775ad8c2e48c5391\tsrc/f29999");
    for (const record of records) expect(RECORD_PATTERN.test(record)).toBe(true);
  }, FIXTURE_TEST_TIMEOUT_MS);

  test("release-tracked-proof capture path handles the real repo HEAD", () => {
    // Runs against the actual package repo (apps/todos inside the hasna/apps
    // monorepo): the exact command the release gate runs, via the exact
    // helper the gate uses, with the default cwd.
    const reference = referenceCapture(process.cwd());
    const capture = runCaptureBuffer("git", HEAD_TREE_ARGS);
    expect(capture.status).toBe(0);
    expect(capture.stdout.length).toBe(reference.length);
    expect(capture.stdout.equals(reference)).toBe(true);
    const records = parseRecords(capture.stdout);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) expect(RECORD_PATTERN.test(record)).toBe(true);
  });
});
