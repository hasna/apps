/**
 * Explicit timeout budgets for tests that shell out to the real CLI.
 *
 * bun's default per-test timeout is 5000 ms. Any test that runs
 * `bun run src/cli/index.tsx` pays a full cold start first — TS/TSX transpile of
 * the CLI entry and its Ink/React import graph, then opening and migrating a
 * SQLite file — before the assertion under test even begins.
 *
 * Measured with the same env the subprocess tests pin (temp HOME, temp DB, forced
 * local mode) on a contended workstation at load average 73-80, six consecutive
 * cold `bun run src/cli/index.tsx --json add` invocations took 7.83s, 6.19s,
 * 5.96s, 7.12s, 7.31s and 7.58s, all exiting 0. So a SINGLE spawn already exceeds
 * the 5000 ms default; a test making two of them has no chance. Confirming it
 * end to end, the two subprocess tests in local-first.test.ts measured 7.73s and
 * 7.18s of wall time (bun junit reporter) — i.e. they were over the default
 * before these budgets were added, not merely close to it.
 *
 * Why an explicit budget and not `--retry`: retry re-runs a test that FAILED, and
 * this failure is a timeout that recurs deterministically under load — every
 * attempt pays the same cold start and hits the same ceiling. Retrying a
 * too-small timeout turns one slow failure into three slow failures. The budget
 * has to be right.
 *
 * Sizing is derived from how many sequential CLI invocations a test makes, so
 * adding a spawn means updating a count rather than inventing a new round number.
 */

/**
 * Per-spawn allowance: ~3x the worst cold start observed at load 73-80, so a
 * runner several times more contended than the measured box still passes. This is
 * a ceiling for detecting a hang, not a target — a healthy spawn returns as soon
 * as the CLI exits, so headroom costs nothing on green runs.
 *
 * The ~3x factor here is smaller than the ~8x in server-harness.ts's
 * SERVER_START_BUDGET_MS on purpose: this allowance is multiplied by a spawn
 * count, so the margin compounds with the workload, whereas the server budget is
 * a single flat ceiling that has to absorb the whole of one cold start.
 */
const COLD_CLI_SPAWN_ALLOWANCE_MS = 24_000;

/** Slack for the test body itself: temp dirs, fs assertions, JSON parsing. */
const TEST_BODY_OVERHEAD_MS = 12_000;

/**
 * Budget for a test that performs `spawns` sequential cold CLI invocations.
 *
 * @param spawns how many times the test shells out to the CLI, in sequence
 */
export function cliSpawnBudgetMs(spawns: number): number {
  if (!Number.isInteger(spawns) || spawns < 1) {
    throw new Error(`cliSpawnBudgetMs expects a positive spawn count, got ${spawns}`);
  }
  return spawns * COLD_CLI_SPAWN_ALLOWANCE_MS + TEST_BODY_OVERHEAD_MS;
}

/**
 * Per-invocation allowance for a PRE-BUILT CLI bundle, which skips the transpile
 * a `bun run src/cli/index.tsx` spawn pays and is therefore much cheaper.
 *
 * Measured on GitHub `ubuntu-latest` across two consecutive runs of the Stage-A
 * sweep over all 122 local-only commands: 37,831ms and 42,972ms total, i.e.
 * 310ms and 352ms per invocation. Set to ~4x the worse of the two so a slower
 * runner still passes.
 */
const BUILT_CLI_SPAWN_ALLOWANCE_MS = 1_500;

/**
 * Budget for a test that invokes the pre-built CLI `spawns` times in sequence.
 *
 * Prefer passing a count derived from the source of truth that drives the loop
 * (e.g. the size of the CLI capability matrix) rather than a literal, so the
 * budget grows with the workload instead of silently tightening as commands are
 * added.
 *
 * @param spawns how many times the test invokes the built CLI, in sequence
 */
export function builtCliSpawnBudgetMs(spawns: number): number {
  if (!Number.isInteger(spawns) || spawns < 1) {
    throw new Error(`builtCliSpawnBudgetMs expects a positive spawn count, got ${spawns}`);
  }
  return spawns * BUILT_CLI_SPAWN_ALLOWANCE_MS + TEST_BODY_OVERHEAD_MS;
}
