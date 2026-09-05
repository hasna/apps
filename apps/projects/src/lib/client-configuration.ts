// One question, asked in one place: "does anything on this station point <app>
// at a hosted service?"
//
// The @hasna/contracts client resolver answers "which key, from where, against
// which authority" and THROWS when it cannot build an authenticated client.
// That throw is the right outcome almost always — a half-configured station
// must fail loud rather than quietly read local data. There are exactly two
// callers that need to tell the loud case apart from a station that configures
// nothing at all:
//
//   - `resolveProjectStore()`, which may then fall to the unhosted OSS mode
//     projects supports by design (announced, never silent), and
//   - `resolveContactsAuthority()`, where "no Contacts anywhere" simply means
//     the projects server does not offer the contact-membership surface.
//
// Both ask THIS function, so there is one spelling of what "configured" means.
// Any declaration counts: a canonical or aliased API URL, an override, a vault
// pointer, a profile selector, the Keychain `api-url` item, an authority in the
// credentials file, or a credential from any of the five tiers.
//
// The Keychain and disk tiers here are exactly the resolver's own. A
// caller-built env object is HERMETIC — the seam reaches neither the machine's
// Keychain nor its disk for it — while the live `process.env` reaches both.

import {
  appConfigDiskValue,
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  keychainConfigValue,
  resolveCredential,
  CREDENTIAL_PROFILE_ENV_KEY,
  type CredentialChainOptions,
} from "@hasna/contracts/client";

/** Process-environment shape accepted by the shared @hasna/contracts seam. */
export type ClientEnv = Record<string, string | undefined>;

/** True when NOTHING declares a hosted authority or credential for `app`. */
export function hostedConfigurationAbsent(
  app: string,
  env: ClientEnv,
  credentials?: CredentialChainOptions,
): boolean {
  if (credentials?.apiKey !== undefined || credentials?.profile !== undefined) return false;
  const keys = clientTransportEnvKeys(app);
  for (const key of [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey(app),
    credentialPointerEnvKey(app),
    CREDENTIAL_PROFILE_ENV_KEY,
  ]) {
    if (env[key] !== undefined) return false;
  }
  if (keychainConfigValue(app, env, credentials?.keychain) !== null) return false;
  if (appConfigDiskValue(app, env, keys.apiUrlKeys) !== null) return false;
  return resolveCredential(app, env, credentials) === null;
}

/**
 * {@link hostedConfigurationAbsent} with its own failures folded into "no".
 *
 * A Keychain item that exists but cannot be read, an unsafe credentials file,
 * or a deliberate tier that cannot be honoured all THROW from inside the probe.
 * None of those is an unconfigured station, so the caller's original resolver
 * error — which names the real problem — is the one that must reach the
 * operator.
 */
export function unconfiguredForHostedUse(
  app: string,
  env: ClientEnv,
  credentials?: CredentialChainOptions,
): boolean {
  try {
    return hostedConfigurationAbsent(app, env, credentials);
  } catch {
    return false;
  }
}
