// The environment as the @hasna/contracts client resolver should see it, for
// every shortlinks surface.
//
// WHY THIS FILE EXISTS. A declared-but-blank authority variable means one
// thing at this app's seam and another inside @hasna/contracts. This package
// has always treated a blank as "not configured": its test harnesses scrub an
// inherited environment by blanking `HASNA_SHORTLINKS_API_URL` /
// `HASNA_SHORTLINKS_API_KEY` and the legacy aliases rather than deleting them,
// and the app's docs tell operators to export values, never to declare blanks.
// @hasna/contracts takes the opposite and, for its purposes, correct view: a
// declared-but-blank credential is a misconfiguration it refuses loudly rather
// than resolving around, because a blank that fell through would authenticate
// as a different principal than the operator named.
//
// Both are right at their own layer, and the mismatch is not hypothetical: an
// environment carrying a real `HASNA_SHORTLINKS_API_KEY` alongside a blank
// legacy alias — the exact shape a scrubbed-then-overridden fixture produces —
// is a complete, unambiguous configuration that would otherwise be refused for
// the alias nobody set. Normalising here keeps "blank means unset" true at the
// shortlinks seam while leaving the resolver's stricter rule intact for
// everything it does receive: a value that is present is still policed, and
// two aliases that actually disagree still refuse.
//
// #1788: THE ENVIRONMENT IS NEVER HANDED OVER AS A SILENT COPY. The resolver
// gates its ambient tiers — the macOS Keychain `api-key` / `api-url` items —
// on OBJECT IDENTITY (`env === process.env`, or the registry symbol its own
// snapshot carries). Dropping a blank key forces a copy, and a copy is, by
// that test, a caller-built world in which the Keychain tier turns itself off
// — silently. So when a blank forces the copy, the ambient gate is decided
// HERE, on the original env, and carried across as the documented
// `keychain.enabled` control. An explicit `enabled` from the caller still
// wins, and an injected `run` (which @hasna/contracts already treats as
// "enabled") is left alone, so the hermetic test seam is untouched. When there
// is no blank to remove, the env passes through BY IDENTITY, exactly as
// before.
//
// It lives in one leaf module because the CLI, the MCP server and the SDK all
// have to answer identically — a second spelling is a second thing that can
// drift. Its only runtime import is the env-key derivation from
// @hasna/contracts, so the NAMES it looks for are the resolver's own rather
// than a copy that can fall behind.

import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "@hasna/contracts/client";
import type {
  ShortlinksCredentialChainOptions,
  ShortlinksEnv,
} from "./client-types.js";

/** Every env name that can configure a shortlinks authority or credential, resolver-derived. */
export function shortlinksAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys("shortlinks");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("shortlinks"),
    credentialPointerEnvKey("shortlinks"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * The environment as the resolver should see it: every authority/credential
 * variable that is DECLARED BUT BLANK removed. Returns the SAME object when
 * there is nothing to remove — the ambient-identity case never copies.
 */
export function shortlinksResolverEnv<T extends ShortlinksEnv>(env: T): T {
  const blanks = shortlinksAuthorityEnvKeys().filter(
    (key) => key in env && (env[key] ?? "").trim() === "",
  );
  if (blanks.length === 0) return env;
  const next = { ...env } as T;
  for (const key of blanks) delete next[key];
  return next;
}

/**
 * @hasna/contracts marks the LIVE process environment with this symbol so its
 * ambient tiers — the macOS Keychain `api-key` and `api-url` items, which
 * belong to the machine rather than to any env object — know they were handed
 * the real environment and not a caller-built one. It is a registry symbol
 * precisely so a normaliser like ours can read it without importing internals.
 */
const CONTRACTS_AMBIENT_ENVIRONMENT = Symbol.for("hasna:contracts:ambientClientEnvironment");

/**
 * Is this the environment the machine's ambient credential stores belong to?
 * The same test @hasna/contracts performs, run on the env BEFORE we normalise
 * it — which is the whole point of asking here.
 */
function isAmbientShortlinksEnv(env: ShortlinksEnv): boolean {
  if (typeof process !== "undefined" && (env as unknown) === (process.env as unknown)) return true;
  return (env as unknown as Record<symbol, unknown>)[CONTRACTS_AMBIENT_ENVIRONMENT] === true;
}

/** The env object and credential options a shortlinks surface hands @hasna/contracts. */
export interface ShortlinksResolverInputs<T extends ShortlinksEnv> {
  /** The environment with every declared-but-blank authority variable removed. */
  env: T;
  /** The chain options, with the Keychain tier's ambient gate already decided. */
  credentials: ShortlinksCredentialChainOptions;
}

/**
 * Build the resolver's inputs: the normalised environment AND the credential
 * options that keep the machine's Keychain tier reachable across it. See the
 * module header for why the gate travels with the copy (hasna/apps#1788).
 */
export function shortlinksResolverInputs<T extends ShortlinksEnv>(
  env: T,
  credentials: ShortlinksCredentialChainOptions = {},
): ShortlinksResolverInputs<T> {
  const normalised = shortlinksResolverEnv(env);
  // Identity survived: the resolver can run its own ambient test as usual.
  if (normalised === env) return { env: normalised, credentials };
  const keychain = { ...credentials.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientShortlinksEnv(env);
  }
  return { env: normalised, credentials: { ...credentials, keychain } };
}