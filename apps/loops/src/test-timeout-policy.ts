/**
 * The suite's deliberate timeout policy, and the measurements behind it.
 *
 * WHY THIS EXISTS
 *
 * Until this landed, the suite ran on Bun's *framework default* per-test
 * timeout of 5000ms. Nobody in this repo chose that number: there was no
 * bunfig.toml, no `--timeout` in any package script, and no per-test timeout
 * argument anywhere in the suite. It asserted no performance property and
 * guarded no regression — it was the default kill-switch inherited from a
 * framework whose default is tuned for in-process unit tests.
 *
 * 11 of this repo's test files instead drive real subprocesses. Their
 * wall-clock duration is `N spawns x per-spawn process-boot cost`, and that
 * cost is set by CPU contention on the host, not by the code under test.
 * Measured on station01 (20 cores) at loadavg 8-12:
 *
 *   ordinary `bun src/cli/index.ts --json list`   0.31 - 1.18s   (4x spread)
 *   `machines list`                               1.54 - 2.03s
 *   `machines show local`                         2.26 - 3.01s
 *
 * So a 9-spawn functional test ranges from ~2.8s to ~10.6s purely as a
 * function of how busy the machine is. A full-suite run duly failed 5-6 tests
 * at 5001-5626ms and blocked the 0.4.31 publish, because `prepublishOnly`
 * runs the whole suite. A wall-clock kill on subprocess-bound tests measures
 * the machine, not the code. That is the defect this policy fixes.
 *
 * WHY A BIGGER NUMBER IS NOT, BY ITSELF, THE FIX
 *
 * Raising a load-sensitive budget just moves the cliff: at loadavg 90
 * (measured on this fleet during an unpaced sweep) the same test is slower
 * again. The load-sensitive control has to be *replaced*, not enlarged. So the
 * thing the default was incidentally providing — "notice a CLI that hangs
 * forever" — is now enforced where it is deterministic and load-insensitive:
 * at the spawn boundary, via CLI_SPAWN_TIMEOUT_MS. A hung child is killed with
 * ETIMEDOUT naming the command that hung, which is also a far better
 * diagnostic than "this test timed out after 5000ms".
 *
 * With hang detection moved there, SUITE_TIMEOUT_MS is a pure backstop and
 * only has to sit far enough above legitimate worst-case that host load
 * cannot reach it.
 *
 * WHY THE FLAG AND NOT bunfig.toml — MEASURED, NOT ASSUMED
 *
 * Two plausible-looking mechanisms silently do not work on bun 1.3.14, and
 * both are recorded here so nobody "simplifies" the scripts back into them:
 *
 *   1. `[test] timeout = N` in bunfig.toml is parsed and IGNORED. A test still
 *      died at the 5000ms default with `timeout = 20000` set.
 *   2. `setDefaultTimeout()` — whether called from a `[test] preload` hook or
 *      imported directly by a test file — applies only when a SINGLE test file
 *      is run. In a multi-file run it has no effect: the same probe passed
 *      alone and died at 5003ms as soon as a second file joined the run.
 *
 * Mechanism 2 is the dangerous one, because it works exactly when you test it
 * the obvious way (one file) and silently fails in the real full-suite gate.
 * Only the `--timeout` CLI flag was measured to hold across a multi-file run,
 * so the policy lives on the `test` and `prepublishOnly` scripts in
 * package.json, and test-timeout-policy.test.ts asserts it is still there.
 */

/** Bun's framework default, recorded so the policy test can prove we left it. */
export const BUN_DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Per-test backstop, passed as `--timeout` by the `test` and `prepublishOnly`
 * scripts. Hangs are caught at the spawn boundary; this only bounds a
 * pathological case that is not a hung subprocess.
 *
 * Justified against measured worst case rather than a round number: worst
 * observed legitimate test was 5.2s at loadavg ~10. 120_000ms is ~23x that,
 * and ~5x a pessimistic estimate of the same test at loadavg 90 (~21s,
 * extrapolating the 4x spread already measured between a quiet and a loaded
 * spawn).
 */
export const SUITE_TIMEOUT_MS = 120_000;

/**
 * Hard ceiling on a single CLI subprocess spawned by a test.
 *
 * The deterministic, load-insensitive control that replaces the per-test
 * wall-clock kill. Worst legitimate single invocation measured was
 * `machines show local` at 3.01s, so 60s is ~20x headroom: a loops CLI
 * invocation that has not returned in a minute is hung, not slow.
 *
 * It lives in this module rather than in a *.test.ts file so tests can import
 * it without re-registering that file's test cases.
 */
export const CLI_SPAWN_TIMEOUT_MS = 60_000;
