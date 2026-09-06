/**
 * The routing preamble every surface runs before the credential chain: "did the
 * environment configure a mementos authority, and if not, did the operator ask
 * for the on-box store?"
 *
 * It lives in one leaf module because the CLI, the MCP server and the `./sdk`
 * all have to answer identically — a second spelling is a second thing that can
 * drift — and because the SDK must be able to ask without pulling the CLI's
 * transport world into a zero-dependency bundle. Its only import is the
 * env-key derivation from @hasna/contracts, so the NAMES it looks for are the
 * resolver's own rather than a copy that can fall behind.
 *
 * SINCE 2026-09-04 (hasna/apps#1720) every hosted Hasna CLI resolves its
 * credential and its service authority through the ONE resolver in
 * `@hasna/contracts/client`. mementos contributes no tier of its own: no
 * `~/.hasna/fleet-env`, no `~/.hasna/cloud`, no `~/.config/hasna`, no
 * `$XDG_CONFIG_HOME`, no credential in `~/.mementos/config.json`, and no
 * `*_MODE` / `*_STORAGE_MODE` switch (the retired storage-mode variables are
 * inert; nothing reads them). The chain, resolved fresh on every call:
 *
 *   1. an explicit argument      — `credentials.apiKey` / `credentials.profile`
 *   2. a deliberate env pointer  — `HASNA_MEMENTOS_API_KEY_OVERRIDE`,
 *                                  `HASNA_PROFILE`, `HASNA_MEMENTOS_API_KEY_REF`
 *   3. the macOS Keychain        — `hasna.credentials.mementos.api-key`,
 *                                  account `HASNA_STATION` → `hostname -s` → `USER`
 *   4. disk                      — `~/.hasna/mementos/config/credentials`
 *                                  (owner-only 0400/0600; `HASNA_HOME` /
 *                                  `HASNA_CONFIG_HOME` move the root)
 *   5. `HASNA_MEMENTOS_API_KEY`  — a legitimate tier below disk, no deprecation
 *                                  notice
 *
 * with the authority following `HASNA_MEMENTOS_API_URL`, the Keychain
 * `api-url` item, the credentials file, and finally the fleet gateway
 * `https://api.hasna.com/mementos` (the client appends `/v1` — a credential
 * alone is a complete configuration). The legacy unprefixed `MEMENTOS_*`
 * spellings survive only as the resolver's silent alias fallback for one
 * release; every message here names the canonical `HASNA_MEMENTOS_*` names.
 *
 * LOCAL MODE IS DELIBERATE, NEVER A FALLBACK FROM FAILURE. The on-box SQLite
 * store is reachable ONLY through the deliberate unhosted opt-in:
 * `HASNA_MEMENTOS_DB_PATH` / `MEMENTOS_DB_PATH` (an explicit file — the
 * narrowest, most specific signal, and the precedence-1 local selector the
 * package has documented since 2026-08-03) or `HASNA_MEMENTOS_LOCAL=1` (alias
 * `MEMENTOS_LOCAL=1`). Hosted mode with no credential exits non-zero with one
 * clear line; there is no SQLite fallback and no `*-local-fallback` event.
 *
 * ORDER, AND WHY IT IS THIS WAY ROUND. A configured environment outranks the
 * flag opt-in: a run with `HASNA_MEMENTOS_API_KEY` set goes hosted (and a
 * half-configured one fails loudly) rather than quietly serving a different
 * dataset because a stale `HASNA_MEMENTOS_LOCAL` was lying around. But when
 * the environment configures nothing, the opt-in is answered WITHOUT calling
 * the resolver at all — no Keychain item and no credential file is read — and
 * that is what lets the test suite still promise that a scrubbed test
 * environment physically cannot reach the shared store, now that a credential
 * can arrive from somewhere an env dictionary cannot blank.
 *
 * `MEMENTOS_DB_PATH` is the one deliberate exception to "the flag loses to a
 * configured environment": an explicit file path has always outranked even a
 * complete API configuration (getApiConfig precedence 1), because it is the
 * operator saying "THIS file, on THIS box" — the same narrowest-signal rule
 * `~/.hasna/conversations` settled on. It is answered before the resolver too.
 */
import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "@hasna/contracts/client";
import type { CredentialChainOptions } from "@hasna/contracts/client";

/** The deliberate unhosted opt-in flag, canonical name first. */
export const MEMENTOS_LOCAL_OPT_IN_ENV_KEYS = ["HASNA_MEMENTOS_LOCAL", "MEMENTOS_LOCAL"] as const;

/** The explicit local SQLite file — the narrowest signal, precedence 1. */
export const MEMENTOS_DB_PATH_ENV_KEYS = ["HASNA_MEMENTOS_DB_PATH", "MEMENTOS_DB_PATH"] as const;

/**
 * The retired storage-mode variables. The resolver never reads them — they are
 * inert since the adoption stripped the fail-loud ratchet — but test harnesses
 * DELETE them so a fixture can never depend on a stale fragment from the host
 * environment, and docs list them as removed.
 */
export const REMOVED_MEMENTOS_MODE_ENV_KEYS = [
  "HASNA_MEMENTOS_STORAGE_MODE",
  "HASNA_MEMENTOS_MODE",
  "MEMENTOS_STORAGE_MODE",
  "MEMENTOS_MODE",
] as const;

export type MementosLocalOptInEnv = Record<string, string | undefined>;

/** True when the operator deliberately asked for the unhosted local store. */
export function isMementosLocalOptIn(env: MementosLocalOptInEnv = process.env): boolean {
  return MEMENTOS_LOCAL_OPT_IN_ENV_KEYS.some((key) => (env[key] ?? "").trim() !== "");
}

/** True when the environment pins an explicit local SQLite file. */
export function hasExplicitLocalDbPath(env: MementosLocalOptInEnv = process.env): boolean {
  return MEMENTOS_DB_PATH_ENV_KEYS.some((key) => (env[key] ?? "").trim() !== "");
}

/** Every env name that can configure a mementos authority or credential, resolver-derived. */
export function mementosAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys("mementos");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("mementos"),
    credentialPointerEnvKey("mementos"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * Does the ENVIRONMENT itself configure a mementos authority or credential?
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
export function hasMementosEnvAuthorityIntent(env: MementosLocalOptInEnv = process.env): boolean {
  return mementosAuthorityEnvKeys().some((key) => (env[key] ?? "").trim() !== "");
}

/**
 * True when this environment should be served by the on-box SQLite store.
 *
 * An explicit DB path wins unconditionally (precedence 1 — the narrowest
 * signal). The flag opt-in wins only when the environment configures no
 * authority or credential at all, and both are answered WITHOUT the resolver,
 * so the Keychain and the credential file are never read for a local run.
 */
export function selectsMementosLocalStore(env: MementosLocalOptInEnv = process.env): boolean {
  if (hasExplicitLocalDbPath(env)) return true;
  return !hasMementosEnvAuthorityIntent(env) && isMementosLocalOptIn(env);
}

/**
 * The environment as the resolver should see it: every authority/credential
 * variable that is DECLARED BUT BLANK removed.
 *
 * A blank has always been this package's spelling for "not configured" — it is
 * how fixtures scrubbed an inherited environment and how the CLI's test
 * harnesses neutralise routing. @hasna/contracts takes the opposite and, for
 * its purposes, correct view: a declared-but-blank credential is a
 * misconfiguration it refuses loudly rather than resolving around, because a
 * blank that fell through would authenticate as a different principal than the
 * operator named.
 *
 * Both are right at their own layer, and the mismatch is not hypothetical: an
 * environment carrying a real `HASNA_MEMENTOS_API_KEY` alongside a blank legacy
 * alias — the exact shape a scrubbed-then-overridden fixture produces — is a
 * complete, unambiguous configuration that would otherwise be refused for the
 * alias nobody set. Normalising here keeps "blank means unset" true at the
 * mementos seam while leaving the resolver's stricter rule intact for
 * everything it does receive.
 */
export function mementosResolverEnv<T extends MementosLocalOptInEnv>(env: T): T {
  const blanks = mementosAuthorityEnvKeys().filter(
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
function isAmbientMementosEnv(env: MementosLocalOptInEnv): boolean {
  if (typeof process !== "undefined" && (env as unknown) === (process.env as unknown)) return true;
  return (env as unknown as Record<symbol, unknown>)[CONTRACTS_AMBIENT_ENVIRONMENT] === true;
}

/** The env object and credential options a mementos surface hands @hasna/contracts. */
export interface MementosResolverInputs<T extends MementosLocalOptInEnv> {
  /** The environment with every declared-but-blank authority variable removed. */
  env: T;
  /** The chain options, with the Keychain tier's ambient gate already decided. */
  credentials: CredentialChainOptions;
}

/**
 * Build the resolver's inputs: the normalised environment AND the credential
 * options that keep the machine's Keychain tier reachable across it.
 *
 * WHY THIS IS NOT JUST {@link mementosResolverEnv}. Blanking a variable and
 * deleting it are not the same operation to @hasna/contracts, because dropping
 * a key forces us to hand the resolver a COPY, and the resolver gates its
 * ambient tiers on OBJECT IDENTITY (`env === process.env`, or the registry
 * symbol its own snapshot carries). A copy is, by that test, a caller-built
 * world — the hermetic seam — so the Keychain is outside it and tier 3 turns
 * itself off. Silently: there is no error, no warning and no diagnostic,
 * because from the resolver's side nothing went wrong.
 *
 * The consequence is the one failure this whole ruling exists to prevent. On a
 * station whose Keychain holds `hasna.credentials.mementos.api-key`, ONE
 * declared-but-blank authority variable — any name in
 * {@link mementosAuthorityEnvKeys}, canonical or legacy; the shape a scrubbed
 * fixture leaves behind — dropped the run from the Keychain identity to
 * whatever came next: to `~/.hasna/mementos/config/credentials`, a DIFFERENT
 * principal, with no notice; or, with nothing on disk, to a bare refusal on a
 * station that is in fact configured. A deliberate tier must never fall
 * through to another identity, so the gate is decided HERE, on the original
 * env, and carried across the copy as the documented `keychain.enabled`
 * control rather than being left to an identity test the copy cannot pass.
 *
 * An explicit `enabled` from the caller still wins, and an injected `run`
 * (which @hasna/contracts already treats as "enabled") is left alone, so the
 * hermetic seam tests rely on is untouched. When there is no blank to remove
 * the inputs pass through by identity, exactly as before.
 */
export function mementosResolverInputs<T extends MementosLocalOptInEnv>(
  env: T,
  credentials: CredentialChainOptions = {},
): MementosResolverInputs<T> {
  const normalised = mementosResolverEnv(env);
  // Identity survived: the resolver can run its own ambient test as usual.
  if (normalised === env) return { env: normalised, credentials };
  const keychain = { ...credentials.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientMementosEnv(env);
  }
  return { env: normalised, credentials: { ...credentials, keychain } };
}

let localModeNoticePrinted = false;

/** Reset the once-per-process local-mode notice. Test seam only. */
export function __resetMementosLocalModeNotice(): void {
  localModeNoticePrinted = false;
}

/**
 * The one stderr line a local-mode run MUST print (owner ruling 2026-09-04,
 * fail-closed wave): "local" — so a run that is deliberately serving the
 * on-box store can never be mistaken for a hosted one. Printed once per
 * process by every surface (CLI command startup, MCP server startup); a
 * long-lived server that re-resolves per request does not spam the notice.
 * A no-op unless the environment actually selects the on-box store.
 */
export function announceMementosLocalMode(
  env: MementosLocalOptInEnv = process.env,
  stderr: (line: string) => void = (line) => {
    if (typeof process !== "undefined") process.stderr.write(`${line}\n`);
  },
): void {
  if (localModeNoticePrinted) return;
  if (!selectsMementosLocalStore(env)) return;
  const explicitDbPath = MEMENTOS_DB_PATH_ENV_KEYS.find((key) => (env[key] ?? "").trim() !== "");
  const flag = MEMENTOS_LOCAL_OPT_IN_ENV_KEYS.find((key) => (env[key] ?? "").trim() !== "");
  const reason = explicitDbPath
    ? `explicit ${explicitDbPath}`
    : flag
      ? `explicit ${flag}`
      : "nothing configures a mementos authority";
  localModeNoticePrinted = true;
  stderr(`mementos: LOCAL mode — serving the on-box SQLite store (${reason}), not the hosted fleet.`);
}