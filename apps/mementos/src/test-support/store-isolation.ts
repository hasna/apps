// ============================================================================
// Local-store isolation for subprocess test harnesses.
//
// WHY THIS EXISTS (a measured incident, not a hypothetical):
//
// mementos resolves its storage transport through the @hasna/contracts client
// chain — `isApiMode()` in src/db/api-mode.ts is true whenever the chain
// resolves a credential (env `HASNA_MEMENTOS_API_KEY` or its legacy alias, the
// macOS Keychain item `hasna.credentials.mementos.api-key`, or
// `~/.hasna/mementos/config/credentials`). On a fleet machine the operator's
// shell exports HASNA_MEMENTOS_API_URL + HASNA_MEMENTOS_API_KEY, and the tmux
// server process carries them, so EVERY pane and every child process inherits
// them.
//
// A harness that spawns the CLI with `{ ...process.env, MEMENTOS_DB_PATH: tmp }`
// therefore runs in API mode against the SHARED PRODUCTION store — and since
// the chain can also pull a credential from the Keychain or a credentials
// file, an env dictionary alone can no longer guarantee isolation. The redirect
// looks like it worked and does nothing:
//
//   - `MEMENTOS_DB_PATH` is consulted at src/db/api-mode.ts only when the
//     chain is not engaged first; and
//   - the memory read/write paths route to HTTP in src/db/memories.ts before
//     `getDatabase()` is consulted at all.
//
// The observable signature is that the scratch SQLite file is NEVER CREATED
// while the CLI reports success, and the rows land in the shared cross-agent
// memory layer, indistinguishable from real memories. Because mementos is a
// source of truth other agents read, that pollution silently corrupts the
// inputs to future work.
//
// WHY BLANKING ALONE IS NOT THE FIX: a hand-written list of vars to blank is a
// copy of a list that lives somewhere else. It stops covering the resolver the
// moment a new selector is added, and it fails silently — the harness keeps
// passing while writing to production. So this module does three things instead:
//
//   1. Builds the child env from the key lists the RESOLVER ITSELF reads
//      (exported from @hasna/contracts/client via src/db/api-mode.ts and
//      src/lib/local-opt-in.ts), so the list cannot drift out of sync with the
//      code that consults it.
//   2. Defaults the EXPLICIT local opt-in (`HASNA_MEMENTOS_LOCAL=1` /
//      `MEMENTOS_LOCAL=1`) and pins the Keychain account (`HASNA_STATION`) to a
//      name no item can exist under, so — since the local opt-in is answered
//      BEFORE the resolver runs — no Keychain item and no credential file is
//      ever read by a local-intent fixture.
//   3. ASSERTS, by asking the child process what it resolved, that the backend
//      really is local — and throws loudly if not. A selector nobody thought of
//      then produces a RED SUITE instead of a production write.
//
// Point 3 is the load-bearing half. "I set the variable" is not evidence of
// isolation; "the child says local-sqlite and the scratch file now exists with
// my row in it" is. A prior incident in this workspace destroyed 139 live
// artifacts precisely because a redirect was believed rather than verified in
// the process that performed the write.
// ============================================================================

import { existsSync } from "node:fs";
import {
  API_KEY_ENV_KEYS,
  API_URL_ENV_KEYS,
  DATABASE_URL_ENV_KEYS,
  DB_PATH_ENV_KEYS as API_MODE_DB_PATH_ENV_KEYS,
} from "../db/api-mode.js";
import type { StoreBackendReport } from "../db/store-backend.js";
import {
  MEMENTOS_DB_PATH_ENV_KEYS,
  MEMENTOS_LOCAL_OPT_IN_ENV_KEYS,
  REMOVED_MEMENTOS_MODE_ENV_KEYS as REMOVED_STORE_ENV_KEYS_SRC,
  mementosAuthorityEnvKeys,
} from "../lib/local-opt-in.js";
import { MEMENTOS_STORAGE_ENV, MEMENTOS_STORAGE_FALLBACK_ENV } from "../storage.js";

/**
 * Every env var that can point this client at a store shared with other
 * people, derived from the resolver's own exported key lists rather than
 * retyped, so adding a selector in @hasna/contracts (or a deliberate tier
 * here) automatically widens what the harnesses neutralize.
 *
 * Blanking them is NO LONGER SUFFICIENT ON ITS OWN, and that is the whole
 * reason the local opt-in below is defaulted on. Since the credential chain
 * moved into @hasna/contracts (hasna/apps#1720) a key can also arrive from the
 * machine's login Keychain or from `~/.hasna/mementos/config/credentials`,
 * neither of which an env dictionary can blank. What makes a fixture
 * physically unable to reach the hosted authority is therefore the pair: these
 * variables deleted, AND the local opt-in, which the resolver is never
 * consulted past — so no Keychain item and no credential file is ever read.
 *
 * The legacy unprefixed `MEMENTOS_*` spellings are the resolver's silent alias
 * fallback for one release; they are scrubbed here for the same reason the
 * canonical names are.
 */
export const STORE_SELECTOR_ENV_KEYS: readonly string[] = Array.from(
  new Set<string>([
    ...API_URL_ENV_KEYS,
    ...API_KEY_ENV_KEYS,
    ...mementosAuthorityEnvKeys(),
    ...DATABASE_URL_ENV_KEYS,
    MEMENTOS_STORAGE_ENV.databaseUrl,
    MEMENTOS_STORAGE_FALLBACK_ENV.databaseUrl,
    "MEMENTOS_DATABASE_PASSWORD",
  ]),
);

/**
 * Routing variables that select a store *kind* rather than a shared
 * destination; LOCAL_ONLY entries are pinned rather than scrubbed and exempt
 * from the coverage assertion:
 *
 *   - `HASNA_MEMENTOS_LOCAL` / `MEMENTOS_LOCAL` — the explicit unhosted
 *     opt-in; local-intent envs default it on, remote-intent envs may set it
 *     to "" to exercise the fail-closed arm. It is answered BEFORE the
 *     resolver runs, so a scrubbed test environment physically cannot read the
 *     Keychain or a credentials file.
 *   - the `*_DB_PATH` keys are the precedence-1 explicit local SQLite file.
 *   - `HASNA_STATION` pins WHICH Keychain account the resolver asks for — a
 *     name no item can exist under, so the Keychain tier is reliably EMPTY on
 *     a developer Mac and on CI alike.
 */
export const LOCAL_ONLY_STORE_ENV_KEYS: readonly string[] = [
  ...MEMENTOS_LOCAL_OPT_IN_ENV_KEYS,
  ...MEMENTOS_DB_PATH_ENV_KEYS,
  ...API_MODE_DB_PATH_ENV_KEYS,
  "HASNA_STATION",
];

/**
 * The retired storage-mode variables, from the resolver's own list. The
 * resolver never reads them — they are inert — but a test env DELETES them so
 * a test can never depend on a stale fragment from the host environment. They
 * are listed here so scrub coverage treats them as handled.
 */
export const REMOVED_STORE_ENV_KEYS: readonly string[] = [...REMOVED_STORE_ENV_KEYS_SRC];

/**
 * The Keychain account a test environment pins, chosen so that no item can
 * exist under it (see LOCAL_ONLY_STORE_ENV_KEYS).
 */
export const MEMENTOS_TEST_KEYCHAIN_ACCOUNT = "mementos-test-fixture-no-such-station";

/** The local-intent defaults: the explicit opt-in (both spellings) and the empty Keychain account. */
const LOCAL_OPT_IN_DEFAULT = {
  HASNA_MEMENTOS_LOCAL: "1",
  MEMENTOS_LOCAL: "1",
  HASNA_STATION: MEMENTOS_TEST_KEYCHAIN_ACCOUNT,
} as const;

/** The two env vars that point the CLI at a specific SQLite file. */
export const DB_PATH_ENV_KEYS: readonly string[] = MEMENTOS_DB_PATH_ENV_KEYS;

export interface IsolatedStoreEnvOptions {
  /**
   * Extra vars to set in the child, applied last. Harnesses use this to blank
   * LLM provider keys so no test can make a billed call. Kept opt-in because
   * blanking them changes what commands like `doctor` report.
   */
  extra?: Record<string, string>;
}

/**
 * Build a child-process env that is pinned to a local SQLite file at `dbPath`.
 *
 * Selectors are DELETED rather than set to `""` — the resolver treats empty as
 * unset either way, but deleting leaves no ambiguity for a human reading the
 * child's environment during a postmortem.
 *
 * Building the env is necessary but NOT sufficient: pair it with
 * {@link assertLocalStoreBackend} before the suite performs any write.
 */
export function isolatedStoreEnv(
  dbPath: string,
  options: IsolatedStoreEnvOptions = {},
): Record<string, string> {
  const env = localIntentEnv();
  for (const key of DB_PATH_ENV_KEYS) env[key] = dbPath;
  for (const [key, value] of Object.entries(options.extra ?? {})) env[key] = value;
  return env;
}

/** The ambient env scrubbed of storage selectors, with the local opt-in defaulted on. */
function localIntentEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of STORE_SELECTOR_ENV_KEYS) delete env[key];
  for (const key of REMOVED_STORE_ENV_KEYS) delete env[key];
  return { ...env, ...LOCAL_OPT_IN_DEFAULT };
}

export interface StubApiEnvOptions {
  /** Stub bearer token. Never a real credential — the stub does not check it. */
  apiKey?: string;
}

/**
 * Build a child env for a suite that *deliberately* runs in API mode against a
 * local stub server.
 *
 * Such a suite still must not inherit the operator's production API URL or key:
 * it overrides the URL, but if that override were ever empty or renamed, the
 * ambient value would take over and the suite would drive the real store. So
 * start from a fully de-selected env and add back only the stub's own values.
 *
 * @param baseUrl the stub's origin, e.g. `http://127.0.0.1:<port>/<mode>`
 */
export function stubApiEnv(baseUrl: string, options: StubApiEnvOptions = {}): Record<string, string> {
  const env = envWithoutStoreSelectors();
  // An inherited DB_PATH would outrank the stub credentials and send the suite
  // to a SQLite file instead of the stub server (precedence 1), so drop it.
  for (const key of DB_PATH_ENV_KEYS) delete env[key];
  // The flag opt-in must not outrank a configured environment (authority
  // intent wins), but pinning it off keeps the fixture unambiguous.
  for (const key of MEMENTOS_LOCAL_OPT_IN_ENV_KEYS) delete env[key];
  env[API_URL_ENV_KEYS[0]] = baseUrl;
  env[API_KEY_ENV_KEYS[0]] = options.apiKey ?? "stub-key-not-a-secret";
  return env;
}

/**
 * Build a child env that DOES resolve to the cloud API — the negative case the
 * isolation guards are proved against.
 *
 * This exists because of the 2026-08-03 precedence-1 fix. Before it, a cloud
 * case could be built by taking any env and adding an API url+key, and several
 * tests did exactly that on top of {@link isolatedStoreEnv}. An explicit
 * `MEMENTOS_DB_PATH` now DEFEATS the API selectors (see getApiConfig in
 * src/db/api-mode.ts), so that recipe silently produces a LOCAL backend — which
 * would leave the isolation guards' positive controls unable to observe the bad
 * state they exist to detect, and `assertLocalStoreBackend`'s own self-test
 * unable to fail. Both would still be green.
 *
 * So the DB_PATH keys are removed here explicitly, and that removal is the
 * load-bearing line rather than an afterthought: it is the only way to reach the
 * cloud backend now. They are NOT in STORE_SELECTOR_ENV_KEYS because that set
 * means "moves the store OFF local SQLite", and DB_PATH does the opposite.
 *
 * @param baseUrl  point this at a closed loopback port, never a real endpoint
 * @param apiKey   never a real credential
 */
export function cloudSelectingEnv(
  baseUrl: string,
  apiKey = "not-a-real-key",
): Record<string, string> {
  const env = envWithoutStoreSelectors();
  for (const key of DB_PATH_ENV_KEYS) delete env[key];
  for (const key of MEMENTOS_LOCAL_OPT_IN_ENV_KEYS) delete env[key];
  env[API_URL_ENV_KEYS[0]] = baseUrl;
  env[API_KEY_ENV_KEYS[0]] = apiKey;
  return env;
}

/** The ambient env with every store selector removed. The shared starting point. */
function envWithoutStoreSelectors(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of STORE_SELECTOR_ENV_KEYS) delete env[key];
  for (const key of REMOVED_STORE_ENV_KEYS) delete env[key];
  return env;
}

/**
 * The ambient env with the local-intent defaults applied ON TOP of the scrub
 * (used by the `bun test` preload and by in-process suites that must be able
 * to reach the hosted arm deliberately).
 */
export function localMementosTestEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env = envWithoutStoreSelectors();
  for (const key of LOCAL_ONLY_STORE_ENV_KEYS) delete env[key];
  const result: Record<string, string> = { ...env, ...LOCAL_OPT_IN_DEFAULT, ...extra };
  return result;
}

/** LLM provider keys most harnesses blank so no test can make a billed call. */
export const LLM_PROVIDER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "CEREBRAS_API_KEY",
  "XAI_API_KEY",
] as const;

/** `{ ANTHROPIC_API_KEY: "", ... }` — pass as `extra` to blank LLM providers. */
export function blankLlmProviderEnv(): Record<string, string> {
  return Object.fromEntries(LLM_PROVIDER_ENV_KEYS.map((key) => [key, ""]));
}

/**
 * Ask the child process which store it resolved, and THROW if it is not local.
 *
 * This is the guard that turns an unknown future selector into a red suite
 * rather than a silent production write. It asks the CLI itself
 * (`storage mode --json`) rather than recomputing the answer here, so the
 * verdict comes from the same resolution code the writes will use — and it runs
 * as a real child process with the real env, so an env var that fails to cross
 * the process boundary is caught rather than assumed away.
 *
 * `storage mode` opens no database and makes no network request, so this is
 * safe to call even when the ambient env points at production.
 *
 * @param cliPath  path to src/cli/index.tsx
 * @param env      the env produced by {@link isolatedStoreEnv}
 * @param expectedDbPath  when given, also assert the child resolved this path
 */
export async function assertLocalStoreBackend(
  cliPath: string,
  env: Record<string, string>,
  expectedDbPath?: string,
): Promise<StoreBackendReport> {
  const proc = Bun.spawn(["bun", "run", cliPath, "storage", "mode", "--json"], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(
      "store-isolation: REFUSING TO RUN — could not determine the child process's store backend " +
        `(\`storage mode --json\` exited ${exitCode}). Treating an unknown backend as unsafe.\n` +
        `stderr: ${stderr.trim().slice(0, 800)}`,
    );
  }

  let report: StoreBackendReport;
  try {
    report = JSON.parse(stdout) as StoreBackendReport;
  } catch {
    throw new Error(
      "store-isolation: REFUSING TO RUN — `storage mode --json` did not return parseable JSON, " +
        `so the backend is unknown. Treating an unknown backend as unsafe.\nstdout: ${stdout.slice(0, 800)}`,
    );
  }

  if (report.api_mode || report.backend !== "local-sqlite") {
    throw new Error(
      "store-isolation: REFUSING TO RUN — this suite drives the real CLI, and the child process did " +
        "NOT resolve to the local SQLite store. Running it would write test fixtures into the SHARED " +
        "PRODUCTION store, where they are indistinguishable from real memories.\n" +
        `  backend        : ${report.backend}\n` +
        `  api_mode       : ${report.api_mode}\n` +
        `  selected_by    : ${report.selected_by}\n` +
        `  server_backend : ${report.server_backend}\n` +
        `  db_path        : ${report.db_path}\n` +
        "A store-selecting env var reached the child that STORE_SELECTOR_ENV_KEYS does not cover, or the " +
        "resolver pulled a credential from the Keychain or a credentials file. " +
        "Add it to src/test-support/store-isolation.ts (and export it from the resolver that reads it).",
    );
  }

  if (expectedDbPath && report.db_path !== expectedDbPath) {
    throw new Error(
      "store-isolation: REFUSING TO RUN — the child resolved a local store at an UNEXPECTED path, so " +
        "the scratch redirect did not survive the process boundary.\n" +
        `  expected: ${expectedDbPath}\n  actual  : ${report.db_path}`,
    );
  }

  return report;
}

/**
 * Assert the scratch SQLite file now exists on disk.
 *
 * This is the second half of the proof and it is not redundant with
 * {@link assertLocalStoreBackend}: the mode report says where the child INTENDS
 * to write, whereas this says a write actually landed there. The reported
 * incident's signature was precisely a correct-looking path with no file ever
 * created, so call this AFTER the suite's first write.
 */
export function assertScratchDbCreated(dbPath: string, context = "after the first write"): void {
  if (!existsSync(dbPath)) {
    throw new Error(
      `store-isolation: the scratch database ${dbPath} does not exist ${context}. The CLI reported ` +
        "success but wrote nothing here, which is the signature of a write that went to a different " +
        "store (see src/test-support/store-isolation.ts).",
    );
  }
}