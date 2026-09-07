/**
 * The one place this package decides WHICH Skills service it talks to and WITH
 * WHICH credential.
 *
 * Everything here delegates to the shared client seam in `@hasna/contracts/client`
 * (owner rulings 2026-09-04 — hasna/apps#1720, #1668, #1690, #1613, #1599). This
 * package owns no second copy of the ladder, and no alias env name of its own.
 *
 * CREDENTIAL, resolved fresh on every call (contracts `resolveCredential`):
 *
 *   1. an explicit argument            — `--api-key`, `--profile`
 *   2. a deliberate env pointer        — `HASNA_SKILLS_API_KEY_OVERRIDE`,
 *                                        `HASNA_PROFILE`, `HASNA_SKILLS_API_KEY_REF`
 *
 *      `HASNA_SKILLS_API_KEY_REF` names a VAULT ITEM rather than a key, so it
 *      resolves in two steps: the synchronous chain yields the pointer, and
 *      `resolveSkillsApiKey()` (async) fetches the value through the secrets
 *      SDK on each call. Never treat the pointer's own `apiKey` — the empty
 *      string — as a credential; `resolveSkillsFleet` reports null for it.
 *   3. the macOS Keychain              — generic-password `hasna.credentials.skills.api-key`,
 *                                        account `HASNA_STATION`, else `hostname -s`, else `USER`
 *   4. disk, read at call time         — `~/.hasna/skills/config/credentials`
 *                                        (`HASNA_HOME` / `HASNA_CONFIG_HOME` relocate it; XDG never)
 *   5. `HASNA_SKILLS_API_KEY` in the environment — a legitimate tier, below disk,
 *                                        and carrying no deprecation notice
 *
 * URL: `HASNA_SKILLS_API_URL` → the Keychain `api-url` item → the credentials
 * file → the fleet gateway `https://api.hasna.com/skills`. The gateway default
 * applies ONLY once a credential has resolved, so an install with no credential
 * still names no host at all (the R1 boundary in vendor-host-policy.ts).
 *
 * The unprefixed `SKILLS_API_URL` / `SKILLS_API_KEY` spellings are still
 * accepted, silently, because the shared seam accepts `<APP>_API_URL` /
 * `<APP>_API_KEY` as documented aliases one rung below the canonical
 * `HASNA_SKILLS_*` names. They are documented in the README for one release and
 * are not read anywhere else in this package. `SKILL_API_KEY` (singular) is
 * gone: it shadowed nothing canonical and was never documented.
 *
 * THIRD: the local run is opt-in only (owner ruling 2026-09-04, hasna/apps#1720;
 * class-patch order 2026-09-06). `HASNA_SKILLS_LOCAL=1` (alias `SKILLS_LOCAL=1`)
 * selects the on-machine run when the ENVIRONMENT configures no authority; it is
 * answered before the resolver runs, so opting in never reads the Keychain or
 * the credentials file. A configured environment always outranks it. The
 * outcomes, and no fourth:
 *
 *   - the local opt-in selected        → LOCAL, announced once on stderr.
 *   - a credential resolves            → HOSTED. The authority is the configured
 *                                        URL, else the fleet gateway. A credential
 *                                        that cannot produce a usable key — a
 *                                        deliberate selection contracts refuses, a
 *                                        pointer whose vault item is missing, any
 *                                        tier that yields a blank value — is a LOUD
 *                                        failure, never a demotion to local.
 *   - no credential, but a URL is configured
 *                                      → LOUD failure. The caller exits non-zero
 *                                        with one line naming what is missing.
 *                                        There is no local fallback here: serving
 *                                        local results while authentication is
 *                                        unconfigured is a false green.
 *   - neither a credential nor a URL, and no opt-in
 *                                      → LOUD failure, exit non-zero, no SQLite,
 *                                        no *-local-fallback event. Running on
 *                                        this machine is a deliberate choice now,
 *                                        not the silence that follows a missing
 *                                        credential.
 */

import {
  ClientTransportConfigurationError,
  CredentialResolutionError,
  appConfigDiskValue,
  clientTransportEnvKeys,
  completePointerCredential,
  defaultFleetGatewayBaseUrl,
  credentialPointerEnvKey,
  keychainConfigValue,
  resolveCredential,
  toV1BaseUrl,
} from "@hasna/contracts/client";
import type { CredentialChainOptions, CredentialTier, KeychainTierOptions, ResolvedCredential } from "./client-types.js";
import { captureSkillsCredentialFiles, readSkillsInstanceMetadata, selectedSkillsProfile, skillsProfileCredentialFiles } from "./instance-credentials.js";
import { isSkillsLocalOptIn, selectsSkillsLocalMode, SKILLS_LOCAL_OPT_IN_ENV_KEYS } from "./local-opt-in.js";

/** The app slug: the Keychain service, the `~/.hasna/<app>` folder, the gateway path. */
export const SKILLS_APP = "skills";

/** The deliberate unhosted opt-in env names. Re-exported for the surfaces that have to name them. */
export { SKILLS_LOCAL_OPT_IN_ENV_KEYS, isSkillsLocalOptIn, selectsSkillsLocalMode } from "./local-opt-in.js";

type Env = Record<string, string | undefined>;

const ENV_KEYS = clientTransportEnvKeys(SKILLS_APP);

/** `HASNA_SKILLS_API_URL`, then the accepted `SKILLS_API_URL` alias. */
export const SKILLS_API_URL_ENV_KEYS: readonly string[] = ENV_KEYS.apiUrlKeys;
/** `HASNA_SKILLS_API_KEY`, then the accepted `SKILLS_API_KEY` alias. */
export const SKILLS_API_KEY_ENV_KEYS: readonly string[] = ENV_KEYS.apiKeyKeys;

/** The canonical spellings, for messages that have to name exactly one. */
export const SKILLS_API_URL_ENV = SKILLS_API_URL_ENV_KEYS[0] as string;
export const SKILLS_API_KEY_ENV = SKILLS_API_KEY_ENV_KEYS[0] as string;

export interface SkillsFleetOptions {
  /** Tier-1 credential inputs and the Keychain-tier controls (a fake runner in tests). */
  credentials?: CredentialChainOptions;
}

/** A hosted resolution: an authority to call and a credential to call it with. */
export interface HostedSkillsFleet {
  mode: "hosted";
  /** Origin the CLI/SDK sends requests to. Never carries a trailing slash. */
  apiOrigin: string;
  /**
   * The resolved key, or null when the credential is a vault POINTER
   * (`HASNA_SKILLS_API_KEY_REF` / a `credential_ref` line) that only the async
   * path can complete — see {@link apiKeyPointer} and {@link resolveSkillsApiKey}.
   *
   * It is NEVER the empty string: a blank key would produce
   * `Authorization: Bearer ` on the wire, and — read as falsy by a caller
   * looking for "is there a token" — a silent drop back to local data. Both
   * are refused at resolution time instead.
   *
   * Never logged, never written anywhere but the header.
   */
  apiKey: string | null;
  /**
   * The unresolved vault pointer, when tier === "pointer"; null otherwise.
   *
   * `resolveCredential` returns a TRUTHY credential for the pointer tier whose
   * `apiKey` is empty and whose `pointerVaultKey` names the vault item;
   * fetching that item is a separate async step. Carrying the pointer (rather
   * than its empty key) is what keeps the sending paths honest.
   */
  apiKeyPointer: ResolvedCredential | null;
  /** WHERE the URL came from: an env key NAME, a Keychain reference, a path, or "default". */
  apiUrlSource: string;
  /** WHERE the key came from: an env key NAME, a Keychain reference, or a path. Never a value. */
  apiKeySource: string;
  apiKeyTier: CredentialTier;
  /** Advisory from the shared seam (never secret), or null. */
  warning: string | null;
}

/** Nothing is configured: this install runs on this machine. */
export interface LocalSkillsFleet {
  mode: "local";
  apiOrigin: null;
  apiKey: null;
}

export type SkillsFleet = HostedSkillsFleet | LocalSkillsFleet;

/** Machine-readable reasons a hosted resolution was refused. */
export type SkillsFleetErrorCode = "MISSING_API_CREDENTIAL" | "INVALID_API_URL" | "INSTANCE_CREDENTIAL_MISMATCH";

/**
 * A configured install could not produce a usable hosted client.
 *
 * `code` is stable so JSON callers can branch on it, and distinguishes the two
 * refusals that are NOT the same fault: an authority with no credential
 * (MISSING_API_CREDENTIAL) versus an authority that is declared but unusable
 * (INVALID_API_URL). MISSING_API_URL stays the code for "nothing configured at
 * all" (see MissingSkillsFleetError), which is a third, non-error state for the
 * commands that may run locally.
 */
export class SkillsFleetCredentialError extends Error {
  readonly code: SkillsFleetErrorCode;

  constructor(message: string, code: SkillsFleetErrorCode = "MISSING_API_CREDENTIAL") {
    super(message);
    this.name = "SkillsFleetCredentialError";
    this.code = code;
  }
}

/** True for the shared seam's configuration error, across bundle boundaries. */
function isClientTransportConfigurationError(error: unknown): boolean {
  return (
    error instanceof ClientTransportConfigurationError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "ClientTransportConfigurationError")
  );
}

/** True for the shared seam's credential error, across bundle boundaries. */
function isCredentialResolutionError(error: unknown): boolean {
  return (
    error instanceof CredentialResolutionError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "CredentialResolutionError")
  );
}

/** True for this package's own refusal, across bundle boundaries. */
function isSkillsFleetCredentialError(error: unknown): boolean {
  return (
    error instanceof SkillsFleetCredentialError ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: unknown }).name === "SkillsFleetCredentialError")
  );
}

/**
 * Translate the shared seam's `CredentialResolutionError` into this package's
 * own refusal, or return null for anything else.
 *
 * A DELIBERATE selection that cannot be honoured — `HASNA_PROFILE` naming a
 * profile that has no entry, an override or pointer that resolves to nothing, a
 * corrupt credentials file — is thrown by `@hasna/contracts`, not by the
 * transport resolver. Left untranslated it escaped every helper in this file:
 * `skillsCredentialOrReason` and `resolveConfiguredRunRouting` recognise only
 * `SkillsFleetCredentialError`, so a `--json` command or an MCP tool got an
 * unhandled exception where the structured refusal was the whole point.
 *
 * The seam's message already names what was attempted and never carries a
 * credential value, so it is kept verbatim.
 */
function asSkillsFleetCredentialError(error: unknown): SkillsFleetCredentialError | null {
  if (!isCredentialResolutionError(error)) return null;
  return new SkillsFleetCredentialError((error as Error).message, "MISSING_API_CREDENTIAL");
}

/**
 * Normalize a configured Skills authority to the origin the client dials.
 *
 * The Skills server serves its API under `/api/v1`, so the client composes
 * `<origin>/api/v1/...` itself. An operator who pasted the full API base — the
 * URL printed by every error message — must not end up with `/api/v1/api/v1`.
 */
export function normalizeSkillsApiOrigin(apiUrl: string): string {
  const url = new URL(apiUrl);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new SkillsFleetCredentialError("A Skills API URL must use HTTPS (or loopback HTTP), without credentials, query or fragment", "INVALID_API_URL");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "/api" || pathname === "/api/v1") {
    url.pathname = "/";
  } else if (pathname.endsWith("/api/v1")) {
    url.pathname = pathname.slice(0, -"/api/v1".length) || "/";
  } else if (pathname.endsWith("/api")) {
    url.pathname = pathname.slice(0, -"/api".length) || "/";
  }
  return url.toString().replace(/\/+$/, "");
}

/** One configured authority: its value and the source that decided it. */
export interface ConfiguredSkillsApiUrl {
  value: string;
  /** An env key NAME, a `keychain:<service>@<account>` reference, or an absolute path. */
  source: string;
}

/**
 * The authority an operator configured, in the shared seam's precedence order —
 * environment, then the Keychain `api-url` item, then the credentials file.
 *
 * Returns null when nothing configures one, which is what lets the gateway
 * default apply for a credentialled install and what keeps an install with no
 * credential from naming a host at all.
 */
export function configuredSkillsApiUrl(
  env: Env = process.env,
  keychain?: KeychainTierOptions,
  profile?: string,
): ConfiguredSkillsApiUrl | null {
  const declared = SKILLS_API_URL_ENV_KEYS.filter(key => env[key] !== undefined).map(key => ({ key, value: env[key]! }));
  for (const entry of declared) {
    if (!entry.value.trim() || /[\x00-\x1f\x7f]/.test(entry.value)) throw new SkillsFleetCredentialError(`${entry.key} is blank or contains control characters`, "INVALID_API_URL");
  }
  const normalized = declared.map(entry => ({ value: normalizeSkillsApiOrigin(entry.value), source: entry.key }));
  if (new Set(normalized.map(entry => entry.value)).size > 1) throw new SkillsFleetCredentialError("Skills API URL aliases disagree", "INVALID_API_URL");
  if (normalized[0]) return normalized[0];
  if (selectedSkillsProfile(env, profile)) {
    for (const file of skillsProfileCredentialFiles(env, profile)) {
      const metadata = readSkillsInstanceMetadata(file);
      if (metadata.apiUrl || metadata.binding) return { value: metadata.apiUrl ?? metadata.binding!, source: file };
    }
    return { value: defaultFleetGatewayBaseUrl(SKILLS_APP), source: "default" };
  }
  const fromKeychain = keychainConfigValue(SKILLS_APP, env, keychain);
  if (fromKeychain) return { value: fromKeychain.value.trim(), source: fromKeychain.source };
  const fromDisk = appConfigDiskValue(SKILLS_APP, env, SKILLS_API_URL_ENV_KEYS);
  if (fromDisk?.unusable) {
    // Declared but blank or malformed. Skipping it would silently demote a
    // configured install to the gateway default — or to local mode — which is
    // the class of silence this ladder exists to remove.
    throw new SkillsFleetCredentialError(
      `${fromDisk.key} in ${fromDisk.path} is declared but blank or malformed; ` +
        `a Skills authority must be a valid https URL (or an exact loopback http URL).`,
      "INVALID_API_URL",
    );
  }
  if (fromDisk) return { value: fromDisk.value.trim(), source: fromDisk.path };
  return null;
}

/** The credential file paths consulted, for a message that has to name them. */
export function skillsCredentialFiles(env: Env = process.env): string[] {
  return skillsProfileCredentialFiles(env);
}

/**
 * Where a credential should be written, and the only file this package writes.
 *
 * Throws when neither HOME nor HASNA_HOME anchors a root, because there is then
 * no correct place to put a secret and guessing one is worse than refusing.
 */
export function skillsCredentialFilePath(env: Env = process.env): string {
  const paths = skillsCredentialFiles(env);
  const path = paths[0];
  if (!path) {
    throw new Error(
      "No home directory is set (HOME or HASNA_HOME), so there is nowhere to store a Skills credential.",
    );
  }
  return path;
}

let localNoticePrinted = false;

/**
 * Say — once per process, on stderr — that this install is running locally.
 *
 * Local mode is legitimate for Skills: the corpus ships in the package. It is a
 * deliberate choice now, though: it is reachable only through the explicit
 * opt-in (`HASNA_SKILLS_LOCAL=1`), and it is still announced, because "no
 * credential resolved" and "deliberately offline" look identical in the output
 * otherwise, and the first one is usually a misconfiguration the operator wants
 * to hear about.
 */
export function noticeLocalSkillsMode(write: (line: string) => void = (line) => console.error(line)): void {
  if (localNoticePrinted) return;
  localNoticePrinted = true;
  write(
    `skills: local mode (${SKILLS_LOCAL_OPT_IN_ENV_KEYS[0]}=1) — running on this machine against the bundled corpus.`,
  );
}

/** Test seam: forget that the local-mode line was printed. */
export function resetLocalSkillsModeNotice(): void {
  localNoticePrinted = false;
}

/**
 * Resolve the service this process should use, fresh.
 *
 * Never returns a hosted resolution without a credential, and never degrades a
 * configured authority to local mode.
 */
export function resolveSkillsFleet(env: Env = process.env, options: SkillsFleetOptions = {}): SkillsFleet {
  try {
    const snapshot = snapshotSkillsEnvironment(env);
    const resolved = resolveSkillsFleetOrThrow(snapshot, snapshotSkillsOptions(env, options));
    if (resolved.mode === "local" && env === process.env) noticeLocalSkillsMode();
    return resolved;
  } catch (error) {
    // Every exit from this function speaks in this package's vocabulary, so the
    // helpers that turn a refusal into data (skillsCredentialOrReason,
    // resolveConfiguredRunRouting) see one error type and never leak a raw
    // contracts error to a --json command or an MCP tool.
    const translated = asSkillsFleetCredentialError(error);
    if (translated) throw translated;
    throw error;
  }
}

/** Capture data properties only; accessor-backed inputs must not rotate routing mid-read. */
function snapshotSkillsEnvironment(env: Env): Env {
  const snapshot: Env = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(env))) {
    if (!("value" in descriptor)) {
      if (/^(?:HASNA_|SKILLS_|HOME$|USER$)/.test(key)) throw new SkillsFleetCredentialError("Accessor-backed Skills configuration is unsupported");
      continue; // Bun exposes unrelated proxy/timezone runtime properties as accessors.
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}
function snapshotSkillsOptions(env: Env, options: SkillsFleetOptions): SkillsFleetOptions {
  // contracts enables the real Keychain only for the ambient environment.
  // Preserve that decision when passing an immutable copy of its values.
  if (env !== process.env) return options;
  return { ...options, credentials: { ...options.credentials, keychain: {
    ...options.credentials?.keychain, enabled: options.credentials?.keychain?.enabled ?? true,
  } } };
}

function resolveSkillsFleetOrThrow(env: Env, options: SkillsFleetOptions): SkillsFleet {
  // THE LOCAL OPT-IN IS ANSWERED FIRST, ON ENV VALUES ALONE (see
  // local-opt-in.ts for why the order is load-bearing in both directions): a
  // run with HASNA_SKILLS_LOCAL=1 and no authority variables never touches the
  // Keychain or the credentials file — and a run without it never lands here
  // silent. An environment that CONFIGURES an authority outranks the opt-in and
  // goes (or fails) hosted instead.
  if (selectsSkillsLocalMode(env)) return { mode: "local", apiOrigin: null, apiKey: null };

  const assertFilesUnchanged = captureSkillsCredentialFiles(skillsProfileCredentialFiles(env, options.credentials?.profile));
  const configured = configuredSkillsApiUrl(env, options.credentials?.keychain, options.credentials?.profile);
  // The released shared resolver owns every credential tier. Resolve it once.
  const credential = resolveCredential(SKILLS_APP, env, options.credentials);
  if (!credential) {
    if (!configured) {
      // Nothing at all: no credential, no authority, no opt-in. Fail closed —
      // the alternative is quietly answering from the bundled corpus for a
      // machine that was never told to serve it.
      throw new SkillsFleetCredentialError(
        `No API key resolved and no Skills API URL is configured — failing closed ` +
          `(local mode is opt-in only: set ${SKILLS_LOCAL_OPT_IN_ENV_KEYS[0]}=1 to run on this machine). ` +
          `Sign in with: skills auth login`,
      );
    }
    throw new SkillsFleetCredentialError(
      `${configured.source} points this CLI at a Skills service but no API key resolved — refusing to run locally instead. ` +
        `Looked in hasna.credentials.skills.api-key, ${skillsCredentialFiles(env).join(" or ") || "no credentials file"}, and ${SKILLS_API_KEY_ENV}. Sign in with: skills auth login`,
    );
  }
  const apiOrigin = normalizeSkillsApiOrigin(configured?.value ?? defaultFleetGatewayBaseUrl(SKILLS_APP));
  // Validate through the released URL primitive. Its transport resolver compares
  // raw /v1 URLs and rereads credentials, so Skills adapts this captured pair to
  // /api/v1 while retaining normalized instance binding and original provenance.
  toV1BaseUrl(apiOrigin);
  assertCredentialInstance(credential, apiOrigin, env, options);
  assertFilesUnchanged();
  const base = {
    mode: "hosted" as const,
    apiOrigin,
    apiUrlSource: configured?.source ?? "default",
    apiKeySource: credential.source,
    apiKeyTier: credential.tier,
    warning: credential.warning,
  };

  if (credential.tier === "pointer") {
    // A vault pointer is a credential the operator DID configure, but its value
    // lives in the secrets vault and only `completePointerCredential` (async)
    // can fetch it. `resolveCredential` reports the pointer as a truthy
    // credential whose `apiKey` is "", and `resolveClientTransport` reports
    // `apiKeyPresent: true` — so publishing that empty string as the key made a
    // configured install LESS safe than an unconfigured one: the read path read
    // it as "no token" and served the bundled local corpus with a zero exit and
    // no notice. The pointer travels instead; resolveSkillsApiKey() completes it.
    return { ...base, apiKey: null, apiKeyPointer: credential };
  }

  if (!credential.apiKey.trim()) {
    // Any other tier that produced a blank value is a refusal, not a key: the
    // alternative is `Authorization: Bearer ` on the wire.
    throw new SkillsFleetCredentialError(
      `The Skills API key from ${credential.source} is empty — refusing to send an unauthenticated request. ` +
        `Sign in with: skills auth login`,
    );
  }

  return { ...base, apiKey: credential.apiKey, apiKeyPointer: null };
}

function assertCredentialInstance(credential: ResolvedCredential, apiOrigin: string, env: Env, options: SkillsFleetOptions): void {
  let bound: string | undefined;
  if (credential.tier === "disk" || credential.tier === "profile") {
    const metadata = readSkillsInstanceMetadata(credential.source);
    bound = metadata.binding ?? metadata.apiUrl ?? defaultFleetGatewayBaseUrl(SKILLS_APP);
  } else if (credential.tier === "keychain") {
    bound = keychainConfigValue(SKILLS_APP, env, options.credentials?.keychain)?.value ?? defaultFleetGatewayBaseUrl(SKILLS_APP);
  }
  if (bound && normalizeSkillsApiOrigin(bound) !== apiOrigin) {
    throw new SkillsFleetCredentialError("The selected Skills API does not match this credential's instance. Select its profile or sign in to the new instance; no credential was sent.", "INSTANCE_CREDENTIAL_MISMATCH");
  }
}

/**
 * The usable API key for this process, completing a vault pointer if that is
 * the tier that won.
 *
 * ASYNC because the pointer tier is: the value is fetched from the secrets
 * vault at call time, so a rotated item is picked up without a restart. Every
 * path that is about to SEND the key resolves it here; the synchronous
 * `resolveSkillsFleet` is for reporting (which tier, which source, which
 * origin), and its `apiKey` is deliberately null for a pointer.
 *
 * Returns null only in local mode. Throws {@link SkillsFleetCredentialError}
 * when a credential is configured and cannot be produced — never a fallback.
 */
export async function resolveSkillsApiKey(
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): Promise<string | null> {
  return (await resolveSkillsConnection(env, options))?.apiKey ?? null;
}

/** Resolve the URL and credential once, including any asynchronous vault lookup. */
export async function resolveSkillsConnection(
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): Promise<(HostedSkillsFleet & { apiKey: string }) | null> {
  const snapshotEnv = snapshotSkillsEnvironment(env);
  const fleet = resolveSkillsFleet(snapshotEnv, snapshotSkillsOptions(env, options));
  if (fleet.mode === "local" && env === process.env) noticeLocalSkillsMode();
  if (fleet.mode !== "hosted") return null;
  if (fleet.apiKey) return { ...fleet, apiKey: fleet.apiKey };

  const pointer = fleet.apiKeyPointer;
  if (!pointer) {
    // Unreachable while the two branches above are exhaustive; kept as a
    // refusal so a future field change cannot yield an unauthenticated client.
    throw new SkillsFleetCredentialError(
      `A Skills authority resolved but no API key did. Sign in with: skills auth login`,
    );
  }

  let completed: ResolvedCredential;
  try {
    completed = await completePointerCredential(SKILLS_APP, pointer, snapshotEnv);
  } catch (error) {
    const translated = asSkillsFleetCredentialError(error);
    if (translated) throw translated;
    throw error;
  }
  if (!completed.apiKey?.trim()) {
    throw new SkillsFleetCredentialError(
      `${credentialPointerEnvKey(SKILLS_APP)} names a vault item that produced an empty Skills API key — ` +
        `refusing to send an unauthenticated request.`,
    );
  }
  return { ...fleet, apiKey: completed.apiKey, apiKeyPointer: null };
}

/** The usable API key, or throw naming what is missing. Use on every send path. */
export async function requireSkillsApiKey(
  action = "This command",
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): Promise<string> {
  const apiKey = await resolveSkillsApiKey(env, options);
  if (!apiKey) throw new MissingSkillsFleetError(action);
  return apiKey;
}

/**
 * The credential for a surface that reports refusals as data (an MCP tool, a
 * `--json` command) rather than as an exception.
 *
 * `reason` is the ladder's own message when a hosted resolution is refused — an
 * authority with no key, or an unconfigured install without the local opt-in
 * (fail-closed ruling) — a refusal carried as a value, NOT a fallback: the
 * caller must still refuse. It is null only when the explicit local opt-in
 * selected the on-machine run, the ordinary "not signed in" case.
 */
export async function skillsCredentialOrReason(
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): Promise<{ apiKey: string; apiOrigin: string; reason: null } | { apiKey: null; apiOrigin: null; reason: string | null }> {
  try {
    // The async resolver, because a vault pointer is only a credential once it
    // has been completed: a surface that reports refusals as data must report
    // a broken pointer as a refusal, not as "not signed in".
    const connection = await resolveSkillsConnection(env, options);
    return connection ? { apiKey: connection.apiKey, apiOrigin: connection.apiOrigin, reason: null } : { apiKey: null, apiOrigin: null, reason: null };
  } catch (error) {
    if (isSkillsFleetCredentialError(error)) {
      return { apiKey: null, apiOrigin: null, reason: (error as Error).message };
    }
    throw error;
  }
}

/**
 * The authority alone, for a flow that is ACQUIRING a credential.
 *
 * `skills auth login` cannot require a credential — obtaining one is the point —
 * so it resolves the AUTHORITY on its own: the configured URL (environment,
 * Keychain, credentials file), else the authority a resolved credential implies.
 * With neither, this returns null and the caller fails loudly: R1 still holds,
 * an install that named no service does not get to send an email address to one.
 *
 * The fail-closed refusal an unconfigured install now raises on every DATA
 * surface is swallowed here and reported as plain "no authority": for a flow
 * whose purpose is to acquire a credential, "nothing is configured" and "local
 * mode is opted in" have the same two-step way out (configure an origin, then
 * sign in).
 */
export function resolveSkillsApiOrigin(
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): { origin: string; source: string } | null {
  const configured = configuredSkillsApiUrl(env, options.credentials?.keychain, options.credentials?.profile);
  if (configured) {
    // Validated by the shared normalizer (HTTPS anywhere, HTTP for an exact
    // loopback authority only) so a bad URL is refused here rather than at the
    // socket, with the same message every Hasna CLI gives.
    toV1BaseUrl(configured.value);
    return { origin: normalizeSkillsApiOrigin(configured.value), source: configured.source };
  }
  let fleet: SkillsFleet;
  try {
    fleet = resolveSkillsFleet(env, options);
  } catch (error) {
    if (isSkillsFleetCredentialError(error)) return null;
    throw error;
  }
  return fleet.mode === "hosted" ? { origin: fleet.apiOrigin, source: fleet.apiUrlSource } : null;
}

/** The authority for an auth flow, or throw naming what is missing. */
export function requireSkillsApiOrigin(
  action = "This command",
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): string {
  const resolved = resolveSkillsApiOrigin(env, options);
  if (!resolved) throw new MissingSkillsFleetError(action);
  return resolved.origin;
}

/**
 * The hosted resolution, or throw. Use on every auth and write path.
 *
 * `action` names the caller so the message says what was refused.
 */
export function requireSkillsFleet(
  action = "This command",
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): HostedSkillsFleet {
  const fleet = resolveSkillsFleet(env, options);
  if (fleet.mode === "hosted") return fleet;
  throw new MissingSkillsFleetError(action);
}

/**
 * Nothing at all is configured and the caller needed a service.
 *
 * The message names the environment variable, the Keychain item, the credential
 * file and the command — and deliberately contains no URL, so an "error" can
 * never hand a caller an endpoint it refused to resolve.
 */
export class MissingSkillsFleetError extends Error {
  readonly code = "MISSING_API_URL";

  constructor(action = "This command") {
    super(
      `${action} requires a Skills API credential and none is configured — ` +
        `run: skills auth login, or set ${SKILLS_API_KEY_ENV} ` +
        `(add the Keychain item hasna.credentials.${SKILLS_APP}.api-key, or write ~/.hasna/skills/config/credentials). ` +
        `Point at your own instance with ${SKILLS_API_URL_ENV}, or run: skills setup --api-url <your Skills instance origin>`,
    );
    this.name = "MissingSkillsFleetError";
  }
}
