import { describe, expect, test } from "bun:test";
import packageJson from "../../package.json";

/**
 * Contract tests for the publish gate (prepublishOnly / prepack).
 *
 * WHY THIS SUITE EXISTS: HC-00677 (row 7f97afef) recorded that `prepublishOnly` ran a plain
 * `bun test` — the full suite under Bun's default 5000ms per-test timeout, with no partition
 * check and no `RECORDINGS_TEST_TIMEOUT_MS` — so `npm publish` was blocked on a normal local
 * station, off-CI, on environmental/timeout failures the CI workflow already compensates for.
 * The CI workflow (`.github/workflows/ci.yml`) runs the GATED partition
 * (`bun scripts/ci-linux-suite.ts --gated`) under `RECORDINGS_TEST_TIMEOUT_MS=120000`, and the
 * lifecycle suite resolves that same variable for its internal FIFO deadline. The publish gate
 * must run the same suite partition as CI, or the gate verifies something CI never runs and a
 * green local publish proves nothing about what the runner will see.
 *
 * The gate is a static contract here rather than an executed `bun run prepublishOnly`:
 * executing it inside the suite would re-run the whole suite (recursion) and it is the shape
 * of the invocation that regressed, not the exit code of a one-off run.
 */

function script(name: string): string {
  const value = packageJson.scripts?.[name];
  expect(value, `package.json must define the "${name}" script`).toBeDefined();
  return value as string;
}

describe("prepublishOnly", () => {
  test("runs the gated suite via release-suite-gate, never a bare `bun test`", () => {
    const prepublishOnly = script("prepublishOnly");
    // The original regression (HC-00677): prepublishOnly used to be
    // `bun run typecheck && bun run test`, which ran the full suite under Bun's default
    // 5000ms timeout with no partition check. A standalone `bun run test` token (not
    // `test:gated`) means the gate silently stopped covering what CI covers. The token is
    // matched as a whole word so `test:gated` cannot satisfy it. The merged gate now runs
    // through the release-suite-gate script, which itself invokes the gated partition.
    expect(prepublishOnly).not.toMatch(/(?:^|[&| ])bun run test(?:$|[ &|])/);
    expect(prepublishOnly).toContain("release-suite-gate");
  });

  test("keeps release-suite-gate wired as its own script", () => {
    // The gate runs the Linux-CI partition (partition check first, then the gated suite
    // under RECORDINGS_TEST_TIMEOUT_MS) and fails closed on abnormal termination. Pinning
    // the script indirection keeps prepublishOnly reviewable and lets the gate script own
    // its allowlist self-invalidation.
    expect(script("release-suite-gate")).toContain("scripts/release-suite-gate.ts");
  });

  test("keeps typecheck ahead of the suite", () => {
    const prepublishOnly = script("prepublishOnly");
    const typecheckIndex = prepublishOnly.indexOf("typecheck");
    const gateIndex = prepublishOnly.indexOf("release-suite-gate");
    // -1 fails the ordering assertion on purpose: if either half is deleted the comparison
    // must not pass the way `indexOf(...) < indexOf(...)` would for an absent needle.
    expect(typecheckIndex, "typecheck must still be part of the publish gate").toBeGreaterThanOrEqual(0);
    expect(gateIndex, "release-suite-gate must still be part of the publish gate").toBeGreaterThanOrEqual(0);
    expect(typecheckIndex).toBeLessThan(gateIndex);
  });
});

describe("test:gated", () => {
  test("proves the partition before running it", () => {
    // The quarantine file is the documented, non-silent skip: an entry requires its own
    // `# reason:` line and must still fail to run; `--check` refuses a stale entry. If the
    // partition check is dropped from the gated script, skips can rot silently again.
    expect(script("test:gated")).toContain("ci-linux-suite.ts --check");
  });

  test("raises the test timeout the way CI does", () => {
    // CI sets RECORDINGS_TEST_TIMEOUT_MS=120000 and macos-app-lifecycle resolves the same
    // variable for its internal FIFO deadline. Without the raise, subprocess-spawning tests
    // trip Bun's 5000ms default and report as `Received: ""`.
    expect(script("test:gated")).toContain("RECORDINGS_TEST_TIMEOUT_MS");
  });

  test("delivers a non-empty value to --timeout", () => {
    // MEASURED 2026-08-20: `RECORDINGS_TEST_TIMEOUT_MS="${RECORDINGS_TEST_TIMEOUT_MS:-120000}"
    // bun test --timeout "$RECORDINGS_TEST_TIMEOUT_MS"` passes an EMPTY value to --timeout.
    // Under POSIX, the argument list of a simple command expands BEFORE its assignment prefix
    // takes effect, so the bare `$RECORDINGS_TEST_TIMEOUT_MS` in the argument is whatever the
    // ambient environment held (nothing), and bun falls back to its 5000ms default — the exact
    // failure the CI workflow comment warns about. Measured: 1359-test gated run failed
    // `database.test.ts > closeDatabase > closes the database and allows reset` at 5000ms
    // (6035ms elapsed) while the guard log recorded `argv=test --timeout  src/...` (empty).
    // The argument must carry its own `:-120000` default so it cannot expand empty.
    const gated = script("test:gated");
    expect(gated).not.toContain('--timeout "$RECORDINGS_TEST_TIMEOUT_MS"');
    expect(gated).toContain('--timeout "${RECORDINGS_TEST_TIMEOUT_MS:-120000}"');
  });
});

describe("prepack", () => {
  test("keeps the platform gate ahead of everything else", () => {
    // HC-00677's correction: the native fs-guard prebuild is a macOS requirement, not a gate
    // defect. prepack must keep composing the platform gate FIRST, so a Linux pack still stops
    // at the platform requirement with the visible WARN rather than shipping a tarball without
    // the macOS prebuild.
    const prepack = script("prepack");
    expect(prepack.startsWith("bun run prepack:platform-gate && ")).toBe(true);
    expect(script("prepack:platform-gate")).toContain("Darwin");
  });
});
