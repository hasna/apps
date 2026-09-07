// Shared credential inputs for Conversations. Ordinary client resolution uses
// the API only; database-path names remain solely for rejecting retired settings
// and for explicitly constructed storage-library compatibility handles.
// Preserve ambient Keychain selection when normalizing blank legacy aliases.
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

/** Retired client selectors; explicit storage-library handles may still use these paths. */
export const DB_PATH_KEYS = [
  `HASNA_${envToken(APP)}_DB_PATH`,
  `${envToken(APP)}_DB_PATH`,
] as const;

export type ConversationsLocalOptInEnv = Record<string, string | undefined>;

/** Detect legacy path settings for rejection by ordinary client surfaces. */
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
export function conversationsLocalStoreNotice(dbPath: string): string {
  return (
    `conversations: local store — using the on-box SQLite store at ${dbPath}, not the hosted API. ` +
    `Unset ${DB_PATH_KEYS[0]} and provide a credential via the Keychain item ` +
    `hasna.credentials.conversations.api-key, ~/.hasna/conversations/config/credentials, or ` +
    `HASNA_CONVERSATIONS_API_KEY to work against the hosted API.`
  );
}

let localNoticePrinted = false;

/** Reset the once-per-process local-store notice. Test seam only. */
export function __resetConversationsLocalNotice(): void {
  localNoticePrinted = false;
}

/**
 * Print the local-store notice once per process. A no-op for hosted runs, so a
 * hosted run's stderr stays empty. `dbPath` is the resolved on-box store path.
 */
export function announceConversationsLocalStore(
  dbPath: string,
  write: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): boolean {
  if (localNoticePrinted) return false;
  localNoticePrinted = true;
  write(conversationsLocalStoreNotice(dbPath));
  return true;
}
