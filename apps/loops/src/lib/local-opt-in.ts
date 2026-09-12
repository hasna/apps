/**
 * The routing preamble every loops surface runs before the credential chain:
 * "did the environment configure a loops authority, and if not, did the
 * operator ask for the on-box store?"
 *
 * It lives in one leaf module because the CLI, the MCP server, the daemon and
 * the SDK all have to answer identically — a second spelling is a second
 * thing that can drift. Its only import is the env-key derivation from
 * @hasna/contracts, so the NAMES it looks for are the resolver's own rather
 * than a copy that can fall behind. (`@hasna/contracts` 1.1.0 will publish
 * `selectsLocalStore`; until then this module is the local implementation of
 * the same contract so the later swap is mechanical.)
 *
 * ORDER, AND WHY IT IS THIS WAY ROUND (owner ruling 2026-09-07,
 * hasna/apps#1720). A configured environment outranks the opt-in: a run with
 * `HASNA_LOOPS_API_KEY` set goes hosted, and a half-configured one fails
 * loudly, rather than quietly serving a different dataset because a stale
 * `HASNA_LOOPS_LOCAL` was lying around. But when the environment configures
 * nothing, the opt-in is answered WITHOUT calling the resolver — so no
 * Keychain item and no credential file is read — which is what keeps a
 * scrubbed test environment physically unable to reach the shared store.
 *
 * The former value-based selector `HASNA_LOOPS_CONNECTION=file` is RETIRED.
 * It is read here for exactly one purpose: to refuse it loudly with the
 * migration hint. It never selects a store.
 */
import {
  CREDENTIAL_PROFILE_ENV_KEY,
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
} from "@hasna/contracts/client";

export type LoopsLocalOptInEnv = Record<string, string | undefined>;

const APP = "loops";

/** The deliberate unhosted opt-in, canonical name first. */
export const LOOPS_LOCAL_OPT_IN_ENV_KEYS = ["HASNA_LOOPS_LOCAL", "LOOPS_LOCAL"] as const;

/** The retired value-based connection switch; read ONLY to refuse it. */
export const RETIRED_LOOPS_CONNECTION_ENV_KEY = "HASNA_LOOPS_CONNECTION";

/** Where a hosted credential lives, named in every refusal (never a value). */
export const LOOPS_KEYCHAIN_ITEM = `hasna.credentials.${APP}.api-key`;
export const LOOPS_CREDENTIALS_FILE = `~/.hasna/${APP}/config/credentials`;
export const LOOPS_HOSTED_AUTHORITY = `https://api.hasna.com/${APP}`;

/** The one-token spelling of the opt-in used in messages. */
export const LOOPS_LOCAL_OPT_IN_HINT = `${LOOPS_LOCAL_OPT_IN_ENV_KEYS[0]}=1 (alias ${LOOPS_LOCAL_OPT_IN_ENV_KEYS[1]}=1)`;

/** True when the operator deliberately asked for the unhosted local store. */
export function isLoopsLocalOptIn(env: LoopsLocalOptInEnv = process.env): boolean {
  return LOOPS_LOCAL_OPT_IN_ENV_KEYS.some((key) => (env[key] ?? "").trim() !== "");
}

/** Every env name that can configure a loops authority or credential, resolver-derived. */
export function loopsAuthorityEnvKeys(): string[] {
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
 * Does the ENVIRONMENT itself configure a loops authority or credential?
 *
 * Deliberately env-only: answering it must not touch the Keychain or the
 * filesystem, because doing so would defeat the isolation the opt-in
 * short-circuit exists to provide. A DECLARED-BUT-BLANK variable counts as
 * absent here — blank has always been this package's spelling for "not
 * configured".
 */
export function hasLoopsEnvAuthorityIntent(env: LoopsLocalOptInEnv = process.env): boolean {
  return loopsAuthorityEnvKeys().some((key) => (env[key] ?? "").trim() !== "");
}

/** True when this environment should be served by the on-box SQLite store. */
export function selectsLoopsLocalStore(env: LoopsLocalOptInEnv = process.env): boolean {
  return !hasLoopsEnvAuthorityIntent(env) && isLoopsLocalOptIn(env);
}

/** True when the retired `HASNA_LOOPS_CONNECTION` switch carries a value (blank means unset). */
export function hasRetiredLoopsConnectionSwitch(env: LoopsLocalOptInEnv = process.env): boolean {
  return (env[RETIRED_LOOPS_CONNECTION_ENV_KEY] ?? "").trim() !== "";
}

/**
 * Refuse the retired value-based selector loudly, whatever its value. It is
 * never a store selection any more: `=api` was retired first (the resolver
 * selects the hosted connection), and `=file` is replaced by the standard
 * boolean opt-in. A stale unit or shell profile that still exports it gets
 * the migration hint instead of a silently different store.
 */
export function assertNoRetiredLoopsConnectionSwitch(env: LoopsLocalOptInEnv = process.env): void {
  if (!hasRetiredLoopsConnectionSwitch(env)) return;
  const value = (env[RETIRED_LOOPS_CONNECTION_ENV_KEY] ?? "").trim();
  throw new Error(
    `${RETIRED_LOOPS_CONNECTION_ENV_KEY}=${value} is retired and no longer selects a store: the hosted connection is ` +
      `selected by the shared credential resolver (${clientTransportEnvKeys(APP).apiKeyKeys[0]}, the macOS Keychain item ` +
      `${LOOPS_KEYCHAIN_ITEM}, or ${LOOPS_CREDENTIALS_FILE}), and this machine's on-box SQLite store is the explicit ` +
      `opt-in ${LOOPS_LOCAL_OPT_IN_HINT}, honoured only when no loops authority is configured. ` +
      `Unset ${RETIRED_LOOPS_CONNECTION_ENV_KEY} (regenerate any daemon unit that still exports it with ` +
      `'loops daemon install --local').`,
  );
}

/**
 * The one line a local run prints, and the reason it prints at all.
 *
 * An unhosted surface that says nothing looks exactly like a hosted one whose
 * store happens to be empty — that is the false green the ruling closes. It
 * goes to STDERR so `--json` output and the MCP stdio frames stay clean on
 * stdout, and it names the credential the run did NOT find, so the fix is in
 * the message rather than in the docs.
 */
export function loopsLocalModeNotice(): string {
  return (
    `loops: LOCAL mode — using this machine's on-box SQLite store, not the hosted fleet ` +
    `(${LOOPS_LOCAL_OPT_IN_ENV_KEYS[0]} is set). Unset it, and provide a credential via the Keychain item ` +
    `${LOOPS_KEYCHAIN_ITEM}, ${LOOPS_CREDENTIALS_FILE}, or ${clientTransportEnvKeys(APP).apiKeyKeys[0]}, ` +
    `to work against ${LOOPS_HOSTED_AUTHORITY}.`
  );
}

/**
 * The fail-closed refusal for "nothing is configured": ONE line naming every
 * tier the chain consulted and the opt-in — never a value, never a local
 * default. `detail` is the resolver's own message, appended so the tier that
 * actually refused is visible.
 */
export function loopsNoConnectionRefusal(detail?: string): string {
  const keys = clientTransportEnvKeys(APP);
  return (
    `no loops client connection is configured: set ${keys.apiUrlKeys[0]} and ${keys.apiKeyKeys[0]} to connect to the hosted loops API ` +
    `(or store the key in the macOS Keychain item ${LOOPS_KEYCHAIN_ITEM} or ${LOOPS_CREDENTIALS_FILE}; the authority defaults to ` +
    `${LOOPS_HOSTED_AUTHORITY}), or set ${LOOPS_LOCAL_OPT_IN_HINT} to explicitly use this machine's on-box SQLite store.` +
    (detail ? ` ${detail}` : "")
  );
}

/** The machine-readable code every hosted-route local-store refusal carries. */
export const REMOTE_COMMAND_UNSUPPORTED = "REMOTE_COMMAND_UNSUPPORTED";

/**
 * The refusal for a local-only operation attempted on the HOSTED route: a
 * loops credential resolved, so no code path may open the on-box SQLite
 * store — refuse, naming the opt-in, instead of serving a different dataset.
 */
export function loopsHostedLocalStoreRefusal(operation: string): string {
  return (
    `${REMOTE_COMMAND_UNSUPPORTED}: '${operation}' operates on this machine's on-box SQLite store and is not available ` +
    `on the hosted route (a loops credential resolved: ${clientTransportEnvKeys(APP).apiKeyKeys[0]}, the Keychain item ` +
    `${LOOPS_KEYCHAIN_ITEM}, or ${LOOPS_CREDENTIALS_FILE}). Set ${LOOPS_LOCAL_OPT_IN_HINT} in an environment that ` +
    `configures no loops authority to run it against the local store.`
  );
}
