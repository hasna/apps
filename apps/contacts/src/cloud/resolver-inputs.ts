/**
 * The credential-chain seam between @hasna/contracts 1.0.2 and this package.
 *
 * Contacts never builds its own credential or authority chain: the CLI, the
 * MCP server and the store all funnel through
 * `resolveContactsClientTransport`, which hands @hasna/contracts the
 * environment unchanged, per request, fresh. The one thing this module owns
 * is the ambient gate for the resolver's Keychain tier (#1788).
 *
 * The Keychain belongs to the MACHINE, so the resolver consults it only when
 * it is handed the live process environment (or a snapshot the resolver
 * itself marked ambient) — a caller-built env object is the hermetic seam and
 * must never drag a machine identity into a test. A copy made on the way in
 * silently loses that gate, and the per-request re-resolution in
 * `resolveContactsStorageClient` does make a copy: a snapshot of the env so a
 * concurrent mutation cannot tear one resolution. A copy that drops the
 * Keychain gate would, on a Mac station whose only credential is the Keychain
 * item, turn every request into a fresh failure — or, with a credential on
 * disk, into a DIFFERENT principal with no notice.
 *
 * So the ambient answer is decided HERE, on the ORIGINAL env, before any copy
 * exists, and carried across as the documented `keychain.enabled` control.
 * A caller's explicit `keychain` options always win; the injected `run`
 * runner (which @hasna/contracts already treats as "enabled") is left alone.
 */
import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
  type CredentialChainOptions,
  type KeychainTierOptions,
} from "@hasna/contracts/client";

export type Env = Record<string, string | undefined>;

/** @hasna/contracts marks the live process environment with this registry
 * symbol so its ambient tiers know they were handed the real environment. */
const CONTRACTS_AMBIENT_ENVIRONMENT = Symbol.for("hasna:contracts:ambientClientEnvironment");

/**
 * Is this the environment the machine's ambient credential stores belong to?
 *
 * The same test @hasna/contracts performs, run on the env BEFORE any copy
 * exists — which is the whole point of asking here.
 */
export function isAmbientContactsEnv(env: Env): boolean {
  if (typeof process !== "undefined" && (env as unknown) === (process.env as unknown)) return true;
  return (env as unknown as Record<symbol, unknown>)[CONTRACTS_AMBIENT_ENVIRONMENT] === true;
}

/** Every env name the resolver may consult for the contacts authority or
 * credential — canonical names, the legacy aliases, the deliberate pointers,
 * and the profile selector. */
export function contactsAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys("contacts");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("contacts"),
    credentialPointerEnvKey("contacts"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * The credential chain options a contacts surface hands the resolver.
 *
 * On the identity path (`env === process.env`, or a snapshot @hasna/contracts
 * itself marked ambient) this passes through untouched and the resolver runs
 * its own ambient test. On a CALLER-BUILT env — every hermetic test env, and
 * the per-request snapshot in `resolveContactsStorageClient` — the Keychain
 * tier would silently switch off the moment a copy is made; the caller's
 * explicit controls still win, and otherwise the tier is pinned to what the
 * ORIGINAL env was: ambient in, enabled; hermetic in, disabled.
 */
export function contactsResolverCredentials(
  env: Env,
  credentials: CredentialChainOptions = {},
): CredentialChainOptions {
  const keychain: KeychainTierOptions = { ...credentials.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientContactsEnv(env);
  }
  return { ...credentials, keychain };
}