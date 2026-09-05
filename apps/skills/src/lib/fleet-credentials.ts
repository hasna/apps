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
 * THREE OUTCOMES, and no fourth:
 *
 *   - a credential resolves            → HOSTED. The authority is the configured
 *                                        URL, else the fleet gateway.
 *   - no credential, but a URL is configured
 *                                      → LOUD failure. The caller exits non-zero
 *                                        with one line naming what is missing.
 *                                        There is no local fallback here: serving
 *                                        local results while authentication is
 *                                        unconfigured is a false green.
 *   - neither a credential nor a URL   → LOCAL. Skills is an OSS tool with a
 *                                        bundled corpus, so running on this
 *                                        machine is a real mode — and it says so,
 *                                        once, on stderr.
 */

import {
  ClientTransportConfigurationError,
  appConfigDiskValue,
  clientTransportEnvKeys,
  credentialDiskSources,
  keychainConfigValue,
  resolveClientTransport,
  resolveCredential,
  toV1BaseUrl,
  type CredentialChainOptions,
  type CredentialTier,
  type KeychainTierOptions,
} from "@hasna/contracts/client";

/** The app slug: the Keychain service, the `~/.hasna/<app>` folder, the gateway path. */
export const SKILLS_APP = "skills";

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
  /** The resolved key. Never logged, never written anywhere but the header. */
  apiKey: string;
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

/**
 * A hosted path could not resolve a credential.
 *
 * `code` is stable so JSON callers can branch on it. MISSING_API_URL is kept as
 * the code for the "nothing configured at all" case (see api-url.ts), which is a
 * different failure: this one means an authority IS configured and the key is not.
 */
export class SkillsFleetCredentialError extends Error {
  readonly code = "MISSING_API_CREDENTIAL";

  constructor(message: string) {
    super(message);
    this.name = "SkillsFleetCredentialError";
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

/**
 * Normalize a configured Skills authority to the origin the client dials.
 *
 * The Skills server serves its API under `/api/v1`, so the client composes
 * `<origin>/api/v1/...` itself. An operator who pasted the full API base — the
 * URL printed by every error message — must not end up with `/api/v1/api/v1`.
 */
export function normalizeSkillsApiOrigin(apiUrl: string): string {
  const url = new URL(apiUrl);
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
): ConfiguredSkillsApiUrl | null {
  for (const key of SKILLS_API_URL_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) return { value, source: key };
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
    );
  }
  if (fromDisk) return { value: fromDisk.value.trim(), source: fromDisk.path };
  return null;
}

/** The credential file paths consulted, for a message that has to name them. */
export function skillsCredentialFiles(env: Env = process.env): string[] {
  return credentialDiskSources(SKILLS_APP, env);
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
 * Local mode is legitimate for Skills: the corpus ships in the package. It is
 * still announced, because "no credential resolved" and "deliberately offline"
 * look identical in the output otherwise, and the first one is usually a
 * misconfiguration the operator wants to hear about.
 */
export function noticeLocalSkillsMode(write: (line: string) => void = (line) => console.error(line)): void {
  if (localNoticePrinted) return;
  localNoticePrinted = true;
  write(
    `skills: local mode — no ${SKILLS_API_KEY_ENV} and no ${SKILLS_API_URL_ENV} resolved, ` +
      `so this runs on this machine against the bundled corpus. ` +
      `Sign in with: skills auth login`,
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
  let resolution;
  try {
    resolution = resolveClientTransport(SKILLS_APP, env, { credentials: options.credentials });
  } catch (error) {
    if (!isClientTransportConfigurationError(error)) throw error;
    // The seam declined. Two very different reasons hide behind one error, and
    // they must not be collapsed: an operator who configured something and got
    // it wrong needs the failure, while an install that configured nothing is
    // simply an offline OSS install.
    const configured = configuredSkillsApiUrl(env, options.credentials?.keychain);
    const credential = resolveCredential(SKILLS_APP, env, options.credentials);
    if (!configured && !credential) {
      // Say it, once, and only for the ambient environment: a caller that built
      // its own env object is a library consumer deciding for itself, and a
      // notice on stderr is not that caller's to emit.
      if (env === process.env) noticeLocalSkillsMode();
      return { mode: "local", apiOrigin: null, apiKey: null };
    }
    if (configured && !credential) {
      throw new SkillsFleetCredentialError(
        `${configured.source} points this CLI at a Skills service but no API key resolved — ` +
          `refusing to run locally instead. Looked in the Keychain item ` +
          `hasna.credentials.${SKILLS_APP}.api-key, then ${skillsCredentialFiles(env).join(" or ") || "no credentials file (no HOME)"}, ` +
          `then ${SKILLS_API_KEY_ENV}. Sign in with: skills auth login`,
      );
    }
    throw error;
  }

  const configured = configuredSkillsApiUrl(env, options.credentials?.keychain);
  // The origin is composed from the CONFIGURED value rather than from the seam's
  // `<authority>/v1` base: this server serves `/api/v1`, and re-deriving from the
  // v1 base would append a second path segment to an operator's own base URL.
  const apiOrigin = configured
    ? normalizeSkillsApiOrigin(configured.value)
    : stripV1(resolution.baseUrl);
  const credential = resolveCredential(SKILLS_APP, env, options.credentials);
  if (!credential) {
    // Unreachable: resolveClientTransport throws without one. Kept as a refusal
    // rather than a `!`, because a future seam change must not silently produce
    // an unauthenticated hosted client here.
    throw new SkillsFleetCredentialError(
      `A Skills authority resolved but no API key did. Sign in with: skills auth login`,
    );
  }
  return {
    mode: "hosted",
    apiOrigin,
    apiKey: credential.apiKey,
    apiUrlSource: resolution.apiUrlSource ?? (configured?.source ?? "default"),
    apiKeySource: resolution.apiKeySource ?? credential.source,
    apiKeyTier: resolution.apiKeyTier,
    warning: resolution.warning,
  };
}

/** `<origin>/v1` back to `<origin>`, for the gateway default. */
function stripV1(baseUrl: string): string {
  return baseUrl.replace(/\/v1$/, "").replace(/\/+$/, "");
}

/**
 * The credential for a surface that reports refusals as data (an MCP tool, a
 * `--json` command) rather than as an exception.
 *
 * `reason` is the ladder's own message when an authority is configured and no
 * key resolved — a refusal carried as a value, NOT a fallback: the caller must
 * still refuse. It is null only when nothing at all is configured, which is the
 * ordinary "not signed in" case.
 */
export function skillsCredentialOrReason(
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): { apiKey: string; reason: null } | { apiKey: null; reason: string | null } {
  try {
    const fleet = resolveSkillsFleet(env, options);
    return fleet.mode === "hosted"
      ? { apiKey: fleet.apiKey, reason: null }
      : { apiKey: null, reason: null };
  } catch (error) {
    if (error instanceof SkillsFleetCredentialError || (error as Error)?.name === "SkillsFleetCredentialError") {
      return { apiKey: null, reason: (error as Error).message };
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
 */
export function resolveSkillsApiOrigin(
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): { origin: string; source: string } | null {
  const configured = configuredSkillsApiUrl(env, options.credentials?.keychain);
  if (configured) {
    // Validated by the shared normalizer (HTTPS anywhere, HTTP for an exact
    // loopback authority only) so a bad URL is refused here rather than at the
    // socket, with the same message every Hasna CLI gives.
    toV1BaseUrl(configured.value);
    return { origin: normalizeSkillsApiOrigin(configured.value), source: configured.source };
  }
  const fleet = resolveSkillsFleet(env, options);
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
