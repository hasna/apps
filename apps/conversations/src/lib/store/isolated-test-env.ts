/**
 * TEST-ONLY. Pin a suite's store to a local SQLite file, and mean it.
 *
 * ── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────────
 *
 * `src/lib/db.ts` resolves the db path in this order:
 *
 *     if (env.HASNA_CONVERSATIONS_DB_PATH) return env.HASNA_CONVERSATIONS_DB_PATH;
 *     if (env.CONVERSATIONS_DB_PATH)       return env.CONVERSATIONS_DB_PATH;
 *
 * Essentially the whole test corpus isolates on `CONVERSATIONS_DB_PATH` — the
 * LOWER-precedence name. Assigning it does nothing whenever the higher-precedence
 * `HASNA_`-prefixed name is present in the ambient environment, and on station01
 * the e2e helpers actively forward ambient values by spreading `...process.env`
 * beside their override. Every test in such a file then quietly shares ONE
 * database while its `afterEach` unlinks a file nothing ever opened.
 *
 * Measured on this repository (differential execution, one variable changed):
 *
 *     src/lib/messages.test.ts   154 pass /   0 fail  ->    0 pass / 154 fail
 *     src/lib/locks.test.ts       33 pass /   0 fail  ->   24 pass /   9 fail
 *     src/lib/gatherer.test.ts     5 pass / 0 fail / 12 expect()
 *                              ->  5 pass / 0 fail / 23 expect()
 *
 * The last row is the reason this module is worth its weight. `gatherer.test.ts`
 * reports an IDENTICAL verdict in both arms — same passes, same failures, green
 * either way. Only the assertion COUNT moves, because state accumulates inside
 * the shared file and a loop over `result.examples` therefore runs more times.
 * A green suite is exactly what an unfixed file produces, so pass/fail is not an
 * acceptance signal here and `expect()` calls must be compared too.
 *
 * ── WHY A HOOK AND NOT A SCOPED WRAPPER ───────────────────────────────────────
 *
 * `withOnlyStoreEnv` in `cloud-in-test-guard.test.ts` clears the same eleven
 * names and would appear to be liftable. It is deliberately NOT reused, and its
 * own comment says why: it is safe only because every case using it is
 * SYNCHRONOUS. That caveat is not a stylistic hedge — it is a correctness bound,
 * and the mechanism is worth naming so nobody re-proposes the shortcut.
 *
 * A scoped wrapper is `try { return fn(); } finally { restore(); }`. Hand it an
 * ASYNC `fn` and it returns a PROMISE; `finally` fires the instant that promise
 * is returned, which is BEFORE the awaited body has run. The environment is
 * restored underneath the test that asked to be isolated, so the isolation
 * evaporates precisely where the work happens. Wrapping the async suites in this
 * repository with it would look correct, run green, and isolate nothing.
 *
 * So the shape changes rather than the key list. `pinStoreToDb` is called from
 * `beforeEach` and `restoreStoreEnv` from `afterEach`. bun awaits both hooks and
 * awaits the test body between them, so the pinned window provably spans the
 * whole async test — the one thing a scoped wrapper cannot do for async code.
 *
 * The honest residual: while that window is open the pin is process-wide. Nothing
 * else observes it because bun executes test FILES sequentially and tests within a
 * file sequentially, and this repository contains zero `test.concurrent` /
 * `describe.concurrent` (measured). A subprocess spawned inside the window
 * inherits the pinned path, which is the isolation working rather than leaking.
 *
 * ── THE IN-REPO CONTROL ───────────────────────────────────────────────────────
 *
 * `src/lib/channel-orphan-messages.test.ts` already pins BOTH db-path names by
 * hand and was unaffected by the same injection that broke the files above. It is
 * the proof that pinning the higher-precedence name is the load-bearing part;
 * this module generalises what that file does by hand.
 */

import { ALLOW_CLOUD_IN_TESTS_ENV_KEY, DB_PATH_KEYS, ENV_KEYS } from "./index.js";

/**
 * EVERY variable that can select a store, derived from the transport contract
 * rather than hardcoded — eleven names as of this commit.
 *
 * Clearing the whole set matters more than setting one member. A suite that sets
 * only `CONVERSATIONS_DB_PATH` is overridden by an ambient `HASNA_`-prefixed path;
 * a suite that sets a db path but leaves an ambient API url and key in place is
 * relying on `getDbPath` winning a race it is not guaranteed to be asked about,
 * since other resolvers in `store/index.ts` read the mode and url keys directly.
 */
export const STORE_SELECTING_KEYS: readonly string[] = [
  ...DB_PATH_KEYS,
  ...ENV_KEYS.modeKeys,
  ...ENV_KEYS.apiUrlKeys,
  ...ENV_KEYS.apiKeyKeys,
  ALLOW_CLOUD_IN_TESTS_ENV_KEY,
];

/**
 * The environment as it stood before the first un-restored `pinStoreToDb`.
 *
 * Captured once and held until `restoreStoreEnv` runs, so a second pin inside an
 * already-pinned window (a nested or re-entrant hook) cannot record the PINNED
 * values as the baseline and then "restore" the test's own scaffolding into the
 * ambient environment permanently.
 */
let saved: Map<string, string | undefined> | null = null;

/**
 * Clear every store-selecting name, then point BOTH db-path names at `path`.
 *
 * Both names are set rather than only the higher-precedence one so that a helper
 * which forwards a hand-picked subset of `process.env` into a child process still
 * carries a usable pin whichever name it happens to copy.
 *
 * Call from `beforeEach`. Pair with `restoreStoreEnv` in `afterEach`.
 */
export function pinStoreToDb(path: string): void {
  if (!path) throw new Error("pinStoreToDb requires a non-empty path");
  if (saved === null) {
    saved = new Map(STORE_SELECTING_KEYS.map((key) => [key, process.env[key]]));
  }
  for (const key of STORE_SELECTING_KEYS) delete process.env[key];
  for (const key of DB_PATH_KEYS) process.env[key] = path;
}

/**
 * Restore `process.env` exactly as `pinStoreToDb` found it — including names the
 * caller never mentioned, and including names that were UNSET, which are deleted
 * rather than assigned the string "undefined".
 *
 * Idempotent: safe to call from an `afterEach` that may run without a matching
 * pin, which happens when a `beforeEach` throws.
 */
export function restoreStoreEnv(): void {
  if (saved === null) return;
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved = null;
}

/**
 * Clear every store-selecting name WITHOUT restoring, for the rare case that
 * asserts what happens when no store is configured at all.
 *
 * Distinct from `restoreStoreEnv` on purpose. A test wanting "no db path" is not
 * asking for the ambient environment back — on a fleet shell that environment may
 * itself carry a db path, an api url and a key, so restoring is the opposite of
 * what such a case needs. Restoring would also discard the saved baseline and turn
 * the enclosing `afterEach`'s restore into a silent no-op.
 *
 * The baseline captured by `pinStoreToDb` is left intact, so `restoreStoreEnv` in
 * `afterEach` still puts the environment back exactly.
 */
export function clearStoreEnv(): void {
  for (const key of STORE_SELECTING_KEYS) delete process.env[key];
}

/**
 * The environment for a SPAWNED CLI, pinned to `dbPath`.
 *
 * The e2e suites in `src/cli` build a child environment as
 * `{ ...process.env, CONVERSATIONS_DB_PATH: TEST_DB }`. The spread copies the
 * ambient higher-precedence `HASNA_CONVERSATIONS_DB_PATH` into the child, where it
 * beats the override sitting right beside it — so the suite forwards the very
 * variable it is trying to override, and the child resolves the operator's store.
 * The parent-process hooks above cannot reach this: it is a fresh process built
 * from an object literal, not from the parent's live `process.env`.
 *
 * `extra` is merged AFTER the pin so a case can still add unrelated variables,
 * and is deliberately not allowed to reintroduce a store-selecting name silently.
 */
export function isolatedStoreChildEnv(
  dbPath: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  if (!dbPath) throw new Error("isolatedStoreChildEnv requires a non-empty dbPath");

  const collisions = Object.keys(extra).filter((key) => STORE_SELECTING_KEYS.includes(key));
  if (collisions.length > 0) {
    throw new Error(
      `isolatedStoreChildEnv: ${collisions.join(", ")} would override the pin. ` +
        `Pass the path as dbPath instead of smuggling a store-selecting name through extra.`,
    );
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !STORE_SELECTING_KEYS.includes(key)) env[key] = value;
  }
  for (const key of DB_PATH_KEYS) env[key] = dbPath;
  return { ...env, ...extra };
}
