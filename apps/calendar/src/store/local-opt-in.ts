/**
 * Calendar routing preamble — the shared resolver's env inputs, and the ONE
 * deliberate local surface (the legacy `db-migrate` command).
 *
 * CALENDAR HAS NO LOCAL CLIENT MODE. Every hosted surface — CLI commands, MCP
 * tools, `getStore()` and `./sdk` — speaks only to the authenticated `/v1`
 * authority that the fleet resolver in `@hasna/contracts/client` decides
 * (owner ruling 2026-09-04, hasna/apps#1720). There is no on-box store to fall
 * back to, so there is no `HASNA_CALENDAR_LOCAL` opt-in: hosted with no
 * credential FAILS LOUD (non-zero exit, no SQLite, no local-fallback event).
 * The single local surface left is the explicit legacy one-time migration
 * command `calendar db-migrate`, which is LOCAL-ONLY by construction, refuses
 * to run on a machine with any hosted intent, and says "local" on stderr.
 *
 * WHY THIS MODULE IS A LEAF. The CLI, the MCP server and the SDK all have to
 * answer "is this environment headed for the hosted authority?" identically,
 * and the SDK must be able to ask without pulling the CLI's command world into
 * its bundle. The only import is env-key derivation from @hasna/contracts, so
 * the NAMES looked for are the resolver's own rather than a copy that can fall
 * behind.
 *
 * THE NORMALISATION RULE (#1788). A declared-but-blank authority or credential
 * variable is this package's historical spelling for "not configured" — the
 * test preload scrubs by deleting, other fixtures blank — while the resolver
 * treats a declared-but-blank value as a LOUD refusal. Removing the blank
 * forces handing the resolver a COPY of the env, and the resolver gates its
 * ambient tiers (the macOS Keychain) on OBJECT IDENTITY (`env === process.env`,
 * or the registry symbol its own snapshot carries). A copy is, by that test, a
 * caller-built world — the hermetic seam — so the Keychain tier silently turns
 * itself off unless the gate travels with the copy as `keychain.enabled`,
 * decided HERE on the original env before normalising.
 *
 * RETIRED, AND NEVER INPUTS AGAIN: the `*_MODE` / `*_STORAGE_MODE` /
 * `*_BACKEND` / `*_LOCAL` / `*_SELF_HOSTED` / `*_CLOUD` placement selectors
 * (failing loudly on them is a ratchet, see `assertNoRetiredCalendarSelector`
 * in http-storage.ts), and every retired location — the old `~/.hasna`
 * fleet-env and cloud folders and `~/.config/hasna` (with `$XDG_CONFIG_HOME`)
 * — which nothing in this package reads or writes. `~/.calendar/config.json`
 * was never a credential store and remains unused.
 */
import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "@hasna/contracts/client";

export type CalendarEnv = Record<string, string | undefined>;

/** The one deliberate local surface: the explicit legacy migration command. */
export const CALENDAR_DB_MIGRATE_COMMAND = "db-migrate" as const;

/**
 * The @hasna/contracts Keychain tier controls as this package spells them.
 *
 * The spelling lives here, not as a re-export of the contracts types, because
 * `@hasna/contracts` is a BUILD-TIME dependency of this package (inlined into
 * every `bun build --target bun` bundle, kept out of `dependencies`): the
 * declarations `tsc` emits keep every import the source wrote, so a published
 * `.d.ts` that referenced the contracts types would break TypeScript consumers
 * who install only the runtime deps (hasna/apps#1782). These interfaces are
 * structurally identical to the contracts declarations and are checked against
 * them at compile time by `credential-resolution.test.ts`.
 */
export interface CalendarKeychainCommandResult {
  /** Exit status; null when the tool could not be started or was killed. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `/usr/bin/security` with the given argv — no shell. Injected by tests. */
export type CalendarKeychainCommandRunner = (argv: readonly string[]) => CalendarKeychainCommandResult;

/** Tier-3 controls, mirrored from @hasna/contracts `KeychainTierOptions`. */
export interface CalendarKeychainTierOptions {
  enabled?: boolean;
  platform?: string;
  hostname?: () => string;
  run?: CalendarKeychainCommandRunner;
}

/** Tier-1 credential inputs, mirrored from @hasna/contracts `CredentialChainOptions`. */
export interface CalendarCredentialChainOptions {
  apiKey?: string;
  profile?: string;
  keychain?: CalendarKeychainTierOptions;
}

/** Which tier of the credential chain supplied a key. */
export type CalendarCredentialTier =
  | "argument"
  | "override"
  | "pointer"
  | "profile"
  | "keychain"
  | "disk"
  | "env";

/**
 * Every env name that can configure a Calendar authority or credential,
 * derived from the resolver itself.
 */
export function calendarResolverEnvKeys(name = "calendar"): string[] {
  const keys = clientTransportEnvKeys(name);
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey(name),
    credentialPointerEnvKey(name),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * Does the ENVIRONMENT itself declare a Calendar authority or credential?
 *
 * Deliberately narrower than "does a credential resolve": answering must not
 * touch the Keychain or the filesystem, because the `db-migrate` gate uses it
 * to refuse on any HOSTED INTENT without spending the machine's credential
 * stores. It reads the env dictionary and nothing else. A declared-but-blank
 * variable counts as absent here ("blank means unset" at this seam), matching
 * the normalisation in {@link calendarResolverInputs}.
 */
export function calendarHasHostedEnvIntent(env: CalendarEnv = process.env): boolean {
  return calendarResolverEnvKeys("calendar").some((key) => (env[key] ?? "").trim() !== "");
}

/**
 * @hasna/contracts marks the LIVE process environment with this symbol so its
 * ambient tiers — the macOS Keychain items, which belong to the machine rather
 * than to any env object — know they were handed the real environment and not
 * a caller-built one. It is a registry symbol precisely so a normaliser can
 * read it without importing internals.
 */
const CONTRACTS_AMBIENT_ENVIRONMENT = Symbol.for("hasna:contracts:ambientClientEnvironment");

/**
 * Is this the environment the machine's ambient credential stores belong to?
 * The same test @hasna/contracts performs, run on the env BEFORE normalising.
 */
export function isAmbientCalendarEnv(env: CalendarEnv): boolean {
  if (typeof process !== "undefined" && (env as unknown) === (process.env as unknown)) return true;
  return (env as unknown as Record<symbol, unknown>)[CONTRACTS_AMBIENT_ENVIRONMENT] === true;
}

/** The env object and credential options a Calendar surface hands @hasna/contracts. */
export interface CalendarResolverInputs<T extends CalendarEnv> {
  /** The environment with every declared-but-blank authority variable removed. */
  env: T;
  /** The chain options, with the Keychain tier's ambient gate already decided. */
  credentials: CalendarCredentialChainOptions;
}

/**
 * Build the resolver's inputs: the normalised environment AND the credential
 * options that keep the machine's Keychain tier reachable across it.
 *
 * Blanks are removed ONLY when something has to change, so the common case —
 * an environment with no declared-but-blank resolver variable — passes through
 * by identity and the resolver runs its own ambient test as usual. When a copy
 * is forced, the Keychain gate is decided HERE (on the original env) and
 * carried across as `keychain.enabled` rather than being silently lost: a
 * deliberate tier must never fall through to another identity because of an
 * object-identity test a normaliser copy cannot pass (hasna/apps#1788).
 *
 * An explicit `enabled` from the caller still wins, and an injected `run`
 * (which @hasna/contracts already treats as "enabled") is left alone, so the
 * hermetic seam the test suite relies on is untouched.
 */
export function calendarResolverInputs<T extends CalendarEnv>(
  env: T,
  credentials: CalendarCredentialChainOptions = {},
): CalendarResolverInputs<T> {
  const blanks = calendarResolverEnvKeys("calendar").filter(
    (key) => key in env && (env[key] ?? "").trim() === "",
  );
  if (blanks.length === 0) return { env, credentials };
  const next = { ...env } as T;
  for (const key of blanks) delete next[key];
  const keychain = { ...credentials.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientCalendarEnv(env);
  }
  return { env: next, credentials: { ...credentials, keychain } };
}