/**
 * The routing preamble every Loops surface runs before the credential chain:
 * "did the environment configure a Loops authority, and if not, did the
 * operator explicitly ask for the on-box store?"
 *
 * A configured environment outranks the opt-in: a run with a Loops authority,
 * credential, profile, or vault pointer goes hosted (and a broken deliberate
 * selection fails loudly) rather than quietly serving a different local data
 * set. When the environment configures nothing, the opt-in is answered without
 * touching the Keychain or credential files. There is no implicit local
 * fallback.
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

/** Where a hosted credential lives, named in refusals but never with its value. */
export const LOOPS_KEYCHAIN_ITEM = `hasna.credentials.${APP}.api-key`;
export const LOOPS_CREDENTIALS_FILE = `~/.hasna/${APP}/config/credentials`;
export const LOOPS_HOSTED_AUTHORITY = `https://api.hasna.com/${APP}`;

/** The one-token spelling of the opt-in used in messages. */
export const LOOPS_LOCAL_OPT_IN_HINT = `${LOOPS_LOCAL_OPT_IN_ENV_KEYS[0]}=1 (alias ${LOOPS_LOCAL_OPT_IN_ENV_KEYS[1]}=1)`;

/**
 * True only for the exact documented opt-in value. Any other non-blank value
 * is a configuration error, including typos and conflicting aliases.
 */
export function isLoopsLocalOptIn(env: LoopsLocalOptInEnv = process.env): boolean {
  let selected = false;
  for (const key of LOOPS_LOCAL_OPT_IN_ENV_KEYS) {
    const value = env[key] ?? "";
    if (value === "") continue;
    if (value !== "1") {
      throw new Error(`${key} must be exactly 1 to select the on-box Loops store; got ${JSON.stringify(value)}.`);
    }
    selected = true;
  }
  return selected;
}

/** Every env name that can configure a Loops authority or credential. */
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

/** Deliberate selectors are terminal even when present-but-blank. */
export function loopsDeliberateCredentialEnvKeys(): string[] {
  return [credentialOverrideEnvKey(APP), credentialPointerEnvKey(APP), CREDENTIAL_PROFILE_ENV_KEY];
}

/** Does the environment itself express hosted authority or credential intent? */
export function hasLoopsEnvAuthorityIntent(env: LoopsLocalOptInEnv = process.env): boolean {
  const keys = clientTransportEnvKeys(APP);
  const transportIntent = [...keys.apiUrlKeys, ...keys.apiKeyKeys].some((key) => (env[key] ?? "").trim() !== "");
  const deliberateIntent = loopsDeliberateCredentialEnvKeys().some((key) => Object.prototype.hasOwnProperty.call(env, key));
  return transportIntent || deliberateIntent;
}

/** True when this environment should be served by the on-box SQLite store. */
export function selectsLoopsLocalStore(env: LoopsLocalOptInEnv = process.env): boolean {
  const local = isLoopsLocalOptIn(env);
  return !hasLoopsEnvAuthorityIntent(env) && local;
}

/** One local-mode line, written to stderr by client surfaces. */
export function loopsLocalModeNotice(): string {
  return (
    `loops: LOCAL mode — using this machine's on-box SQLite store, not the hosted fleet ` +
    `(${LOOPS_LOCAL_OPT_IN_ENV_KEYS[0]} is set). Unset it, and provide a credential via the Keychain item ` +
    `${LOOPS_KEYCHAIN_ITEM}, ${LOOPS_CREDENTIALS_FILE}, or ${clientTransportEnvKeys(APP).apiKeyKeys[0]}, ` +
    `to work against ${LOOPS_HOSTED_AUTHORITY}.`
  );
}

/** Actionable failure when neither hosted authority nor explicit local access exists. */
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

/** Refusal for a local-only operation attempted on the hosted route. */
export function loopsHostedLocalStoreRefusal(operation: string): string {
  return (
    `${REMOTE_COMMAND_UNSUPPORTED}: '${operation}' operates on this machine's on-box SQLite store and is not available ` +
    `on the hosted route (a loops credential resolved: ${clientTransportEnvKeys(APP).apiKeyKeys[0]}, the Keychain item ` +
    `${LOOPS_KEYCHAIN_ITEM}, or ${LOOPS_CREDENTIALS_FILE}). Set ${LOOPS_LOCAL_OPT_IN_HINT} in an environment that ` +
    `configures no loops authority to run it against the local store.`
  );
}
