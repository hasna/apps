// THE LOCAL OPT-IN, answered from the environment and from nothing else.
//
// The fail-closed ruling (owner directive 2026-09-04, hasna/apps#1720; cross-app
// alignment 2026-09-11) names ONE way to reach an on-box SQLite store from a
// public @hasna client: the deliberate opt-in `HASNA_EMAILS_LOCAL=1` (alias
// `EMAILS_LOCAL=1`). Nothing else selects it — not the absence of a credential,
// and not a database PATH on its own. A path (`HASNA_EMAILS_DB_PATH` /
// `EMAILS_DB_PATH`) says WHERE the local file lives; only the opt-in says THAT
// this process may keep mail there. Until 1.6.1 a path alone was the opt-in,
// which is the door this module closes.
//
// ORDER, AND WHY IT IS THIS WAY ROUND. A configured environment outranks the
// opt-in: a run with `HASNA_EMAILS_API_KEY` (or any other authority/credential
// name below) set goes hosted, and a half-configured one fails loudly, rather
// than quietly serving local rows because a stale `HASNA_EMAILS_LOCAL` was lying
// around. But when the environment configures nothing, the opt-in is answered
// WITHOUT calling the resolver — no Keychain item and no credential file is read
// — so a scrubbed test environment can still promise that it physically cannot
// reach a real credential store.
//
// This module's only import is the env-key derivation from @hasna/contracts, so
// the NAMES it looks for are the resolver's own rather than a copy that can fall
// behind. `@hasna/contracts` 1.1.0 will publish `selectsLocalStore()` for exactly
// this question; the shape here is deliberately the same so the swap is
// mechanical (do not pin 1.1.0 before it is published).

import {
  CREDENTIAL_PROFILE_ENV_KEY,
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
} from "@hasna/contracts/client";

const APP = "emails";

/** The deliberate unhosted opt-in, canonical name first. */
export const EMAILS_LOCAL_OPT_IN_ENV_KEYS = Object.freeze(["HASNA_EMAILS_LOCAL", "EMAILS_LOCAL"] as const);

/** The canonical spelling, for a message that has to name exactly one. */
export const EMAILS_LOCAL_OPT_IN_ENV = EMAILS_LOCAL_OPT_IN_ENV_KEYS[0];

/**
 * The app's own principals (a live user session, an agent identity token). They
 * are a hosted credential in their own right (ADR-0002), so their presence is an
 * authority intent exactly like the resolver's key names.
 */
const APP_PRINCIPAL_ENV_KEYS = Object.freeze(["EMAILS_SESSION_TOKEN", "EMAILS_IDP_TOKEN"] as const);

export type EmailsLocalOptInEnv = Record<string, string | undefined>;

function configured(env: EmailsLocalOptInEnv, key: string): boolean {
  return (env[key] ?? "").trim() !== "";
}

/** True when the operator deliberately asked for the unhosted on-machine store. */
export function isEmailsLocalOptIn(env: EmailsLocalOptInEnv = process.env): boolean {
  return EMAILS_LOCAL_OPT_IN_ENV_KEYS.some((key) => configured(env, key));
}

/** The opt-in key that is set, canonical first, or null. Never a value. */
export function emailsLocalOptInSetting(env: EmailsLocalOptInEnv = process.env): string | null {
  return EMAILS_LOCAL_OPT_IN_ENV_KEYS.find((key) => configured(env, key)) ?? null;
}

/**
 * Every env name that can configure an Emails authority or credential: the
 * resolver-derived URL/key names and deliberate tiers, plus the app's own
 * principals. Read from @hasna/contracts so the list cannot drift from the seam.
 */
export function emailsAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys(APP);
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey(APP),
    credentialPointerEnvKey(APP),
    CREDENTIAL_PROFILE_ENV_KEY,
    ...APP_PRINCIPAL_ENV_KEYS,
  ];
}

/** The authority/credential env names that are actually set in `env`, in list order. */
export function configuredEmailsAuthorityEnvKeys(env: EmailsLocalOptInEnv = process.env): string[] {
  return emailsAuthorityEnvKeys().filter((key) => configured(env, key));
}

/**
 * Does the ENVIRONMENT itself configure an Emails authority or credential?
 *
 * Deliberately narrower than "does a credential resolve": answering it must not
 * touch the Keychain or the filesystem, because doing so would defeat the
 * isolation the opt-in short-circuit exists to provide. It reads the env
 * dictionary and nothing else. A declared-but-blank variable counts as absent
 * HERE (a blank has always been this package's spelling for "not configured");
 * once the run goes hosted the resolver refuses a blank loudly rather than
 * falling through to another identity.
 */
export function hasEmailsEnvAuthorityIntent(env: EmailsLocalOptInEnv = process.env): boolean {
  return configuredEmailsAuthorityEnvKeys(env).length > 0;
}

/**
 * True when this environment selects the on-box local store: the opt-in is set
 * AND the environment configures no authority or credential. A configured
 * environment outranks the flag.
 */
export function selectsEmailsLocalMode(env: EmailsLocalOptInEnv = process.env): boolean {
  return isEmailsLocalOptIn(env) && !hasEmailsEnvAuthorityIntent(env);
}
