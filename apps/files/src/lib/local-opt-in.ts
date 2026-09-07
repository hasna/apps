/**
 * The routing preamble every files surface runs before the credential chain:
 * "did the environment configure a files authority, and if not, did the
 * operator ask for the on-box store?"
 *
 * It lives in one leaf module because the CLI, the MCP server and the SDK all
 * have to answer identically — a second spelling is a second thing that can
 * drift — and because the SDK must be able to ask without pulling the CLI's
 * transport gate (and its transitive world) into a zero-dependency bundle. Its
 * only import is the env-key derivation from @hasna/contracts, so the NAMES it
 * looks for are the resolver's own rather than a copy that can fall behind.
 *
 * ORDER, AND WHY IT IS THIS WAY ROUND. A configured environment outranks the
 * opt-in: a run with `HASNA_FILES_API_KEY` set goes hosted (and a
 * half-configured one fails loudly), rather than quietly serving a different
 * dataset because a stale `HASNA_FILES_LOCAL` was lying around. But when the
 * environment configures nothing, the opt-in is answered WITHOUT calling the
 * resolver — so no Keychain item and no credential file is read — which is what
 * lets the failed-closed tests still promise that a scrubbed test environment
 * physically cannot reach a credential store, now that a credential can arrive
 * from somewhere an env dictionary cannot blank.
 *
 * The retired `HASNA_FILES_LOCAL_MODE` / `FILES_LOCAL_MODE` / `*_STORAGE_MODE`
 * switches are gone: the on-box store is reachable ONLY through the deliberate
 * opt-in `HASNA_FILES_LOCAL` (alias `FILES_LOCAL`), and every local run prints
 * the "LOCAL mode" line on stderr (owner directive 2026-09-04, hasna/apps#1720).
 */
import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "@hasna/contracts/client";
import type { ClientEnv, FilesCredentialChainOptions } from "../store/client-types.js";

/** The deliberate unhosted opt-in, canonical name first. */
export const FILES_LOCAL_OPT_IN_ENV_KEYS = ["HASNA_FILES_LOCAL", "FILES_LOCAL"] as const;

/** Truthy values count as the opt-in; falsy spellings ("0", "false", "no") never do. */
function optInValue(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false" && v !== "no";
}

/** True when the operator deliberately asked for the unhosted local store. */
export function isFilesLocalOptIn(env: FilesLocalOptInEnv = process.env): boolean {
  return FILES_LOCAL_OPT_IN_ENV_KEYS.some((key) => optInValue(env[key]));
}

/** Every env name that can configure a files authority or credential, resolver-derived. */
export function filesAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys("files");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("files"),
    credentialPointerEnvKey("files"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * Does the ENVIRONMENT itself configure a files authority or credential?
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
export function hasFilesEnvAuthorityIntent(env: FilesLocalOptInEnv = process.env): boolean {
  return filesAuthorityEnvKeys().some((key) => (env[key] ?? "").trim() !== "");
}

/** True when this environment should be served by the on-box SQLite store. */
export function selectsFilesLocalStore(env: FilesLocalOptInEnv = process.env): boolean {
  return !hasFilesEnvAuthorityIntent(env) && isFilesLocalOptIn(env);
}

/**
 * The environment as the resolver should see it: every authority/credential
 * variable that is DECLARED BUT BLANK removed.
 *
 * A blank has always been this package's spelling for "not configured" — it is
 * how the test preload scrubbed an inherited environment and how consumer
 * fixtures in the wild still write it. @hasna/contracts takes the opposite and,
 * for its purposes, correct view: a declared-but-blank credential is a
 * misconfiguration it refuses loudly rather than resolving around, because a
 * blank that fell through would authenticate as a different principal than the
 * operator named.
 *
 * Both are right at their own layer, and the mismatch is not hypothetical: an
 * environment carrying a real `HASNA_FILES_API_KEY` alongside a blank legacy
 * alias — the exact shape a scrubbed-then-overridden fixture produces — is a
 * complete, unambiguous configuration that would otherwise be refused for the
 * alias nobody set. Normalising here keeps "blank means unset" true at the
 * files seam while leaving the resolver's stricter rule intact for everything
 * it does receive: a value that is present is still policed, and two aliases
 * that actually disagree still refuse.
 */
export function filesResolverEnv<T extends FilesLocalOptInEnv>(env: T): T {
  const blanks = filesAuthorityEnvKeys().filter(
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
 *
 * The same test @hasna/contracts performs, run on the env BEFORE we normalise
 * it — which is the whole point of asking here.
 */
function isAmbientFilesEnv(env: FilesLocalOptInEnv): boolean {
  if (typeof process !== "undefined" && (env as unknown) === (process.env as unknown)) return true;
  return (env as unknown as Record<symbol, unknown>)[CONTRACTS_AMBIENT_ENVIRONMENT] === true;
}

/** The env object and credential options a files surface hands @hasna/contracts. */
export interface FilesResolverInputs<T extends FilesLocalOptInEnv> {
  /** The environment with every declared-but-blank authority variable removed. */
  env: T;
  /** The chain options, with the Keychain tier's ambient gate already decided. */
  credentials: FilesCredentialChainOptions;
}

/**
 * Build the resolver's inputs: the normalised environment AND the credential
 * options that keep the machine's Keychain tier reachable across it.
 *
 * WHY THIS IS NOT JUST {@link filesResolverEnv}. Blanking a variable and
 * deleting it are not the same operation to @hasna/contracts, because dropping
 * a key forces us to hand the resolver a COPY, and the resolver gates its
 * ambient tiers on OBJECT IDENTITY (`env === process.env`, or the registry
 * symbol its own snapshot carries). A copy is, by that test, a caller-built
 * world — the hermetic seam — so the Keychain is outside it and tier 3 turns
 * itself off. Silently: there is no error, no warning and no diagnostic,
 * because from the resolver's side nothing went wrong.
 *
 * The consequence is the one failure this whole ruling exists to prevent. On a
 * station whose Keychain holds `hasna.credentials.files.api-key`, ONE
 * declared-but-blank authority variable — any name in
 * {@link filesAuthorityEnvKeys}, canonical or legacy; the shape a scrubbed
 * fixture leaves behind, and the shape a wrapper spelling
 * `HASNA_FILES_API_URL="${MAYBE_UNSET}"` produces — dropped the run from the
 * Keychain identity to whatever came next: to
 * `~/.hasna/files/config/credentials`, a DIFFERENT principal, with no notice;
 * or, with nothing on disk, to a bare refusal on a station that is in fact
 * configured. A deliberate tier must never fall through to another identity,
 * so the gate is decided HERE, on the original env, and carried across the copy
 * as the documented `keychain.enabled` control rather than being left to an
 * identity test the copy cannot pass.
 *
 * An explicit `enabled` from the caller still wins, and an injected `run`
 * (which @hasna/contracts already treats as "enabled") is left alone, so the
 * hermetic seam tests rely on is untouched. When there is no blank to remove
 * the inputs pass through by identity, exactly as before.
 */
export function filesResolverInputs<T extends FilesLocalOptInEnv>(
  env: T,
  credentials: FilesCredentialChainOptions = {},
): FilesResolverInputs<T> {
  const normalised = filesResolverEnv(env);
  // Identity survived: the resolver can run its own ambient test as usual.
  if (normalised === env) return { env: normalised, credentials };
  const keychain = { ...credentials.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientFilesEnv(env);
  }
  return {
    env: normalised,
    credentials: { ...credentials, keychain },
  };
}

/** Env-dictionary shape the files seam accepts (structural alias of {@link ClientEnv}). */
export type FilesLocalOptInEnv = ClientEnv;