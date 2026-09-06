/**
 * The routing preamble every surface runs before the credential chain: "did the
 * environment configure an Instructions authority, and if not, did the operator
 * ask for the on-box SQLite store?"
 *
 * It lives in one leaf module because the CLI, the MCP server and the SDK all
 * have to answer identically — a second spelling is a second thing that can
 * drift. Its only contracts import is the env-key derivation, so the NAMES it
 * looks for are the resolver's own rather than a copy that can fall behind.
 *
 * ORDER, AND WHY IT IS THIS WAY ROUND (owner rulings 2026-09-04, hasna/apps#1720,
 * #1613). A configured environment outranks the opt-in: a run with
 * `HASNA_INSTRUCTIONS_API_KEY` set goes hosted, and a half-configured one fails
 * loudly, rather than quietly serving a different dataset because a stale
 * `HASNA_INSTRUCTIONS_LOCAL` was lying around. But when the environment
 * configures nothing, the opt-in is answered WITHOUT calling the resolver — so
 * no Keychain item and no credential file is read — which is what keeps a
 * scrubbed test environment physically unable to reach the shared store, now
 * that a credential can arrive from somewhere an env dictionary cannot blank.
 *
 * THE RETIRED CHAIN IS NOT HERE. `~/.hasna/fleet-env`, `~/.hasna/cloud`,
 * `~/.config/hasna`, `$XDG_CONFIG_HOME`, a `~/.instructions/config.json` key
 * store, unprefixed legacy names that outrank the canonical `HASNA_INSTRUCTIONS_*`
 * pair, and every `*_MODE` / `*_STORAGE_MODE` switch are inputs NOWHERE — the
 * `@hasna/contracts` resolver owns the whole ladder and the transport is decided
 * by what RESOLVES, never by a mode word.
 */
import { CREDENTIAL_PROFILE_ENV_KEY, clientTransportEnvKeys, credentialOverrideEnvKey, credentialPointerEnvKey } from "@hasna/contracts/client";
import type { InstructionsClientEnv, InstructionsCredentialChainOptions } from "./client-types.js";

/** The deliberate unhosted opt-in. `INSTRUCTIONS_LOCAL` was never a name here. */
export const INSTRUCTIONS_LOCAL_OPT_IN_ENV_KEYS = ["HASNA_INSTRUCTIONS_LOCAL"] as const;

/** Local-mode notice text, asserted verbatim by the CLI-level tests. */
export function instructionsLocalModeNotice(): string {
  return (
    `instructions: local mode — ${INSTRUCTIONS_LOCAL_OPT_IN_ENV_KEYS[0]}=1 selects the on-box SQLite store, ` +
    `and no hosted authority was configured. Set HASNA_INSTRUCTIONS_API_KEY (or add the Keychain item ` +
    `hasna.credentials.instructions.api-key, or write ~/.hasna/instructions/config/credentials) to go hosted.`
  );
}

/** True when the operator deliberately asked for the unhosted local store. */
export function isInstructionsLocalOptIn(env: InstructionsClientEnv = process.env): boolean {
  // Only the exact "1" selects local mode: a blank is "unset", and anything
  // else (e.g. "0" from a wrapper that toggles the variable) is not an opt-in.
  return INSTRUCTIONS_LOCAL_OPT_IN_ENV_KEYS.some((key) => (env[key] ?? "").trim() === "1");
}

/** Every env name that can configure an Instructions authority or credential, resolver-derived. */
export function instructionsAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys("instructions");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("instructions"),
    credentialPointerEnvKey("instructions"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * Does the ENVIRONMENT itself configure an Instructions authority or credential?
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
export function hasInstructionsEnvAuthorityIntent(env: InstructionsClientEnv = process.env): boolean {
  return instructionsAuthorityEnvKeys().some((key) => (env[key] ?? "").trim() !== "");
}

/** True when this environment should be served by the on-box SQLite store. */
export function selectsInstructionsLocalStore(env: InstructionsClientEnv = process.env): boolean {
  return !hasInstructionsEnvAuthorityIntent(env) && isInstructionsLocalOptIn(env);
}

/**
 * The environment as the resolver should see it: every authority/credential
 * variable that is DECLARED BUT BLANK removed.
 *
 * A blank has always been this package's spelling for "not configured" — it is
 * how fixtures scrub an inherited environment. @hasna/contracts takes the
 * opposite view: a declared-but-blank credential is a misconfiguration it
 * refuses loudly rather than resolving around. Both are right at their own
 * layer, and the mismatch is not hypothetical: an environment carrying a real
 * `HASNA_INSTRUCTIONS_API_KEY` alongside a blank legacy alias is a complete,
 * unambiguous configuration that would otherwise be refused for the alias
 * nobody set. Normalising here keeps "blank means unset" true at the
 * Instructions seam while leaving the resolver's stricter rule intact for
 * everything it does receive.
 */
export function instructionsResolverEnv<T extends InstructionsClientEnv>(env: T): T {
  const blanks = instructionsAuthorityEnvKeys().filter(
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

/** Is this the environment the machine's ambient credential stores belong to? */
function isAmbientInstructionsEnv(env: InstructionsClientEnv): boolean {
  if (typeof process !== "undefined" && (env as unknown) === (process.env as unknown)) return true;
  return (env as unknown as Record<symbol, unknown>)[CONTRACTS_AMBIENT_ENVIRONMENT] === true;
}

/** The env object and credential options a surface hands @hasna/contracts. */
export interface InstructionsResolverInputs<T extends InstructionsClientEnv> {
  /** The environment with every declared-but-blank authority variable removed. */
  env: T;
  /** The chain options, with the Keychain tier's ambient gate already decided. */
  credentials: InstructionsCredentialChainOptions;
}

/**
 * Build the resolver's inputs: the normalised environment AND the credential
 * options that keep the machine's Keychain tier reachable across it.
 *
 * WHY THIS IS NOT JUST {@link instructionsResolverEnv}. Blanking a variable and
 * deleting it are not the same operation to @hasna/contracts, because dropping
 * a key forces us to hand the resolver a COPY, and the resolver gates its
 * ambient tiers on OBJECT IDENTITY (`env === process.env`, or the registry
 * symbol its own snapshot carries). A copy is, by that test, a caller-built
 * world — the hermetic seam — so the Keychain is outside it and tier 3 turns
 * itself off. Silently: there is no error, no warning and no diagnostic,
 * because from the resolver's side nothing went wrong (hasna/apps#1788).
 *
 * The consequence is the one failure this whole ruling exists to prevent. On a
 * station whose Keychain holds `hasna.credentials.instructions.api-key`, ONE
 * declared-but-blank authority variable — any name in
 * {@link instructionsAuthorityEnvKeys}, canonical or legacy; the shape a
 * scrubbed fixture leaves behind — dropped the run from the Keychain identity
 * to whatever came next: to `~/.hasna/instructions/config/credentials`, a
 * DIFFERENT principal, with no notice; or, with nothing on disk, to a bare
 * fail-closed error on a station that is in fact configured. A deliberate tier
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
export function instructionsResolverInputs<T extends InstructionsClientEnv>(
  env: T,
  credentials: InstructionsCredentialChainOptions = {},
): InstructionsResolverInputs<T> {
  const normalised = instructionsResolverEnv(env);
  // Identity survived: the resolver can run its own ambient test as usual.
  if (normalised === env) return { env: normalised, credentials };
  const keychain = { ...credentials.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientInstructionsEnv(env);
  }
  return { env: normalised, credentials: { ...credentials, keychain } };
}