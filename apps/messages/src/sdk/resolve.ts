/**
 * Credential and authority resolution for every @hasna/messages client surface.
 *
 * ONE resolver, and it is not this file's own. Every hosted Hasna CLI resolves
 * its credential and its service authority through the client seam in
 * `@hasna/contracts/client` (owner ruling 2026-09-04; hasna/apps#1720). This
 * module is the thin messages-shaped adapter over it: it decides only what the
 * shared resolver cannot know — that messages ALSO has an on-box SQLite store,
 * and in which runs serving from it is legitimate.
 *
 * THE CREDENTIAL LADDER (resolved fresh on every call, by the shared resolver):
 *   1. an explicit argument            — `--api-key` / `--profile`
 *   2. a deliberate env pointer        — HASNA_MESSAGES_API_KEY_OVERRIDE,
 *                                        HASNA_PROFILE, HASNA_MESSAGES_API_KEY_REF
 *   3. the macOS Keychain              — `hasna.credentials.messages.api-key`,
 *                                        account HASNA_STATION -> `hostname -s` -> USER
 *   4. disk, read at call time         — ~/.hasna/messages/config/credentials
 *                                        (0400/0600; HASNA_HOME / HASNA_CONFIG_HOME move it)
 *   5. HASNA_MESSAGES_API_KEY          — a legitimate tier, below disk, no notice
 *
 * THE AUTHORITY LADDER: HASNA_MESSAGES_API_URL -> the Keychain `api-url` item
 * -> the credentials file -> the fleet gateway `https://api.hasna.com/messages`
 * (the client appends `/v1`). A URL never needs configuring: a key from any
 * tier is enough to reach the fleet. The unprefixed `MESSAGES_API_URL` /
 * `MESSAGES_API_KEY` spellings survive only as the shared resolver's silent
 * alias fallback, BELOW the canonical names — they never outrank them.
 *
 * STRICT PAIR, NEVER THE OLD LOOSE PAIR. The old chain selected http from
 * `HASNA_MESSAGES_API_URL` alone and treated the key as optional. That is gone:
 * a configured authority with no resolvable credential is a HARD ERROR,
 * refusing to create an unauthenticated client — a hosted process with a half
 * configuration fails loudly instead of talking to the fleet unauthenticated
 * (or, once, silently serving stale local data). The resolver enforces it: it
 * throws before any client is built, no SQLite file is opened, and no
 * `*-local-fallback` event exists.
 *
 * LOCAL MODE IS A DELIBERATE OPT-IN, NEVER A FALLBACK FROM FAILURE. The
 * on-box SQLite store is reachable ONLY when the environment configures no
 * authority and no credential AND the operator set `HASNA_MESSAGES_LOCAL=1`
 * (alias `MESSAGES_LOCAL=1`). It is answered BEFORE the resolver runs, so an
 * unhosted run reads neither the Keychain nor the credential file, and it
 * announces itself once, on stderr, so "local" is never a silent state.
 *
 * REMOVED, and never inputs again: the `*_MODE` / `*_STORAGE_MODE` selectors,
 * the `HASNA_MESSAGES_LOCAL_MODE_ENV` spelling of the opt-in, and every
 * `~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna` location — the
 * shared resolver refuses those paths on the app's behalf, and the disk tier
 * reads exactly one file: `~/.hasna/messages/config/credentials`.
 */
import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
  defaultFleetGatewayBaseUrl,
  resolveClientTransport,
  resolveCredential,
  toV1BaseUrl,
} from "@hasna/contracts/client";
import type {
  CredentialChainOptions,
  KeychainTierOptions,
} from "@hasna/contracts/client";
import type {
  MessagesClientEnv,
  MessagesClientResolveOptions,
  MessagesClientTransportReport,
  MessagesCredentialChainOptions,
  MessagesCredentialTier,
  MessagesKeychainTierOptions,
  MessagesResolvedCredential,
} from "./client-types.js";
import { MESSAGES_LOCAL_OPT_IN_ENV_KEYS } from "./client-types.js";

/** The app slug the shared resolver keys this app's chain on. */
export const MESSAGES_APP_SLUG = "messages";

/** The env-key spec the resolver derives for this app (canonical + one alias). */
const ENV_KEYS = clientTransportEnvKeys(MESSAGES_APP_SLUG);

/** Canonical client variables, resolver-derived. The first name always wins. */
export const MESSAGES_API_URL_ENV_KEYS = Object.freeze([...ENV_KEYS.apiUrlKeys]) as readonly string[];
export const MESSAGES_API_KEY_ENV_KEYS = Object.freeze([...ENV_KEYS.apiKeyKeys]) as readonly string[];
export const MESSAGES_API_URL_ENV = MESSAGES_API_URL_ENV_KEYS[0]!;
export const MESSAGES_API_KEY_ENV = MESSAGES_API_KEY_ENV_KEYS[0]!;
export const MESSAGES_DATABASE_URL_ENV = "HASNA_MESSAGES_DATABASE_URL";
export const MESSAGES_SQLITE_PATH_ENV = "HASNA_MESSAGES_SQLITE_PATH";

/** `https://api.hasna.com/messages` — the default authority; `/v1` is appended by the client. */
export const MESSAGES_DEFAULT_API_URL = defaultFleetGatewayBaseUrl(MESSAGES_APP_SLUG);

/**
 * Removed selector names, preserved only as documentation. The old chain had
 * exactly one opt-in switch, `HASNA_MESSAGES_LOCAL`; it is reprised below as
 * {@link MESSAGES_LOCAL_OPT_IN_ENV_KEYS} with the same semantics — an EXPLICIT
 * unhosted opt-in, not a mode switch — and its `*_MODE_ENV` constant name is
 * gone. The fleet's `*_MODE` / `*_STORAGE_MODE` family never existed in this
 * app and selects nothing.
 */
export { MESSAGES_LOCAL_OPT_IN_ENV_KEYS } from "./client-types.js";

/** True when the operator deliberately asked for the on-box SQLite store. */
export function isMessagesLocalOptIn(env: MessagesClientEnv = process.env): boolean {
  return MESSAGES_LOCAL_OPT_IN_ENV_KEYS.some((key) => {
    const raw = env[key];
    if (raw === undefined) return false;
    const value = raw.trim().toLowerCase();
    return !(value === "" || value === "0" || value === "false" || value === "no" || value === "off");
  });
}

/** Every env name that can configure a messages authority or credential, resolver-derived. */
export function messagesAuthorityEnvKeys(): string[] {
  return [
    ...ENV_KEYS.apiUrlKeys,
    ...ENV_KEYS.apiKeyKeys,
    credentialOverrideEnvKey(MESSAGES_APP_SLUG),
    credentialPointerEnvKey(MESSAGES_APP_SLUG),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * Does the ENVIRONMENT itself configure a messages authority or credential?
 *
 * Deliberately narrower than "does a credential resolve": answering it must not
 * touch the Keychain or the filesystem, because doing so would defeat the
 * isolation the opt-in short-circuit exists to provide. It reads the env
 * dictionary and nothing else.
 *
 * A DECLARED-BUT-BLANK variable counts as absent HERE — a blank has always been
 * this package's spelling for "not configured". It is NOT absent once we do go
 * hosted: the resolver refuses a blank loudly rather than falling through to
 * another identity, which is the behaviour that matters at that point.
 */
export function hasMessagesEnvAuthorityIntent(env: MessagesClientEnv = process.env): boolean {
  return messagesAuthorityEnvKeys().some((key) => (env[key] ?? "").trim() !== "");
}

/** True when the on-box SQLite store applies: the explicit opt-in, and nothing configured. */
export function selectsMessagesLocalStore(env: MessagesClientEnv = process.env): boolean {
  return !hasMessagesEnvAuthorityIntent(env) && isMessagesLocalOptIn(env);
}

/**
 * The environment as the resolver should see it: every authority/credential
 * variable that is DECLARED BUT BLANK removed.
 *
 * A blank has always been this package's spelling for "not configured" — it is
 * how a scrubbed fixture, a wrapper spelling `HASNA_MESSAGES_API_URL="${MAYBE_UNSET}"`
 * and a half-rotated station fragment express absence. @hasna/contracts takes
 * the opposite and, for its purposes, correct view: a declared-but-blank
 * credential is a misconfiguration it refuses loudly rather than resolving
 * around. Both are right at their own layer, and the mismatch is not
 * hypothetical: an environment carrying a real `HASNA_MESSAGES_API_KEY`
 * alongside a blank legacy alias is a complete, unambiguous configuration that
 * would otherwise be refused for the alias nobody set. Normalising here keeps
 * "blank means unset" true at the messages seam while leaving the resolver's
 * stricter rule intact for everything it does receive.
 *
 * Returns the SAME object when there is nothing to remove — object identity is
 * what keeps the resolver's ambient Keychain tier alive, so the normaliser
 * must never copy eagerly (#1788).
 */
export function messagesResolverEnv<T extends MessagesClientEnv>(env: T): T {
  const blanks = messagesAuthorityEnvKeys().filter(
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
function isAmbientMessagesEnv(env: MessagesClientEnv): boolean {
  if (typeof process !== "undefined" && (env as unknown) === (process.env as unknown)) return true;
  return (env as unknown as Record<symbol, unknown>)[CONTRACTS_AMBIENT_ENVIRONMENT] === true;
}

/** The env object and credential options a messages surface hands @hasna/contracts. */
export interface MessagesResolverInputs<T extends MessagesClientEnv> {
  /** The environment with every declared-but-blank authority variable removed. */
  env: T;
  /** The chain options, with the Keychain tier's ambient gate already decided. */
  credentials: MessagesCredentialChainOptions;
}

/**
 * Build the resolver's inputs: the normalised environment AND the credential
 * options that keep the machine's Keychain tier reachable across it.
 *
 * WHY THIS IS NOT JUST {@link messagesResolverEnv}. Blanking a variable and
 * deleting it are not the same operation to @hasna/contracts, because dropping
 * a key forces us to hand the resolver a COPY, and the resolver gates its
 * ambient tiers on OBJECT IDENTITY (`env === process.env`, or the registry
 * symbol its own snapshot carries). A copy is, by that test, a caller-built
 * world — the hermetic seam — so the Keychain is outside it and tier 3 turns
 * itself off. Silently: there is no error, no warning and no diagnostic,
 * because from the resolver's side nothing went wrong.
 *
 * The consequence is the one failure this whole ruling exists to prevent. On a
 * station whose Keychain holds `hasna.credentials.messages.api-key`, ONE
 * declared-but-blank authority variable dropped the run from the Keychain
 * identity to whatever came next — to `~/.hasna/messages/config/credentials`, a
 * DIFFERENT principal, with no notice; or, with nothing on disk, to a hard
 * refusal on a station that is in fact configured. A deliberate tier must never
 * fall through to another identity, so the gate is decided HERE, on the
 * original env, and carried across the copy as the documented `keychain.enabled`
 * control rather than being left to an identity test the copy cannot pass.
 *
 * An explicit `enabled` from the caller still wins, and an injected `run`
 * (which @hasna/contracts already treats as "enabled") is left alone, so the
 * hermetic seam tests rely on is untouched. When there is no blank to remove
 * the inputs pass through by identity, exactly as before.
 */
export function messagesResolverInputs<T extends MessagesClientEnv>(
  env: T,
  credentials: MessagesCredentialChainOptions = {},
): MessagesResolverInputs<T> {
  const normalised = messagesResolverEnv(env);
  if (normalised === env) return { env: normalised, credentials };
  const keychain = { ...credentials.keychain };
  if (keychain.enabled === undefined && keychain.run === undefined) {
    keychain.enabled = isAmbientMessagesEnv(env);
  }
  return { env: normalised, credentials: { ...credentials, keychain } };
}

/** Translate a locally-spelled keychain seam into the resolver's own shape. */
function resolverKeychain(
  keychain: MessagesKeychainTierOptions | undefined,
): KeychainTierOptions | undefined {
  if (!keychain) return undefined;
  return {
    ...keychain,
    run: keychain.run as KeychainTierOptions["run"],
  } as KeychainTierOptions;
}

/** Translate a locally-spelled credential/option set into the resolver's own shape.
 * `options.credentials` merges wholesale; a top-level `options.apiKey` (the
 * CLI's `--api-key`) overrides the same field inside it. */
export function resolverCredentialOptions(
  options: MessagesClientResolveOptions,
): MessagesCredentialChainOptions {
  const merged: MessagesCredentialChainOptions = {
    ...options.credentials,
    ...(options.credentials?.keychain
      ? { keychain: resolverKeychain(options.credentials.keychain) }
      : {}),
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
  };
  return merged;
}

/** The fail-closed error: the resolver's own refusal plus the local opt-in. */
export function messagesUnconfiguredError(cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    `${detail} ${MESSAGES_LOCAL_OPT_IN_ENV_KEYS[0]}=1 selects the on-box SQLite store (local mode), ` +
      `but only when no authority or credential is configured.`,
  );
}

/** The one line a local run prints, so an unhosted run can never be mistaken for a hosted one. */
export function messagesLocalModeNotice(): string {
  return (
    `messages: local mode (${MESSAGES_LOCAL_OPT_IN_ENV_KEYS[0]}=1) — using the on-box SQLite store; ` +
    `the hosted messages fleet is not contacted. Set a credential (Keychain item ` +
    `hasna.credentials.messages.api-key, ~/.hasna/messages/config/credentials, or ${MESSAGES_API_KEY_ENV}) ` +
    `to go hosted.`
  );
}

let localModeAnnounced = false;

/** Test seam: forget that the local-mode line was printed. */
export function resetMessagesLocalModeNotice(): void {
  localModeAnnounced = false;
}

/** Announce the on-box store once per process, on stderr. Never silent. */
export function announceMessagesLocalMode(): void {
  if (localModeAnnounced) return;
  localModeAnnounced = true;
  console.error(messagesLocalModeNotice());
}

/** `https://api.hasna.com/messages/v1` minus the `/v1` suffix — the authority origin + prefix. */
export function stripV1FromApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/**
 * Resolve the client connection through the shared @hasna/contracts resolver.
 *
 * Explicit authority/credential arguments are tier 1 and outrank everything.
 * Otherwise: the explicit local opt-in (with nothing configured) selects the
 * on-box store, announced once on stderr; otherwise the shared resolver
 * resolves the credential (any tier) and the authority (any tier, else the
 * fleet gateway); any refusal THROWS — a configured authority with no
 * credential is a hard error, never a silent drop onto the on-box store.
 *
 * Every call re-resolves: the Keychain and the credential file are read at
 * call time, so a rotation heals a long-lived process without a rebuild.
 */
export function resolveMessagesClientTransport(
  env: MessagesClientEnv = process.env,
  options: MessagesClientResolveOptions = {},
): MessagesClientTransportReport {
  // Tier 1: an explicit authority is a deliberate selection and is never
  // resolved around. It pins the credential too (#1794): without an explicit
  // apiKey, NO ambient credential applies to an authority the caller named.
  if (options.baseUrl !== undefined) {
    const apiUrl = toV1BaseUrl(options.baseUrl);
    const pinnedKey = options.apiKey !== undefined && options.apiKey.trim() !== "";
    return {
      transport: "http",
      source: "explicit baseUrl argument",
      baseUrl: apiUrl,
      configuredApiBase: options.baseUrl.trim().replace(/\/+$/, ""),
      apiUrlPresent: true,
      apiUrlSource: "explicit baseUrl argument",
      apiKeyPresent: pinnedKey,
      apiKeySource: pinnedKey ? "explicit apiKey argument" : null,
      apiKeyTier: pinnedKey ? ("argument" as MessagesCredentialTier) : null,
      warning: null,
      localOptIn: false,
      authorityPinned: true,
    };
  }

  // The on-box store is reachable ONLY under the explicit opt-in, answered
  // from the env dictionary alone — no Keychain item and no credential file is
  // read for it (the isolation guarantee).
  if (selectsMessagesLocalStore(env)) {
    announceMessagesLocalMode();
    return {
      transport: "local",
      source: "local-opt-in",
      baseUrl: null,
      configuredApiBase: null,
      apiUrlPresent: false,
      apiUrlSource: null,
      apiKeyPresent: false,
      apiKeySource: null,
      apiKeyTier: null,
      warning: null,
      localOptIn: true,
      authorityPinned: false,
    };
  }

  // Otherwise the shared resolver decides — and any refusal is a throw: no
  // unauthenticated client, no local fallback, no fallback event.
  const requestedCredentials = resolverCredentialOptions(options);
  const { env: resolverEnv, credentials } = messagesResolverInputs(env, requestedCredentials);
  let resolution: ReturnType<typeof resolveClientTransport>;
  try {
    resolution = resolveClientTransport(MESSAGES_APP_SLUG, resolverEnv, { credentials });
  } catch (error) {
    throw messagesUnconfiguredError(error);
  }
  return {
    transport: "http",
    source: resolution.apiKeySource ?? resolution.apiUrlSource ?? "default",
    baseUrl: resolution.baseUrl,
    configuredApiBase: resolution.apiUrlSource && resolution.apiUrlSource !== "default"
      ? stripV1FromApiUrl(resolution.baseUrl)
      : null,
    apiUrlPresent: resolution.apiUrlSource !== null && resolution.apiUrlSource !== "default",
    apiUrlSource: resolution.apiUrlSource,
    apiKeyPresent: resolution.apiKeyPresent,
    apiKeySource: resolution.apiKeySource,
    apiKeyTier: resolution.apiKeyTier as MessagesCredentialTier,
    warning: resolution.warning,
    localOptIn: false,
    authorityPinned: false,
  };
}

/**
 * The transport this environment selects, or null under the explicit local
 * opt-in. THROWS when nothing resolves: hosted with no credential is a hard
 * error (`messages status` is the surface that reports it as `unconfigured`).
 */
export function resolveMessagesCredential(
  env: MessagesClientEnv = process.env,
  options: MessagesClientResolveOptions = {},
): MessagesResolvedCredential | null {
  if (options.apiKey !== undefined) {
    const trimmed = options.apiKey.trim();
    if (!trimmed) {
      throw new Error("messages: --api-key was given but is blank; refusing to resolve around it.");
    }
    return {
      apiKey: trimmed,
      tier: "argument",
      source: "explicit apiKey argument",
      deliberate: true,
      diskCandidates: [],
      warning: null,
    };
  }
  const requestedCredentials = resolverCredentialOptions(options);
  const { env: resolverEnv, credentials } = messagesResolverInputs(env, requestedCredentials);
  const resolved = resolveCredential(MESSAGES_APP_SLUG, resolverEnv, credentials);
  return resolved ? (resolved as MessagesResolvedCredential) : null;
}