/**
 * The routing preamble every surface runs before the credential chain: "did the
 * environment configure a Recordings authority, and if not, did the operator
 * ask for the on-box store?"
 *
 * It lives in one leaf module because the CLI, the MCP server and the SDK all
 * have to answer identically — a second spelling is a second thing that can
 * drift — and because the SDK must be able to ask without pulling the CLI's
 * transport module (and its transitive world) into a zero-dependency bundle.
 * Its only import is the env-key derivation from @hasna/contracts, so the NAMES
 * it looks for are the resolver's own rather than a copy that can fall behind.
 *
 * ORDER, AND WHY IT IS THIS WAY ROUND. A configured environment outranks the
 * opt-in: a run with `HASNA_RECORDINGS_API_KEY` set goes hosted, and a
 * half-configured one fails loudly, rather than quietly serving a different
 * dataset because a stale `HASNA_RECORDINGS_LOCAL` was lying around. But when
 * the environment configures nothing, the opt-in is answered WITHOUT calling
 * the resolver — so no Keychain item and no credential file is read — which is
 * what lets a scrubbed test environment physically cannot reach the shared
 * store, now that a credential can arrive from somewhere an env dictionary
 * cannot blank.
 *
 * THE RECORDINGS CARVE. `@hasna/contracts` treats the unprefixed
 * `RECORDINGS_API_URL` / `RECORDINGS_API_KEY` pair as the legacy aliases of the
 * canonical `HASNA_RECORDINGS_*` pair (silent, one release). In THIS package
 * those two unprefixed names are already spoken for by an older contract:
 * `RECORDINGS_API_KEY` is the OpenAI transcription-key override
 * (`src/lib/config.ts`, marked with the credential-seam waiver), and the
 * unprefixed URL form was never part of the hosted contract either. An OpenAI
 * key must never be handed to the resolver as a Hasna service credential — it
 * would authenticate to the fleet gateway as the wrong principal — so both
 * unprefixed names are carved OUT of the environment before the resolver sees
 * it AND out of the authority-intent check (an operator combining
 * `HASNA_RECORDINGS_LOCAL=1` with a plain `RECORDINGS_API_KEY` for the local
 * store must still land on the local store). The canonical
 * `HASNA_RECORDINGS_*` pair is the only env spelling the hosted contract
 * accepts.
 */

import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "@hasna/contracts/client";
import type { CredentialChainOptions } from "@hasna/contracts/client";

/** The deliberate unhosted opt-in, canonical name first. */
export const RECORDINGS_LOCAL_OPT_IN_ENV_KEYS = [
  "HASNA_RECORDINGS_LOCAL",
  "RECORDINGS_LOCAL",
] as const;

export type RecordingsLocalOptInEnv = Record<string, string | undefined>;

/** True when the operator deliberately asked for the unhosted local store. */
export function isRecordingsLocalOptIn(
  env: RecordingsLocalOptInEnv = process.env,
): boolean {
  return RECORDINGS_LOCAL_OPT_IN_ENV_KEYS.some(
    (key) => (env[key] ?? "").trim() !== "",
  );
}

/**
 * The two unprefixed spellings this package's older contract reserved for
 * other purposes. Carved out of the resolver environment so an OpenAI key
 * (or a legacy non-contract URL) can never authenticate as a Hasna credential —
 * and out of the AUTHORITY-INTENT check, so an operator running
 * `HASNA_RECORDINGS_LOCAL=1` with a plain `RECORDINGS_API_KEY` (the OpenAI
 * transcription key) for the local store still lands on the local store.
 */
const RECORDINGS_CARVED_LEGACY_ENV_KEYS = [
  "RECORDINGS_API_URL",
  "RECORDINGS_API_KEY",
] as const;

/** Every env name that can configure a Recordings authority or credential, resolver-derived. */
export function recordingsAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys("recordings");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("recordings"),
    credentialPointerEnvKey("recordings"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ].filter((key) => !(RECORDINGS_CARVED_LEGACY_ENV_KEYS as readonly string[]).includes(key));
}

/**
 * Does the ENVIRONMENT itself configure a Recordings authority or credential?
 *
 * Deliberately narrower than "does a credential resolve": answering it must not
 * touch the Keychain or the filesystem, because doing so would defeat the
 * isolation the opt-in short-circuit exists to provide. It reads the env
 * dictionary and nothing else.
 *
 * A DECLARED-BUT-BLANK variable counts as absent HERE — a blank has always been
 * this package's spelling for "not configured", and helpers in the wild blank
 * rather than delete. It is NOT absent once we do go hosted: the resolver
 * refuses a blank loudly rather than falling through to another identity, which
 * is the behaviour that matters at that point.
 */
export function hasRecordingsEnvAuthorityIntent(
  env: RecordingsLocalOptInEnv = process.env,
): boolean {
  return recordingsAuthorityEnvKeys().some(
    (key) => (env[key] ?? "").trim() !== "",
  );
}

/** True when this environment should be served by the on-box SQLite store. */
export function selectsRecordingsLocalStore(
  env: RecordingsLocalOptInEnv = process.env,
): boolean {
  return !hasRecordingsEnvAuthorityIntent(env) && isRecordingsLocalOptIn(env);
}

/**
 * The environment as the resolver should see it: every authority/credential
 * variable that is DECLARED BUT BLANK removed, plus the two carved unprefixed
 * names this package reserves for its older contract (`RECORDINGS_API_KEY` is
 * the OpenAI transcription-key override; the unprefixed URL form was never a
 * hosted-contract spelling).
 *
 * A blank has always been this package's spelling for "not configured" — it is
 * how fixture helpers scrub an inherited environment, and how consumer fixtures
 * in other repos still write it. @hasna/contracts takes the opposite and, for
 * its purposes, correct view: a declared-but-blank credential is a
 * misconfiguration it refuses loudly rather than resolving around, because a
 * blank that fell through would authenticate as a different principal than the
 * operator named.
 *
 * Both are right at their own layer, and the mismatch is not hypothetical: an
 * environment carrying a real `HASNA_RECORDINGS_API_KEY` alongside a blank
 * legacy alias — the exact shape a scrubbed-then-overridden fixture produces —
 * is a complete, unambiguous configuration that would otherwise be refused for
 * the alias nobody set. Normalising here keeps "blank means unset" true at the
 * Recordings seam while leaving the resolver's stricter rule intact for
 * everything it does receive: a value that is present is still policed, and
 * two aliases that actually disagree still refuse.
 *
 * The carved names are removed whenever present, blank or not: they configure
 * nothing on this package's hosted contract, and a value in them must never
 * reach the resolver as a Hasna credential.
 */
export function recordingsResolverEnv<T extends RecordingsLocalOptInEnv>(
  env: T,
): T {
  const carved = RECORDINGS_CARVED_LEGACY_ENV_KEYS.filter(
    (key) => key in env,
  );
  const blanks = recordingsAuthorityEnvKeys().filter(
    (key) => key in env && (env[key] ?? "").trim() === "",
  );
  const removed = new Set([...carved, ...blanks]);
  if (removed.size === 0) return env;
  const next = { ...env } as T;
  for (const key of removed) delete next[key];
  return next;
}

/**
 * @hasna/contracts marks the LIVE process environment with this symbol so its
 * ambient tiers — the macOS Keychain `api-key` and `api-url` items, which
 * belong to the machine rather than to any env object — know they were handed
 * the real environment and not a caller-built one. It is a registry symbol
 * precisely so a normaliser like ours can read it without importing internals.
 */
const CONTRACTS_AMBIENT_ENVIRONMENT = Symbol.for(
  "hasna:contracts:ambientClientEnvironment",
);

/**
 * Is this the environment the machine's ambient credential stores belong to?
 *
 * The same test @hasna/contracts performs, run on the env BEFORE we normalise
 * it — which is the whole point of asking here.
 */
function isAmbientRecordingsEnv(env: RecordingsLocalOptInEnv): boolean {
  if (
    typeof process !== "undefined" &&
    (env as unknown) === (process.env as unknown)
  ) {
    return true;
  }
  return (env as unknown as Record<symbol, unknown>)[
    CONTRACTS_AMBIENT_ENVIRONMENT
  ] === true;
}

/** The env object and credential options a Recordings surface hands @hasna/contracts. */
export interface RecordingsResolverInputs<T extends RecordingsLocalOptInEnv> {
  /** The environment with every declared-but-blank authority variable removed. */
  env: T;
  /** The chain options, with the Keychain tier's ambient gate already decided. */
  credentials: CredentialChainOptions;
}

/**
 * Build the resolver's inputs: the normalised environment AND the credential
 * options that keep the machine's Keychain tier reachable across it.
 *
 * WHY THIS IS NOT JUST {@link recordingsResolverEnv}. Blanking a variable and
 * deleting it are not the same operation to @hasna/contracts, because dropping
 * a key forces us to hand the resolver a COPY, and the resolver gates its
 * ambient tiers on OBJECT IDENTITY (`env === process.env`, or the registry
 * symbol its own snapshot carries). A copy is, by that test, a caller-built
 * world — the hermetic seam — so the Keychain is outside it and tier 3 turns
 * itself off. Silently: there is no error, no warning and no diagnostic,
 * because from the resolver's side nothing went wrong.
 *
 * The consequence is the one failure this whole ruling exists to prevent. On a
 * station whose Keychain holds `hasna.credentials.recordings.api-key`, ONE
 * declared-but-blank authority variable — any name in
 * {@link recordingsAuthorityEnvKeys}, canonical or carved; the shape a scrubbed
 * fixture leaves behind — dropped the run from the Keychain identity to
 * whatever came next: to `~/.hasna/recordings/config/credentials`, a DIFFERENT
 * principal, with no notice; or, with nothing on disk, to a bare
 * REMOTE_API_CONFIG_MISSING on a station that is in fact configured. A
 * deliberate tier must never fall through to another identity, so the gate is
 * decided HERE, on the original env, and carried across the copy as the
 * documented `keychain.enabled` control rather than being left to an identity
 * test the copy cannot pass.
 *
 * An explicit `enabled` from the caller still wins, and an injected `run`
 * (which @hasna/contracts already treats as "enabled") is left alone, so the
 * hermetic seam tests rely on is untouched. When there is nothing to remove
 * the inputs pass through by identity, exactly as before.
 */
export function recordingsResolverInputs<T extends RecordingsLocalOptInEnv>(
  env: T,
  credentials: CredentialChainOptions = {},
): RecordingsResolverInputs<T> {
  const normalised = recordingsResolverEnv(env);
  // Identity survived: the resolver can run its own ambient test as usual.
  if (normalised === env) return { env: normalised, credentials };
  const keychain = { ...credentials.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientRecordingsEnv(env);
  }
  return { env: normalised, credentials: { ...credentials, keychain } };
}