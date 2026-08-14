/**
 * @hasna/knowledge
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 */

/**
 * Per-test timeout budgets, expressed in POSIX milliseconds and scaled for the
 * platform the suite is actually running on.
 *
 * WHY THIS EXISTS
 * Every literal budget in tests/ was calibrated against a Linux or macOS runner.
 * The windows-latest matrix leg is measurably slower at the two things these
 * budgets are spent on -- process spawn and filesystem I/O -- so the same amount
 * of work does not fit in the same number of milliseconds there.
 *
 * MEASURED on hasna/knowledge CI, six successful runs (30806905027, 30787689644,
 * 30776040992, 30774795997, 30712522350, 30654203421), comparing the three
 * `test-matrix` legs of each run on identical commits:
 *
 *     whole-suite wall time     windows / ubuntu   mean 2.56x   max 3.02x
 *                               windows / macos    mean 3.23x   max 4.70x
 *     per-test p95 (run 30847733877)   windows 2199.7ms   ubuntu 805.2ms   2.7x
 *     slowest PASSING test             windows 11877.5ms  ubuntu 2830.2ms  4.2x
 *
 * WINDOWS_FACTOR is 3, which covers the measured max ratio against ubuntu and
 * leaves the slowest observed passing test comfortably inside every scaled budget.
 *
 * WHAT THIS IS NOT
 * This is not "widen the timeout until it goes green". On Linux and macOS the
 * returned value is byte-identical to the literal that was there before, so a
 * genuine hang or performance regression still fails those legs exactly as it did
 * yesterday -- which is where the suite is fast and the signal is sharp. Only the
 * leg that is measurably ~3x slower gets a proportionally larger budget, so on
 * Windows a real hang still fails, just at 3x the wall time.
 *
 * The honest cost: a genuinely hung test on windows-latest now takes up to three
 * times longer to surface. That is the accepted trade for a required status check
 * that was failing ~29% of runs (11 of 38 completed runs measured 2026-07-29 to
 * 2026-08-03) on ten different tests, none of them a real defect.
 *
 * NOTE ON THE RUNNER FLAG: ci.yml runs `bun test --timeout 20000`, which sets only
 * the DEFAULT budget. An explicit per-test budget overrides it, and several of the
 * budgets that actually timed out on Windows (10000, 15_000) are LOWER than that
 * default -- so raising the runner flag does nothing for exactly the tests that
 * fail. The scaling has to happen at the call site, which is what this helper does.
 */
const WINDOWS_FACTOR = 3;

export function budget(posixMs: number): number {
  return process.platform === 'win32' ? posixMs * WINDOWS_FACTOR : posixMs;
}
