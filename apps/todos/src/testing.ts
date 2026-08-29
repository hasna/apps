/**
 * Test-store isolation for consumers of `@hasna/todos`.
 *
 * ## Why this is a shipped export and not a private fixture
 *
 * Every machine on the fleet exports `HASNA_TODOS_API_URL` and `HASNA_TODOS_API_KEY`,
 * so any test that spawns the CLI with `{ ...process.env }`, or loads the SDK in-process,
 * writes into the **shared hosted store**. That is not hypothetical:
 *
 * - a consumer test suite leaked **1,151** rows (`seed-task-<epoch>`,
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

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Every environment variable that can point this client at a store shared with other
 * people. Blanking all of them is what makes a test physically unable to reach the
 * hosted authority — `resolveTodosCliTransport` refuses `http` without a URL and key,
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
  "HASNA_TODOS_DB_PATH",
  "TODOS_DB_PATH",
] as const;

/**
 * The retired storage-mode variables. The resolver never reads them — they are
 * inert — but a test env DELETES them so a test can never depend on a stale
 * fragment from the host environment. They are listed here so the
 * scrub-coverage assertion treats them as handled.
 */
export const REMOVED_TODOS_ENV_KEYS = [
  "HASNA_TODOS_STORAGE_MODE",
  "HASNA_TODOS_MODE",
  "TODOS_STORAGE_MODE",
  "TODOS_MODE",
] as const;

export type SharedTodosStoreEnvKey = (typeof SHARED_TODOS_STORE_ENV_KEYS)[number];

export type TodosTestEnv = Record<string, string | undefined>;

/**
 * Canonicalise a path for comparison: absolute, dot-segments collapsed, and
 * symlinks resolved where the path exists. `realpathSync` throws for a path that
 * does not exist yet — a legitimate case for a fixture home — so the lexical
 * form is the fallback rather than an error.
 */
function canonicalisePath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/**
 * Every canonical spelling of THIS machine's real home directory. Both sources
 * are consulted because they can disagree: `homedir()` falls back to the passwd
 * entry when `HOME` is unset, and a caller may have cleared `HOME` before
 * reaching here.
 */
function machineHomeCandidates(): string[] {
  const candidates: string[] = [];
  const fromEnv = process.env.HOME;
  if (fromEnv && fromEnv.trim() !== "") candidates.push(fromEnv);
  try {
    const fromPasswd = homedir();
    if (fromPasswd && fromPasswd.trim() !== "") candidates.push(fromPasswd);
  } catch {
    // homedir() throws when the passwd entry is unreadable; HOME alone is then
    // the whole guard, which is still better than no guard.
  }
  return candidates.map(canonicalisePath);
}

/**
 * Deliver an explicitly supplied API key through the primary DISK tier
 * (`$HOME/.hasna/fleet-env/todos.env`) instead of the legacy cloud tier, and
 * return the env unchanged. The contracts client treats `~/.hasna/cloud` as a
 * NOISY deprecated fallback and prints a DEPRECATED notice to stderr whenever
 * the key arrives from there; a CLI subprocess test that asserts empty (or
 * exact) stderr then fails even though authentication succeeded. fleet-env is
 * the primary tier (re-read per call) and is the path the deprecation notice
 * itself recommends.
 *
 * ## This function writes a real file, so it guards itself
 *
 * It THROWS when `env.HOME` resolves to this machine's own home directory,
 * because the write would replace the operator's configured todos credential
 * with a fixture value. That is not hypothetical: on 2026-08-21 a fixture whose
 * env inherited `process.env.HOME` destroyed `~/.hasna/cloud/todos.env` on
 * station01 and cost a seat nine hours without a task system.
 *
 * The guard lives HERE, in the function, and not only in {@link localTodosTestEnv}.
 * This symbol is exported, so `deliverTodosApiKeyViaDisk(localTodosTestEnv({ ... }))`
 * is a call any consumer can write, and it hands this function an env whose HOME
 * was copied from `process.env`. A check on one route into a dangerous function
 * leaves the function dangerous.
 *
 * Comparison is by EXACT canonical equality with the machine home, never
 * "somewhere underneath it": the artefact at risk is precisely
 * `$HOME/.hasna/fleet-env/todos.env`, and an under-home rule would reject
 * fixtures that legitimately create a scratch root inside the home tree.
 *
 * A missing HOME or a missing key stays a silent no-op — nothing is written, so
 * nothing is at risk. Only the machine-home case is loud, because there the
 * caller is about to lose data and needs to be told rather than left believing
 * the credential was delivered.
 */
export function deliverTodosApiKeyViaDisk(env: TodosTestEnv): TodosTestEnv {
  const home = env.HOME;
  const apiKey = env.HASNA_TODOS_API_KEY;
  if (!home || !apiKey) return env;

  const target = canonicalisePath(home);
  if (machineHomeCandidates().includes(target)) {
    throw new Error(
      `TODOS_FIXTURE_HOME_IS_MACHINE_HOME: refusing to write ${join(target, ".hasna", "fleet-env", "todos.env")} — ` +
        "HOME resolves to this machine's real home directory, so this write would replace the machine's " +
        "configured todos credential with a fixture value. Pass a throwaway home, e.g. " +
        'HOME: mkdtempSync(join(tmpdir(), "todos-fixture-")).',
    );
  }

  const dir = join(home, ".hasna", "fleet-env");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "todos.env"), `HASNA_TODOS_API_KEY=${apiKey}\n`);
  return env;
}

/**
 * `process.env` with every shared-store pointer blanked and the retired
 * storage-mode variables deleted, so the transport resolves to a local SQLite
 * file. Overrides are applied last, so a test that deliberately exercises the
 * hosted transport against a throwaway server can still opt back in explicitly.
 *
 * Blank string, not `delete`, for the shared-store pointers: a blanked URL/key
 * is treated as absent, and there is no partial-config fallback. The retired
 * `*_STORAGE_MODE` variables are DELETED, not blanked, so a test never
 * inherits a stale fragment from the host environment.
 */
export function localTodosTestEnv(overrides: TodosTestEnv = {}): TodosTestEnv {
  const env: TodosTestEnv = { ...process.env };
  for (const key of SHARED_TODOS_STORE_ENV_KEYS) env[key] = "";
  for (const key of REMOVED_TODOS_ENV_KEYS) delete env[key];
  const result = { ...env, ...overrides };
  // Disk delivery happens ONLY when the caller DELIBERATELY supplied HOME.
  // An inherited machine home must never receive a fixture credential: the
  // ordinary suite's in-process tests call this helper without a HOME
  // override, and writing through process.env.HOME would replace the
  // machine's configured credential file (review P1, hasna/apps#719).
  if (overrides.HOME && result.HASNA_TODOS_API_KEY) {
    deliverTodosApiKeyViaDisk(result);
  }
  return result;
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
    ...REMOVED_TODOS_ENV_KEYS,
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
