/**
 * Test-store isolation for consumers of `@hasna/todos`.
 *
 * ## Why this is a shipped export and not a private fixture
 *
 * Every machine on the fleet can resolve a Todos credential — from `HASNA_TODOS_API_KEY`,
 * from the macOS Keychain item `hasna.credentials.todos.api-key`, or from
 * `~/.hasna/todos/config/credentials` — so any test that spawns the CLI with
 * `{ ...process.env }`, or loads the SDK in-process, writes into the **shared hosted
 * store**. That is not hypothetical:
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

import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * The single disk credential tier the @hasna/contracts chain reads, relative to
 * HOME: `~/.hasna/todos/config/credentials`. Exported so a consumer's fixture
 * can name the exact file rather than rebuilding the path from a doc comment.
 */
export const TODOS_CREDENTIALS_FILE_SEGMENTS = [".hasna", "todos", "config", "credentials"] as const;

/**
 * Every environment variable that can point this client at a store shared with other
 * people.
 *
 * Blanking them is NO LONGER SUFFICIENT ON ITS OWN, and that is the whole reason the
 * local opt-in below is defaulted on. Since the credential chain moved into
 * @hasna/contracts (hasna/apps#1720) a key can also arrive from the machine's login
 * Keychain or from `~/.hasna/todos/config/credentials`, neither of which an env
 * dictionary can blank. What makes a test physically unable to reach the hosted
 * authority is therefore the pair: these variables blanked, AND `HASNA_TODOS_LOCAL=1`,
 * which `resolveTodosCliTransport` answers BEFORE it consults the resolver — so no
 * Keychain item and no credential file is ever read.
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
  // The @hasna/contracts deliberate tiers, which outrank everything below them.
  // An inherited HASNA_PROFILE is the nastiest of the three: it names WHICH
  // identity to use, is never resolved around, and so turns an otherwise local
  // fixture into a hard failure or — worse — a different principal's store.
  "HASNA_TODOS_API_KEY_OVERRIDE",
  "HASNA_TODOS_API_KEY_REF",
  "HASNA_PROFILE",
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
 * coverage assertion. The local opt-in (`HASNA_TODOS_LOCAL=1`, alias `TODOS_LOCAL=1`)
 * is the ONLY route to the on-box SQLite client mode since the 2026-09-04 fail-closed
 * ruling (hasna/apps#1613); local-intent test envs default it on, remote-intent envs
 * may override it back to "" to exercise the fail-closed arm.
 */
export const LOCAL_ONLY_TODOS_ENV_KEYS = [
  "HASNA_TODOS_LOCAL",
  "TODOS_LOCAL",
  "HASNA_TODOS_DB_PATH",
  "TODOS_DB_PATH",
  // Pins WHICH Keychain account the resolver asks for — see
  // TODOS_TEST_KEYCHAIN_ACCOUNT. Pinned, never blanked: blanking it would let
  // the account fall back to the machine's own short hostname, which is exactly
  // the item a test must not reach.
  "HASNA_STATION",
] as const;

/**
 * The Keychain account a test environment pins, chosen so that no item can
 * exist under it.
 *
 * The macOS Keychain tier of the @hasna/contracts chain is AMBIENT: it runs for
 * the live `process.env`, which every spawned CLI has. An env dictionary cannot
 * blank a login-keychain item, so without this pin a developer's own
 * `hasna.credentials.todos.api-key` — and the `api-url` item beside it — would
 * be resolved by the package's own test suite: the fixture's throwaway
 * authority would collide with the real one ("select different service
 * authorities"), and worse, a fixture server would receive the operator's live
 * fleet credential. `HASNA_STATION` decides the account the tier looks under,
 * so pinning it to a name no item uses makes the tier reliably EMPTY (the
 * `security` tool answers item-not-found, which is an absent tier rather than a
 * failure) on a developer Mac and on CI alike.
 */
export const TODOS_TEST_KEYCHAIN_ACCOUNT = "todos-test-fixture-no-such-station";

/** The local-intent defaults: the explicit opt-in (both spellings) and the empty Keychain account. */
const LOCAL_OPT_IN_DEFAULT = {
  HASNA_TODOS_LOCAL: "1",
  TODOS_LOCAL: "1",
  HASNA_STATION: TODOS_TEST_KEYCHAIN_ACCOUNT,
} as const;

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
 * Deliver an explicitly supplied API key through the DISK tier — the one the
 * @hasna/contracts chain actually reads, `$HOME/.hasna/todos/config/credentials`
 * — and return the env unchanged.
 *
 * The retired locations are not written and are not inputs anywhere:
 * `~/.hasna/fleet-env/`, `~/.hasna/cloud/` and `~/.config/hasna/` were removed
 * from the resolver by the 2026-09-04 home-layout ruling, so a fixture that
 * still wrote one of them would deliver a credential to a file nothing reads
 * and fail as "no key" long after the write appeared to succeed.
 *
 * The file is created 0600 because the resolver REFUSES a credential file that
 * is not owner-only 0400/0600 — a group- or world-readable file is treated as
 * unsafe and throws rather than being read, so a laxer mode here would turn
 * every fixture using it red.
 *
 * ## This function writes a real file, so it guards itself
 *
 * It THROWS when `env.HOME` resolves to this machine's own home directory,
 * because the write would replace the operator's configured todos credential
 * with a fixture value. That is not hypothetical: on 2026-08-21 a fixture whose
 * env inherited `process.env.HOME` destroyed station01's own todos credential
 * file and cost a seat nine hours without a task system.
 *
 * The guard lives HERE, in the function, and not only in {@link localTodosTestEnv}.
 * This symbol is exported, so `deliverTodosApiKeyViaDisk(localTodosTestEnv({ ... }))`
 * is a call any consumer can write, and it hands this function an env whose HOME
 * was copied from `process.env`. A check on one route into a dangerous function
 * leaves the function dangerous.
 *
 * Comparison is by EXACT canonical equality with the machine home, never
 * "somewhere underneath it": the artefact at risk is precisely
 * `$HOME/.hasna/todos/config/credentials`, and an under-home rule would reject
 * fixtures that legitimately create a scratch root inside the home tree.
 *
 * A missing HOME or a missing key stays a silent no-op — nothing is written, so
 * nothing is at risk. Only the machine-home case is loud, because there the
 * caller is about to lose data and needs to be told rather than left believing
 * the credential was delivered.
 *
 * ## It also pins the Keychain account, and that is not a side errand
 *
 * The Keychain tier sits ABOVE disk. On a developer Mac with a real
 * `hasna.credentials.todos.api-key` item, delivering a fixture key to disk and
 * then spawning the CLI resolves the OPERATOR'S LIVE KEY instead — the fixture
 * server receives a production credential, and the run can even block on a
 * keychain prompt. "Deliver this key through the disk tier" is therefore only
 * true if the tier above it is empty, so this stamps `HASNA_STATION` with
 * {@link TODOS_TEST_KEYCHAIN_ACCOUNT} unless the caller set it themselves.
 */
export function deliverTodosApiKeyViaDisk(env: TodosTestEnv): TodosTestEnv {
  const home = env.HOME;
  const apiKey = env.HASNA_TODOS_API_KEY;
  if (!home || !apiKey) return env;

  const target = canonicalisePath(home);
  if (machineHomeCandidates().includes(target)) {
    throw new Error(
      `TODOS_FIXTURE_HOME_IS_MACHINE_HOME: refusing to write ${join(target, ...TODOS_CREDENTIALS_FILE_SEGMENTS)} — ` +
        "HOME resolves to this machine's real home directory, so this write would replace the machine's " +
        "configured todos credential with a fixture value. Pass a throwaway home, e.g. " +
        'HOME: mkdtempSync(join(tmpdir(), "todos-fixture-")).',
    );
  }

  // Empty the tier above disk before writing to disk (see the doc comment).
  if ((env.HASNA_STATION ?? "").trim() === "") env.HASNA_STATION = TODOS_TEST_KEYCHAIN_ACCOUNT;

  const file = join(home, ...TODOS_CREDENTIALS_FILE_SEGMENTS);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `HASNA_TODOS_API_KEY=${apiKey}\n`, { mode: 0o600 });
  // `mode` on writeFileSync only applies at CREATE time, so a fixture home that
  // is reused across cases would keep whatever mode the first write left. The
  // resolver refuses anything but 0400/0600, so set it unconditionally.
  chmodSync(file, 0o600);
  return env;
}

/**
 * `process.env` with every shared-store pointer blanked, the retired
 * storage-mode variables deleted, and the explicit local opt-in
 * (`HASNA_TODOS_LOCAL=1` / `TODOS_LOCAL=1`) DEFAULTED ON, so the transport
 * resolves to the on-box SQLite file. Local SQLite is no longer a default —
 * the resolver fails closed without the opt-in (hasna/apps#1613) — so a
 * local-intent env must carry it; a test that deliberately exercises the
 * hosted transport against a throwaway server, or the fail-closed arm, can
 * override it (opt-in `""`, or the API pair) because overrides are applied
 * last.
 *
 * DELETED, never blanked. Blanking used to be the spelling for "absent", and it
 * stopped being safe when the chain moved into @hasna/contracts: a DECLARED but
 * blank `HASNA_TODOS_API_URL`, `HASNA_TODOS_API_KEY` or `HASNA_PROFILE` is a
 * misconfiguration the resolver refuses LOUDLY rather than treating as unset —
 * deliberately, because a blank credential that silently fell through to
 * another tier would authenticate as a different principal. So a blank is
 * normalised to an absent key here, including one a caller passes in
 * `overrides` (`{ HASNA_TODOS_API_URL: "" }` still spells "not configured").
 */
export function localTodosTestEnv(overrides: TodosTestEnv = {}): TodosTestEnv {
  const env: TodosTestEnv = { ...process.env };
  for (const key of SHARED_TODOS_STORE_ENV_KEYS) delete env[key];
  for (const key of REMOVED_TODOS_ENV_KEYS) delete env[key];
  const result: TodosTestEnv = { ...env, ...LOCAL_OPT_IN_DEFAULT, ...overrides };
  for (const key of SHARED_TODOS_STORE_ENV_KEYS) {
    if ((result[key] ?? "").trim() === "") delete result[key];
  }
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
    ...LOCAL_ONLY_TODOS_ENV_KEYS,
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
