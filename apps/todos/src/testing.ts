/**
 * Test-store isolation for consumers of `@hasna/todos`.
 *
 * ## Why this is a shipped export and not a private fixture
 *
 * Every machine on the fleet exports `HASNA_TODOS_API_URL` and `HASNA_TODOS_API_KEY`,
 * so any test that spawns the CLI with `{ ...process.env }`, or loads the SDK in-process,
 * writes into the **shared hosted store**. That is not hypothetical:
 *
 * - `hasnaxyz/iapp-takumi` test suites leaked **1,151** rows (`seed-task-<epoch>`,
 *   `Short ID resolution test`, …) between 2026-04-06 and 2026-06-21.
 * - `hasna/open-loops` `drain.test.ts` leaked **943** `Merge the release PR` rows
 *   between 2026-07-05 and 2026-07-15.
 *
 * Both were fixed locally at first. The problem with a local fix is that the list of
 * variables that route this client at a shared store is **this package's contract**,
 * not the consumer's: a consumer that copies today's list stops protecting anything the
 * day a new routing variable lands here, and the failure mode is silent — a green test
 * suite quietly writing to production. So the list lives here, next to the resolver that
 * reads it, with {@link ../testing.test.ts | a coverage test} that fails if the resolver
 * grows a variable this module does not scrub.
 *
 * ## Usage
 *
 * Spawning the CLI:
 * ```ts
 * spawnSync("todos", args, { env: localTodosTestEnv({ HASNA_TODOS_DB_PATH: tmpDb }) });
 * ```
 *
 * Loading the SDK in-process (call before the SDK is imported — e.g. a bun test preload):
 * ```ts
 * const restore = applyLocalTodosTestEnv({ HASNA_TODOS_DB_PATH: tmpDb });
 * ```
 */

/**
 * Every environment variable that can point this client at a store shared with other
 * people. Blanking all of them is what makes a test physically unable to reach the
 * hosted authority — `resolveTodosCliStorageMode` refuses `http` without a URL and key,
 * and there is no fallback path that reintroduces one.
 *
 * Keep this in sync with the resolver by adding to it, never by deleting from it:
 * `src/testing.test.ts` fails the build if the resolver reads a `*TODOS_*` routing
 * variable that is neither listed here nor named in `LOCAL_ONLY_TODOS_ENV_KEYS`.
 */
export const SHARED_TODOS_STORE_ENV_KEYS = [
  "HASNA_TODOS_API_URL",
  "HASNA_TODOS_API_KEY",
  "HASNA_TODOS_API_SIGNING_KEY",
  "TODOS_API_URL",
  "TODOS_API_KEY",
  // A live DSN in the ambient env flips the server's auth posture to "hosted" (local
  // /api/* and /mcp planes disabled) and points writes at a shared database, so a
  // local-intent test must not inherit one — nor an anonymous-plane opt-in.
  "HASNA_TODOS_DATABASE_URL",
  "TODOS_DATABASE_URL",
  "DATABASE_URL",
  "TODOS_ALLOW_ANONYMOUS",
] as const;

/**
 * Routing variables the resolver reads that select a store *kind* rather than a shared
 * destination. They are pinned rather than blanked, so they are exempt from the scrub
 * coverage assertion.
 */
export const LOCAL_ONLY_TODOS_ENV_KEYS = [
  "HASNA_TODOS_STORAGE_MODE",
  "TODOS_STORAGE_MODE",
  "HASNA_TODOS_DB_PATH",
  "TODOS_DB_PATH",
] as const;

export type SharedTodosStoreEnvKey = (typeof SHARED_TODOS_STORE_ENV_KEYS)[number];

export type TodosTestEnv = Record<string, string | undefined>;

/**
 * `process.env` with every shared-store pointer blanked and storage pinned to a local
 * SQLite file. Overrides are applied last, so a test that deliberately exercises the
 * hosted transport against a throwaway server can still opt back in explicitly.
 *
 * Blank string, not `delete`: `resolveTodosCliStorageMode` treats a blank
 * `*_STORAGE_MODE` as invalid and throws rather than silently falling back, so a
 * half-configured child fails loudly instead of guessing.
 */
export function localTodosTestEnv(overrides: TodosTestEnv = {}): TodosTestEnv {
  const env: TodosTestEnv = { ...process.env };
  for (const key of SHARED_TODOS_STORE_ENV_KEYS) env[key] = "";
  env["HASNA_TODOS_STORAGE_MODE"] = "local";
  env["TODOS_STORAGE_MODE"] = "local";
  return { ...env, ...overrides };
}

/**
 * Assign {@link localTodosTestEnv} onto the live `process.env`, for the in-process case
 * where the SDK reads the environment at import time and a child-process env dictionary
 * is therefore too late.
 *
 * Returns a restore function that puts every key this call touched back exactly as it
 * was, including keys that were previously unset.
 */
export function applyLocalTodosTestEnv(overrides: TodosTestEnv = {}): () => void {
  const next = localTodosTestEnv(overrides);
  const touched = [
    ...SHARED_TODOS_STORE_ENV_KEYS,
    "HASNA_TODOS_STORAGE_MODE",
    "TODOS_STORAGE_MODE",
    ...Object.keys(overrides),
  ];
  const previous = new Map<string, string | undefined>();
  for (const key of touched) {
    if (!previous.has(key)) previous.set(key, process.env[key]);
    const value = next[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/**
 * Throw if `env` could still reach a store shared with other people. Call it from a
 * consumer's own canary test so the guarantee is asserted where the risk lives, rather
 * than assumed from the fact that this helper was called somewhere.
 */
export function assertLocalTodosTestEnv(env: TodosTestEnv = process.env as TodosTestEnv): void {
  const leaking = SHARED_TODOS_STORE_ENV_KEYS.filter((key) => (env[key] ?? "").trim() !== "");
  if (leaking.length) {
    throw new Error(
      `SHARED_TODOS_STORE_REACHABLE: ${leaking.join(", ")} still set; this test can write to a shared todos store. ` +
        "Wrap the call in localTodosTestEnv()/applyLocalTodosTestEnv() from @hasna/todos/testing.",
    );
  }
}
