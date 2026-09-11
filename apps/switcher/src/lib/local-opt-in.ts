/**
 * The routing preamble every Switcher client surface runs before the credential
 * chain: "did the environment configure a Switcher authority, and if not, did
 * the operator deliberately ask for the on-box local run?"
 *
 * ORDER. A configured environment outranks the opt-in: a run with
 * `HASNA_SWITCHER_API_KEY` set goes hosted, and a half-configured one fails
 * loudly inside @hasna/contracts, rather than quietly serving local data
 * because a stale `HASNA_SWITCHER_LOCAL` was lying around. When the environment
 * configures nothing, the opt-in is answered WITHOUT consulting the resolver —
 * no Keychain item and no credential file is read — so a scrubbed environment
 * can promise it never reached a real credential store.
 *
 * Fail-closed ruling (owner directive 2026-09-07, hasna/apps#1720): with no
 * credential resolvable the process exits non-zero, opens no SQLite and names
 * the tiers it consulted. The on-box run is reachable ONLY through this
 * deliberate opt-in, never through the absence of a credential.
 *
 * `@hasna/contracts` 1.1.0 (`selectsLocalStore`) is not published; this leaf
 * module carries the same shape so the later swap is mechanical.
 */
import {
  clientTransportEnvKeys,
  credentialDiskSources,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "@hasna/contracts/client";

/** The deliberate unhosted opt-in, canonical name first. */
export const SWITCHER_LOCAL_OPT_IN_ENV_KEYS = ["HASNA_SWITCHER_LOCAL", "SWITCHER_LOCAL"] as const;
/** The Keychain item the shared resolver reads for this app (account: HASNA_STATION or the short hostname). */
export const SWITCHER_KEYCHAIN_ITEM = "hasna.credentials.switcher.api-key";
/** The canonical credentials file, as operators know it. */
export const SWITCHER_CREDENTIALS_FILE = "~/.hasna/switcher/config/credentials";

export type SwitcherLocalOptInEnv = Record<string, string | undefined>;

/** True when the operator deliberately asked for the unhosted on-box run. */
export function isSwitcherLocalOptIn(env: SwitcherLocalOptInEnv = process.env): boolean {
  return SWITCHER_LOCAL_OPT_IN_ENV_KEYS.some((key) => (env[key] ?? "").trim() !== "");
}

/** Every env name that can configure a Switcher authority or credential, resolver-derived. */
export function switcherAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys("switcher");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("switcher"),
    credentialPointerEnvKey("switcher"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * Does the ENVIRONMENT itself declare a Switcher authority or credential?
 *
 * Deliberately narrower than "does a credential resolve": answering it must not
 * touch the Keychain or the filesystem. A DECLARED variable counts even when
 * blank — Switcher has always let Contracts refuse a blank override loudly
 * rather than fall through to another identity or to local data.
 */
export function hasSwitcherEnvAuthorityIntent(env: SwitcherLocalOptInEnv = process.env): boolean {
  return switcherAuthorityEnvKeys().some((key) => env[key] !== undefined);
}

/** True when this environment should be served by the on-box local run. */
export function selectsSwitcherLocalMode(env: SwitcherLocalOptInEnv = process.env): boolean {
  return !hasSwitcherEnvAuthorityIntent(env) && isSwitcherLocalOptIn(env);
}

/** The credential sources a fail-closed refusal names. Never a value. */
export function switcherCredentialSources(env: SwitcherLocalOptInEnv = process.env): string[] {
  const disk = credentialDiskSources("switcher", env)[0];
  return [
    `Keychain item ${SWITCHER_KEYCHAIN_ITEM}`,
    disk ? `${SWITCHER_CREDENTIALS_FILE} (${disk})` : SWITCHER_CREDENTIALS_FILE,
    `${clientTransportEnvKeys("switcher").apiKeyKeys[0] ?? "HASNA_SWITCHER_API_KEY"} in the environment`,
  ];
}

/** The one-line refusal for "nothing configured": tiers consulted plus the opt-in, never a value. */
export function remoteConfigMissingMessage(env: SwitcherLocalOptInEnv = process.env): string {
  return `No Switcher API credential is configured; consulted ${switcherCredentialSources(env).join(", ")}. ` +
    `Configure one of them, or set ${SWITCHER_LOCAL_OPT_IN_ENV_KEYS[0]}=1 (alias ${SWITCHER_LOCAL_OPT_IN_ENV_KEYS[1]}=1) to deliberately use the on-box local store. Nothing was read or created locally.`;
}

let announced = false;
/** Print the LOCAL-mode notice once per process. `write` is a test seam. */
export function announceSwitcherLocalMode(home: string, write: (line: string) => void = (line) => { process.stderr.write(line); }): void {
  if (announced) return;
  announced = true;
  write(`switcher: LOCAL mode — using the on-box store under ${home} behind an owned per-process loopback API, not a hosted Switcher API (${SWITCHER_LOCAL_OPT_IN_ENV_KEYS[0]} is set; a configured API URL or key would outrank it).\n`);
}
/** Test seam. */
export function resetSwitcherLocalModeAnnouncement(): void { announced = false; }
