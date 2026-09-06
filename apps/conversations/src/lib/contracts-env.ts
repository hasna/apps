// The routing preamble every conversations surface runs before the shared
// @hasna/contracts credential chain (owner rulings 2026-09-04, hasna/apps#1720).
//
// WHAT THIS FILE IS. Conversations does not resolve credentials itself any more.
// The CLI, the MCP server, the hook and the library `getStore()` all route data
// through `src/lib/store/index.ts`, which calls the ONE client seam in
// `@hasna/contracts/client` (and `/client/storage`) fresh on every resolution.
// That seam decides which credential and which service authority apply:
//
//   1. an explicit argument      — `credentials.apiKey` / `credentials.profile`
//   2. a deliberate env pointer  — HASNA_CONVERSATIONS_API_KEY_OVERRIDE,
//                                  HASNA_PROFILE, HASNA_CONVERSATIONS_API_KEY_REF
//   3. the macOS Keychain        — generic-password `hasna.credentials.conversations.api-key`,
//                                  account HASNA_STATION, else `hostname -s`, else $USER
//   4. disk                      — `~/.hasna/conversations/config/credentials`, owner-only
//                                  0400/0600 (HASNA_HOME / HASNA_CONFIG_HOME move the root)
//   5. HASNA_CONVERSATIONS_API_KEY — a legitimate tier below disk, no deprecation notice
//
// and the authority follows HASNA_CONVERSATIONS_API_URL, then the Keychain
// `api-url` item, then the credentials file, then the fleet gateway
// `https://api.hasna.com/conversations` (the client appends `/v1`). The legacy
// unprefixed `CONVERSATIONS_*` spellings survive only as the resolver's silent
// alias fallback; the canonical `HASNA_CONVERSATIONS_*` names are the
// documented ones and are what every message here names.
//
// RETIRED, and inputs nowhere: `~/.hasna/fleet-env/`, `~/.hasna/cloud/`,
// `~/.config/hasna/`, `$XDG_CONFIG_HOME` and the app's own key reads — the
// vendored transport copy that used to read `~/.hasna/fleet-env/<app>.env` is
// gone. No `*_MODE` / `*_STORAGE_MODE` variable is read: the transport is
// decided by what RESOLVES, never by a mode word.
//
// WHAT THIS FILE DECIDES ITSELF. Two things the shared resolver cannot know:
//
// (a) that conversations ALSO has an on-box SQLite store, reachable ONLY by
//     the explicit local opt-in `HASNA_CONVERSATIONS_DB_PATH` /
//     `CONVERSATIONS_DB_PATH`. Hosted with no credential the app FAILS LOUD
//     (non-zero exit, no SQLite opened, no `*-local-fallback` event); local is
//     never a fallback from failure, it is a named request, and it announces
//     itself once on stderr.
//
// (b) the declared-but-blank normalisation the resolver's stricter rule forces.
//     `@hasna/contracts` REFUSES a declared-but-blank authority variable loudly
//     ("set but blank") rather than reading it as absent, and it gates its
//     AMBIENT tiers (the macOS Keychain) on the OBJECT IDENTITY of the env it
//     is handed (`env === process.env`). Conversations has always spelled
//     "blank means unset" (`firstSet` in ./store/index.ts), so a blank legacy
//     alias beside a real canonical pair is a complete, unambiguous
//     configuration to THIS app but a refusal to the resolver — and deleting
//     the blank would hand the resolver a COPY, silently turning the Keychain
//     tier off. `conversationsResolverInputs` resolves that: blanks are removed
//     WITHOUT dropping the ambient gate (the Keychain tier's `enabled` control
//     carries it across the copy), exactly as the todos pattern does.
import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "@hasna/contracts/client";
import type { CredentialChainOptions } from "@hasna/contracts/client";

/** Upper-snake env token for an app name, e.g. `conversations` -> `CONVERSATIONS`. */
export function envToken(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}

/** App slug this module describes. */
export const APP = "conversations";

/** The env-key spec for the canonical pair, from the shared resolver. */
export const ENV_KEYS = clientTransportEnvKeys(APP);

/** Local SQLite path overrides — the ONLY way local is selected. */
export const DB_PATH_KEYS = [
  `HASNA_${envToken(APP)}_DB_PATH`,
  `${envToken(APP)}_DB_PATH`,
] as const;

export type ConversationsLocalOptInEnv = Record<string, string | undefined>;

/** True when the operator asked for the on-box SQLite store by name. */
export function isConversationsLocalOptIn(env: ConversationsLocalOptInEnv = process.env): boolean {
  return DB_PATH_KEYS.some((key) => (env[key] ?? "").trim() !== "");
}

/** Every env name that can configure a conversations authority or credential, resolver-derived. */
export function conversationsAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys(APP);
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey(APP),
    credentialPointerEnvKey(APP),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * The environment as the resolver should see it: every authority/credential
 * variable that is DECLARED BUT BLANK removed.
 *
 * Blank has always been this app's spelling for "not configured". The resolver
 * takes the opposite, and for its purposes correct, view: a declared-but-blank
 * credential is a misconfiguration it refuses loudly rather than resolving
 * around. Normalising here keeps "blank means unset" true at the
 * conversations seam while leaving the resolver's stricter rule intact for
 * everything it does receive.
 */
export function conversationsResolverEnv<T extends ConversationsLocalOptInEnv>(env: T): T {
  const blanks = conversationsAuthorityEnvKeys().filter(
    (key) => key in env && (env[key] ?? "").trim() === "",
  );
  if (blanks.length === 0) return env;
  const next = { ...env } as T;
  for (const key of blanks) delete next[key];
  return next;
}

/** The registry symbol @hasna/contracts marks the live process environment with. */
const CONTRACTS_AMBIENT_ENVIRONMENT = Symbol.for("hasna:contracts:ambientClientEnvironment");

/**
 * Is this the environment the machine's ambient credential stores belong to?
 * The same test @hasna/contracts performs, run on the env BEFORE we normalise it.
 */
function isAmbientConversationsEnv(env: ConversationsLocalOptInEnv): boolean {
  if (typeof process !== "undefined" && (env as unknown) === (process.env as unknown)) return true;
  return (env as unknown as Record<symbol, unknown>)[CONTRACTS_AMBIENT_ENVIRONMENT] === true;
}

/** The env object and credential options a conversations surface hands @hasna/contracts. */
export interface ConversationsResolverInputs<T extends ConversationsLocalOptInEnv> {
  /** The environment with every declared-but-blank authority variable removed. */
  env: T;
  /** The chain options, with the Keychain tier's ambient gate already decided. */
  credentials: CredentialChainOptions;
}

/**
 * Build the resolver's inputs: the normalised environment AND the credential
 * options that keep the machine's Keychain tier reachable across it.
 *
 * WHY THIS IS NOT JUST {@link conversationsResolverEnv}. Blanking a variable
 * and deleting it are not the same operation to @hasna/contracts, because
 * dropping a key forces us to hand the resolver a COPY, and the resolver gates
 * its ambient tiers on OBJECT IDENTITY (`env === process.env`, or the registry
 * symbol its own snapshot carries). A copy is, by that test, a caller-built
 * world — the hermetic seam — so the Keychain is outside it. A deliberate tier
 * must never fall through to another identity, so the gate is decided HERE, on
 * the original env, and carried across the copy as the documented
 * `keychain.enabled` control rather than being left to an identity test the
 * copy cannot pass.
 *
 * An explicit `enabled` from the caller still wins, and an injected `run`
 * (which @hasna/contracts already treats as "enabled") is left alone, so the
 * hermetic seam tests rely on is untouched. When there is no blank to remove
 * the inputs pass through by identity, exactly as before.
 */
export function conversationsResolverInputs<T extends ConversationsLocalOptInEnv>(
  env: T,
  credentials: CredentialChainOptions = {},
): ConversationsResolverInputs<T> {
  const normalised = conversationsResolverEnv(env);
  // Identity survived: the resolver can run its own ambient test as usual.
  if (normalised === env) return { env: normalised, credentials };
  const keychain = { ...credentials.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientConversationsEnv(env);
  }
  return { env: normalised, credentials: { ...credentials, keychain } };
}

/**
 * The one line a local run prints, and the reason it prints at all.
 *
 * An unhosted CLI that says nothing looks exactly like a hosted one whose store
 * happens to be empty — the false green the 2026-09-04 ruling closes. It goes
 * to STDERR so `--json` output stays a clean parseable document on stdout.
 */
export function conversationsLocalModeNotice(dbPath: string): string {
  return (
    `conversations: LOCAL mode — using the on-box SQLite store at ${dbPath}, not the hosted fleet. ` +
    `Unset ${DB_PATH_KEYS[0]} and provide a credential via the Keychain item ` +
    `hasna.credentials.conversations.api-key, ~/.hasna/conversations/config/credentials, or ` +
    `HASNA_CONVERSATIONS_API_KEY to work against https://api.hasna.com/conversations.`
  );
}

let localNoticePrinted = false;

/** Reset the once-per-process local-mode notice. Test seam only. */
export function __resetConversationsLocalNotice(): void {
  localNoticePrinted = false;
}

/**
 * Print the local-mode notice once per process. A no-op for hosted runs, so a
 * hosted run's stderr stays empty. `dbPath` is the resolved on-box store path.
 */
export function announceConversationsLocalMode(
  dbPath: string,
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): boolean {
  if (localNoticePrinted) return false;
  localNoticePrinted = true;
  write(conversationsLocalModeNotice(dbPath));
  return true;
}
