// Client-side transport resolver for the Hasna Service Contract v1.
//
// A public app client has exactly one data connection: the server's
// authenticated HTTP API. Production authorities MUST use HTTPS; exact
// loopback HTTP is retained only as a deliberately bounded development/test
// allowance. Clients never open SQLite or PostgreSQL and never infer a local
// data fallback from missing or invalid configuration.
//
// SAFETY: this module never returns, logs, or embeds an API-key value. Callers
// receive only presence flags and source names.

import { type Env } from "../env-token.js";
import { isIP } from "node:net";
import { clientTransportEnvKeys } from "./env-keys.js";
import {
  CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE,
  completePointerCredential,
  explicitCredential,
  resolveCredential,
  validateAndSealResolvedCredential,
  type CredentialChainOptions,
  type CredentialTier,
  type ResolvedCredential,
} from "./credentials.js";

// The credential chain is part of this module's public surface: callers wire
// `--api-key` / `--profile` through it, and consumers migrating off a direct
// `process.env` read need its types.
import { appConfigDiskValue, credentialDiskSources } from "./credentials.js";

export {
  appConfigDiskValue,
  completePointerCredential,
  credentialDiskSourceList,
  credentialDiskSources,
  CredentialResolutionError,
  explicitCredential,
  resolveCredential,
  __resetCredentialDeprecationNotices,
} from "./credentials.js";
export type {
  AppConfigDiskHit,
  CredentialChainOptions,
  CredentialTier,
  DiskCredentialSource,
  ResolvedCredential,
} from "./credentials.js";
export {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "./env-keys.js";
export type { ClientTransportEnvKeys } from "./env-keys.js";

const FLEET_API_DOMAIN_ENV_KEY = "HASNA_FLEET_API_DOMAIN";
const NEUTRAL_FLEET_API_DOMAIN = "your-deployment.example";
const ASCII_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

interface FleetApiDomainResolution {
  domain: string;
  source: typeof FLEET_API_DOMAIN_ENV_KEY | "default";
  misconfigured: boolean;
  warning: string | null;
}

interface DefaultCloudBaseUrlResolution {
  baseUrl: string;
  source: FleetApiDomainResolution["source"];
  misconfigured: boolean;
  warning: string | null;
}

function isValidDnsDomain(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 253 ||
    ASCII_CONTROL_PATTERN.test(value) ||
    /[^\x00-\x7f]/.test(value)
  ) {
    return false;
  }
  return value
    .split(".")
    .every(
      (label) =>
        label.length <= 63 &&
        !label.startsWith("xn--") &&
        DNS_LABEL_PATTERN.test(label),
    );
}

function resolveFleetApiDomain(env: Env): FleetApiDomainResolution {
  const raw = env[FLEET_API_DOMAIN_ENV_KEY];
  if (raw === undefined) {
    return {
      domain: NEUTRAL_FLEET_API_DOMAIN,
      source: "default",
      misconfigured: true,
      warning: `${FLEET_API_DOMAIN_ENV_KEY} is not set; using the non-resolving ${NEUTRAL_FLEET_API_DOMAIN} fallback.`,
    };
  }

  const configured = raw.trim().toLowerCase();
  if (ASCII_CONTROL_PATTERN.test(raw) || !isValidDnsDomain(configured)) {
    return {
      domain: NEUTRAL_FLEET_API_DOMAIN,
      source: FLEET_API_DOMAIN_ENV_KEY,
      misconfigured: true,
      warning: `${FLEET_API_DOMAIN_ENV_KEY} is blank or invalid; using the non-resolving ${NEUTRAL_FLEET_API_DOMAIN} fallback.`,
    };
  }

  return {
    domain: configured,
    source: FLEET_API_DOMAIN_ENV_KEY,
    misconfigured: false,
    warning: null,
  };
}

function validateAppSlug(name: string): string {
  if (name.length > 63 || !DNS_LABEL_PATTERN.test(name)) {
    throw new Error("App name must be one lowercase DNS label.");
  }
  return name;
}

function composeCloudHostname(name: string, domain: string): string {
  const hostname = `${validateAppSlug(name)}.${domain}`;
  if (!isValidDnsDomain(hostname)) {
    throw new Error("Composed cloud hostname must be a valid DNS domain");
  }
  return hostname;
}

function resolveDefaultCloudBaseUrl(
  name: string,
  env: Env,
): DefaultCloudBaseUrlResolution {
  const appSlug = validateAppSlug(name);
  const fleetDomain = resolveFleetApiDomain(env);
  const configuredHostname = `${appSlug}.${fleetDomain.domain}`;
  if (isValidDnsDomain(configuredHostname)) {
    return {
      baseUrl: `https://${configuredHostname}`,
      source: fleetDomain.source,
      misconfigured: fleetDomain.misconfigured,
      warning: fleetDomain.warning,
    };
  }

  const fallbackHostname = composeCloudHostname(
    appSlug,
    NEUTRAL_FLEET_API_DOMAIN,
  );
  return {
    baseUrl: `https://${fallbackHostname}`,
    source: fleetDomain.source,
    misconfigured: true,
    warning: `${FLEET_API_DOMAIN_ENV_KEY} cannot form a valid composed cloud hostname for app '${appSlug}'; using the non-resolving ${NEUTRAL_FLEET_API_DOMAIN} fallback.`,
  };
}

/**
 * Fleet API domain suffix. This published package never ships a real internal
 * hostname: override with `HASNA_FLEET_API_DOMAIN` (REQUIRED in a real
 * deployment) or set an explicit `HASNA_<NAME>_API_URL` per app. Absent both,
 * this falls back to a neutral placeholder that intentionally does not
 * resolve to any service. Blank, malformed, and suffixes that cannot form a
 * valid total hostname with the app prefix use the same deterministic
 * placeholder; `resolveClientTransport()` marks that fallback misconfigured so
 * authenticated clients fail before making a request.
 */
export function fleetApiDomain(env: Env = process.env as Env): string {
  return resolveFleetApiDomain(env).domain;
}

/** Default cloud host template. `<app>` is the app slug. */
export function defaultCloudBaseUrl(name: string, env: Env = process.env as Env): string {
  return resolveDefaultCloudBaseUrl(name, env).baseUrl;
}

function firstEnv(
  env: Env,
  keys: readonly string[],
  options: { preserveRaw?: boolean } = {},
): { key: string; value: string } | null {
  for (const key of keys) {
    const raw = env[key];
    const value = raw?.trim();
    if (value) return { key, value: options.preserveRaw ? raw! : value };
  }
  return null;
}

function rawAuthority(value: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\//i.exec(value);
  if (!match) throw new Error("API URL must be absolute.");
  const afterScheme = value.slice(match[0].length);
  const boundary = afterScheme.search(/[/?#]/);
  const authority = boundary === -1 ? afterScheme : afterScheme.slice(0, boundary);
  if (!authority) throw new Error("API URL must include a hostname.");
  return authority;
}

function assertCanonicalPort(port: string): void {
  if (!/^[0-9]+$/.test(port) || (port.length > 1 && port.startsWith("0"))) {
    throw new Error("API URL authority must contain a canonical port between 1 and 65535.");
  }
  const numericPort = Number(port);
  if (!Number.isSafeInteger(numericPort) || numericPort < 1 || numericPort > 65_535) {
    throw new Error("API URL authority must contain a canonical port between 1 and 65535.");
  }
}

function canonicalAuthorityHostname(authority: string): string {
  let rawHostname: string;
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    if (closingBracket === -1) {
      throw new Error("API URL authority must contain a canonical hostname.");
    }
    rawHostname = authority.slice(0, closingBracket + 1);
    const portSuffix = authority.slice(closingBracket + 1);
    if (portSuffix) {
      if (!portSuffix.startsWith(":")) {
        throw new Error("API URL authority must contain a canonical hostname and port.");
      }
      assertCanonicalPort(portSuffix.slice(1));
    }
    if (isIP(rawHostname.slice(1, -1)) !== 6) {
      throw new Error("API URL authority must contain a canonical IPv6 literal.");
    }
  } else {
    const firstColon = authority.indexOf(":");
    const lastColon = authority.lastIndexOf(":");
    if (firstColon !== lastColon) {
      throw new Error("IPv6 API URL authorities must use brackets.");
    }
    if (lastColon !== -1) {
      const port = authority.slice(lastColon + 1);
      assertCanonicalPort(port);
      rawHostname = authority.slice(0, lastColon);
    } else {
      rawHostname = authority;
    }
    const ipVersion = isIP(rawHostname);
    const numericAddressParts = rawHostname.split(".");
    const looksLikeNonCanonicalIpv4 =
      numericAddressParts.every((part) =>
        /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(part)
      );
    if (
      (ipVersion !== 4 && looksLikeNonCanonicalIpv4) ||
      (ipVersion !== 4 && !isValidDnsDomain(rawHostname.toLowerCase()))
    ) {
      throw new Error("API URL authority must contain a canonical ASCII hostname.");
    }
  }
  return rawHostname.toLowerCase();
}

function isDeliberateLoopbackHttpAuthority(authority: string): boolean {
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(authority);
}

/**
 * Normalize an explicit API base URL to `<origin>/v1`.
 *
 * HTTPS may target any explicit ASCII hostname. HTTP is restricted to exact
 * loopback authorities for local development. Paths and ports are preserved;
 * query strings, fragments, credentials, controls, IDNs, and punycode are
 * rejected rather than silently normalized.
 */
export function toV1BaseUrl(apiUrl: string): string {
  if (ASCII_CONTROL_PATTERN.test(apiUrl)) {
    throw new Error("API URL must not contain ASCII control characters.");
  }
  const input = apiUrl.trim();
  const authority = rawAuthority(input);
  if (
    authority.includes("@") ||
    authority.includes("\\") ||
    authority.includes("%") ||
    /[^\x00-\x7f]/.test(authority)
  ) {
    throw new Error("API URL authority must be canonical ASCII without credentials.");
  }

  const canonicalHostname = canonicalAuthorityHostname(authority);
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("API URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("API URL must not include credentials.");
  }
  if (!url.hostname || url.hostname.endsWith(".")) {
    throw new Error("API URL must include a canonical hostname.");
  }
  if (url.hostname.toLowerCase() !== canonicalHostname) {
    throw new Error("API URL authority must not rely on parser hostname normalization.");
  }
  if (url.hostname.split(".").some((label) => label.toLowerCase().startsWith("xn--"))) {
    throw new Error("API URL must not use IDN or punycode hostnames.");
  }
  if (url.protocol === "http:" && !isDeliberateLoopbackHttpAuthority(authority)) {
    throw new Error("API URL may use http only for an exact loopback authority.");
  }
  if (url.search || url.hash) {
    throw new Error("API URL must not include a query string or fragment.");
  }
  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/v1")) path = path.slice(0, -"/v1".length);
  url.pathname = `${path}/v1`;
  return url.toString().replace(/\/+$/, "");
}

export const CLIENT_TRANSPORTS = ["http"] as const;
export type ClientTransportKind = (typeof CLIENT_TRANSPORTS)[number];

/** A client authority or credential declaration cannot be used safely. */
export class ClientTransportConfigurationError extends Error {
  readonly appName: string;
  readonly sources: readonly string[];

  constructor(appName: string, message: string, sources: readonly string[] = []) {
    super(message);
    this.name = "ClientTransportConfigurationError";
    this.appName = appName;
    this.sources = Object.freeze([...sources]);
  }
}

export interface ClientTransportResolution {
  /** Where the client should read/write from. */
  transport: ClientTransportKind;
  /**
   * What selected the transport: an API URL env key NAME or the absolute PATH
   * of the XDG app-config file that supplied the URL.
   */
  transportSource: string;
  /** `<origin>/v1` base for the server API. */
  baseUrl: string;
  /**
   * WHERE the API URL/domain came from: an env key NAME, an absolute file PATH,
   * `"default"` (neutral placeholder), or null.
   */
  apiUrlSource: string | null;
  /** Whether an API key is present (value never exposed). */
  apiKeyPresent: boolean;
  /**
   * WHERE the API key came from: an env key NAME or an absolute file path.
   * Never the value.
   *
   * Names the tier of the provider chain that supplied the key.
   */
  apiKeySource: string | null;
  /**
   * Which tier of the credential chain supplied the key.
   */
  apiKeyTier: CredentialTier;
  /**
   * Kept for diagnostic shape compatibility. A successful resolution is never
   * misconfigured; invalid configurations throw before a value is returned.
   */
  misconfigured: boolean;
  /** Human-readable warning, or null. Never contains secret values. */
  warning: string | null;
}

export interface ResolveClientTransportOptions {
  /** Tier-1 credential inputs, e.g. from `--api-key` / `--profile` flags. */
  credentials?: CredentialChainOptions;
}

interface ResolvedClientTransportSnapshot {
  resolution: ClientTransportResolution;
  credential: ResolvedCredential;
}

/**
 * Resolve the sole authenticated service transport. The authority is read from
 * the environment first and then XDG app config. Missing, blank, conflicting,
 * or invalid declarations throw. Credentials are resolved at call time.
 */
function resolveClientTransportSnapshot(
  name: string,
  env: Env = process.env,
  options: ResolveClientTransportOptions = {},
): ResolvedClientTransportSnapshot {
  const keys = clientTransportEnvKeys(name);
  const definedUrlEntries = keys.apiUrlKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined)
    .map((key) => ({ key, raw: String(env[key]) }));
  const blankUrl = definedUrlEntries.find((entry) => entry.raw.trim().length === 0);
  if (blankUrl) {
    throw new ClientTransportConfigurationError(
      name,
      `${blankUrl.key} is set but blank; public clients require an explicit HTTPS API URL and never select local storage.`,
      [blankUrl.key],
    );
  }
  const controlledUrl = definedUrlEntries.find((entry) => ASCII_CONTROL_PATTERN.test(entry.raw));
  if (controlledUrl) {
    throw new ClientTransportConfigurationError(name, `${controlledUrl.key} contains ASCII control characters.`, [controlledUrl.key]);
  }
  const usableUrlEntries = definedUrlEntries.map((entry) => ({ key: entry.key, value: entry.raw.trim() }));
  if (usableUrlEntries.length > 1 && new Set(usableUrlEntries.map((entry) => entry.value)).size > 1) {
    throw new ClientTransportConfigurationError(
      name,
      `${usableUrlEntries.map((entry) => entry.key).join(" and ")} disagree; client authority aliases must be identical or only one may be set.`,
      usableUrlEntries.map((entry) => entry.key),
    );
  }
  const envUrlHit = usableUrlEntries[0] ?? null;
  const diskConfigUrlHit = appConfigDiskValue(name, env, keys.apiUrlKeys);
  if (diskConfigUrlHit?.unusable) {
    throw new ClientTransportConfigurationError(
      name,
      `${diskConfigUrlHit.key} in ${diskConfigUrlHit.path} is declared but blank or malformed; public clients require a valid HTTPS service authority.`,
      [diskConfigUrlHit.path],
    );
  }
  if (envUrlHit && diskConfigUrlHit && envUrlHit.value !== diskConfigUrlHit.value.trim()) {
    throw new ClientTransportConfigurationError(
      name,
      `${envUrlHit.key} and ${diskConfigUrlHit.path} select different service authorities; refusing to send a credential written for one authority to the other.`,
      [envUrlHit.key, diskConfigUrlHit.path],
    );
  }
  const diskUrlHit = envUrlHit ? null : diskConfigUrlHit;
  // `key` carries the SOURCE for every downstream field: an env key name, or the
  // absolute path of the file that decided. `apiKeySource` already reports its
  // tier this way, so an operator reads both the same way.
  const urlHit = envUrlHit ?? (diskUrlHit ? { key: diskUrlHit.path, value: diskUrlHit.value } : null);
  const warnings: string[] = [];

  // No URL is never a local-data selection. Public clients fail before any
  // data operation can run.
  if (!urlHit) {
    throw new ClientTransportConfigurationError(
      name,
      `${keys.apiUrlKeys[0]} is required; public clients use only the authenticated HTTPS service and never fall back to SQLite or another local store.`,
      keys.apiUrlKeys,
    );
  }

  // A server URL decided by a disk pointer while the environment was silent is
  // a deliberate flip, and it must not be silent: name the file that decided.
  if (diskUrlHit) {
    warnings.push(
      `No ${keys.apiUrlKeys[0]} in the environment; the server URL in ${diskUrlHit.path} was used, so this client connects to the server. ` +
        `Keep this XDG config entry aligned with the intended service authority.`,
    );
  }

  // An API URL explicitly selects HTTP. Resolve the credential at call time.
  // A deliberate tier that cannot be honoured still throws rather than
  // authenticating as a different principal.
  const credential: ResolvedCredential | null = resolveCredential(name, env, options.credentials);

  if (!credential) {
    const diskHint = credentialDiskSourcesForMessage(name, env);
    warnings.push(
      `${urlHit.key} selects the HTTP server for '${name}', but no API key could be resolved; ` +
        `refusing to create an unauthenticated client. ` +
        `Looked for a credential file at ${diskHint}, then for ${keys.apiKeyKeys[0]} in the environment.`,
    );
    throw new ClientTransportConfigurationError(name, warnings.join(" "), [urlHit.key]);
  }
  if (credential.warning) warnings.push(credential.warning);

  const apiUrlSource = urlHit.key;
  let baseUrl: string;
  try {
    baseUrl = toV1BaseUrl(urlHit.value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ClientTransportConfigurationError(
      name,
      `Invalid API URL from ${apiUrlSource}: ${message}`,
      [apiUrlSource],
    );
  }

  return {
    resolution: {
      transport: "http",
      transportSource: urlHit.key,
      baseUrl,
      apiUrlSource,
      apiKeyPresent: true,
      apiKeySource: credential.source,
      apiKeyTier: credential.tier,
      misconfigured: false,
      warning: warnings.length > 0 ? warnings.join(" ") : null,
    },
    credential,
  };
}

/**
 * Resolve the sole authenticated service transport without exposing its
 * credential value. Invalid or incomplete configuration throws.
 */
export function resolveClientTransport(
  name: string,
  env: Env = process.env,
  options: ResolveClientTransportOptions = {},
): ClientTransportResolution {
  return resolveClientTransportSnapshot(name, env, options).resolution;
}

/** Render the disk candidates for a diagnostic, without touching their contents. */
function credentialDiskSourcesForMessage(name: string, env: Env): string {
  const paths = credentialDiskSources(name, env);
  return paths.length > 0 ? paths.join(" or ") : "<no HOME set in this environment, so no credential file was consulted>";
}

/** Thrown when a cloud HTTP request returns a non-2xx status, including redirects. */
export class HasnaHttpError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  declare readonly body: unknown;
  /** WHICH source supplied the rejected key (an env key name or a file path). Never a value. */
  readonly credentialSource: string | null;
  /** Which tier of the provider chain supplied it. */
  readonly credentialTier: CredentialTier | null;
  constructor(
    method: string,
    path: string,
    status: number,
    body: unknown,
    credential?: { source: string; tier: CredentialTier; guidance: string } | null,
  ) {
    // The base message is byte-stable when there is no credential context, so
    // callers matching on it keep working; guidance is strictly additive.
    const guidance = credential ? `. ${credential.guidance}` : "";
    super(`Hasna cloud request failed: ${method} ${path} -> ${status}${guidance}`);
    this.name = "HasnaHttpError";
    this.status = status;
    this.method = method;
    this.path = path;
    Object.defineProperty(this, "body", {
      value: body,
      enumerable: status !== 401 && status !== 403,
      writable: false,
      configurable: false,
    });
    this.credentialSource = credential?.source ?? null;
    this.credentialTier = credential?.tier ?? null;
  }
}

/**
 * A credential resolved fresh for one request.
 *
 * The transport takes a PROVIDER rather than a string so that a long-lived
 * process — an MCP server, a daemon — picks up a key rotation without being
 * rebuilt. Resolving once when the client is constructed would just move the
 * stale snapshot from process start to client construction.
 */
export type CredentialProvider = () => ResolvedCredential;

function currentCredential(name: string, apiKey: string | CredentialProvider): ResolvedCredential {
  if (typeof apiKey === "function") {
    return validateAndSealResolvedCredential(name, apiKey());
  }
  // A bare string goes through the SAME constructor as a resolved one. Building
  // it as an object literal here is what let a key with a CR in it reach `fetch`,
  // whose TypeError quotes the whole header value and so leaks the plaintext key.
  return explicitCredential(name, apiKey);
}

/**
 * Resolve the per-request credential, completing a secrets-vault pointer.
 *
 * A pointer-tier resolution (`tier === "pointer"`) carries the vault ITEM KEY,
 * not the value; the value is fetched through the @hasna/secrets SDK HERE, at
 * request time, and any failure is TERMINAL (never a fall-through). All other
 * tiers resolve synchronously exactly as before. This is the seam the
 * requirement "the transport resolves the pointer through the secrets SDK at
 * request time" binds.
 */
async function resolveRequestCredential(
  name: string,
  apiKey: string | CredentialProvider,
  env: Env = process.env,
): Promise<ResolvedCredential> {
  const resolved = currentCredential(name, apiKey);
  if (resolved.tier === "pointer") {
    return completePointerCredential(name, resolved, env);
  }
  return resolved;
}

/**
 * What a human should do about a 401/403, given where the key came from.
 *
 * The opaque "API key has been revoked" this replaces cost an engineer an hour:
 * it named neither the source nor the fix, and the most likely cause — a shell
 * older than the last rotation — is invisible from inside that shell.
 */
function authFailureGuidance(credential: ResolvedCredential): string {
  const origin = `The API key for this request came from ${credential.source}`;
  if (credential.deliberate) {
    const remedy =
      credential.source === CALLER_SUPPLIED_CREDENTIAL_PROVIDER_SOURCE
        ? `Fix that provider so it returns the current key, or replace it with resolveCredential() ` +
          `so diagnostics can name the original source.`
        : `Rotate that key, or unset the override to use the credential on disk.`;
    return (
      `${origin} — a credential you selected deliberately. It was NOT substituted with any other key: ` +
      `falling back here would authenticate as a different principal than the one you named, which is ` +
      `exactly the failure an override exists to prevent. ${remedy}`
    );
  }
  if (credential.deprecated) {
    // Reaching the legacy tier PROVES the disk had no credential — tier 3 runs
    // first. So the advice must be "write the key to disk", never "unset this
    // variable": unsetting it with nothing on disk leaves the client with no
    // credential and makes the authenticated request fail closed.
    const target = credential.diskCandidates[0];
    const remedy = target
      ? `Write the CURRENT key to ${target} — that file is re-read on every call, so rotations take ` +
        `effect immediately and in every shell. Do not simply unset ${credential.source}: nothing was ` +
        `found on disk, so that would leave this client with no credential at all.`
      : `This environment has no HOME, so no credential file could be consulted; the disk tier is ` +
        `unavailable here and there is nothing to fall back to. Set HOME, or supply the key explicitly.`;
    return (
      `${origin}, a variable in this process's environment — which is a snapshot taken when the process ` +
      `started. A STALE SHELL is the most common cause of this error: this shell exported the key before ` +
      `it was rotated, and will keep sending the old one until it exits. ${remedy}`
    );
  }
  return (
    `${origin}, which was re-read from disk on this very call — so a stale shell is NOT the cause here. ` +
    `The stored credential is genuinely being rejected: rotate it, or re-run the fleet key distribution ` +
    `so this machine gets the current key.`
  );
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface AuthenticatedRequestBinding {
  baseUrl: string;
  credential: ResolvedCredential;
}

type AuthenticatedRequestBindingProvider = () => Promise<AuthenticatedRequestBinding>;

/** Query params for a request. Nullish values are dropped; arrays repeat the key. */
export type QueryParams =
  | URLSearchParams
  | Record<string, string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>>;

/** Retry policy for transient failures (network errors, timeouts, 5xx, 429). */
export interface HasnaRetryOptions {
  /** Max RETRY attempts after the first try. Default 2 (=> up to 3 total tries). */
  retries?: number;
  /** Base backoff in ms for exponential backoff. Default 200. */
  baseDelayMs?: number;
  /** Backoff ceiling in ms. Default 2000. */
  maxDelayMs?: number;
  /** HTTP statuses that trigger a retry. Default 408, 425, 429, 500, 502, 503, 504. */
  retryStatuses?: number[];
}

/** Per-call request options: query, idempotency, timeout, retry, extra headers. */
export interface HasnaRequestOptions {
  /** Query string params appended to the URL. */
  query?: QueryParams;
  /**
   * Idempotency key sent as `Idempotency-Key`. When set, unsafe methods (POST)
   * become safe to retry: the server dedupes replays. Auto-generated for
   * `create()` in the storage client.
   */
  idempotencyKey?: string;
  /** Override the transport timeout for this call (ms). */
  timeoutMs?: number;
  /** Extra headers merged into this call (override transport headers). */
  headers?: Record<string, string>;
  /** Override or disable retry for this call. `false` disables retries. */
  retry?: HasnaRetryOptions | false;
  /** Caller abort signal, combined with the internal timeout. */
  signal?: AbortSignal;
}

const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504] as const;
/** Methods that are idempotent by definition and always safe to retry. */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);
const AUTHORITY_OVERRIDE_HEADERS = new Set([
  "host",
  ":authority",
  "forwarded",
  "x-forwarded-host",
  "x-original-host"
]);

function assertNoAuthorityOverrideHeaders(
  headers: Record<string, string> | undefined,
  source: "transport" | "request"
): void {
  if (!headers) return;
  const forbidden = Object.keys(headers).find((name) =>
    AUTHORITY_OVERRIDE_HEADERS.has(name.trim().toLowerCase())
  );
  if (forbidden) {
    throw new Error(
      `Authenticated ${source} headers must not set authority header '${forbidden}'.`
    );
  }
}

export interface HasnaHttpTransportOptions {
  /** App slug (for error context / default host). */
  name: string;
  /** `<origin>/v1` base. Usually from `resolveClientTransport().baseUrl`. */
  baseUrl: string;
  /**
   * The API key (secret), or a provider that resolves one per request.
   *
   * Pass a provider (see {@link CredentialProvider}) so rotation heals inside a
   * long-lived process. A plain string is still accepted and is treated as a
   * deliberate, explicit credential.
   */
  apiKey: string | CredentialProvider;
  /** Override fetch (tests). Defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Per-request timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Default retry policy for all requests. Pass `false` to disable. */
  retry?: HasnaRetryOptions | false;
  /** Injectable sleep (tests). Defaults to a real timer. */
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface HasnaHttpTransport {
  readonly baseUrl: string;
  request<T = unknown>(method: string, path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
  get<T = unknown>(path: string, opts?: HasnaRequestOptions): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
  del<T = unknown>(path: string, body?: unknown, opts?: HasnaRequestOptions): Promise<T>;
}

/** Append query params to a `/v1`-relative path (no-op when empty). */
export function appendQuery(path: string, query?: QueryParams): string {
  if (!query) return path;
  const params = query instanceof URLSearchParams ? query : new URLSearchParams();
  if (!(query instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) params.append(key, String(v));
      } else {
        params.append(key, String(value));
      }
    }
  }
  const qs = params.toString();
  if (!qs) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${qs}`;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Build an authenticated HTTP transport for an app's cloud `/v1` API. Sends the
 * API key on every request as BOTH `x-api-key` and `Authorization: Bearer`
 * (serve apps accept either), returns parsed JSON, times out, and retries
 * transient failures with exponential backoff + jitter. Never logs the key.
 * Redirects are never followed: every 3xx response fails closed at the validated
 * base origin so credentials and request bodies cannot cross an authority
 * boundary through runtime-specific redirect behavior.
 *
 * Retry safety: idempotent methods (GET/HEAD/PUT/DELETE/OPTIONS) are always
 * retried on transient failure; POST/PATCH are retried ONLY when an
 * `Idempotency-Key` is supplied, so replays can't create duplicates.
 */
function createHasnaHttpTransportInternal(
  options: HasnaHttpTransportOptions,
  requestBindingProvider?: AuthenticatedRequestBindingProvider,
): HasnaHttpTransport {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = toV1BaseUrl(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const sleep = options.sleepImpl ?? defaultSleep;
  const defaultRetry = options.retry;

  function resolveRetry(callRetry: HasnaRequestOptions["retry"]): Required<HasnaRetryOptions> | null {
    const chosen = callRetry !== undefined ? callRetry : defaultRetry;
    if (chosen === false) return null;
    const r = chosen ?? {};
    return {
      retries: r.retries ?? 2,
      baseDelayMs: r.baseDelayMs ?? 200,
      maxDelayMs: r.maxDelayMs ?? 2_000,
      retryStatuses: r.retryStatuses ?? [...DEFAULT_RETRY_STATUSES],
    };
  }

  async function once<T>(
    method: string,
    rel: string,
    url: string,
    body: unknown,
    opts: HasnaRequestOptions,
    credential: ResolvedCredential,
  ): Promise<{ ok: true; value: T } | { ok: false; retryable: boolean; error: Error }> {
    assertNoAuthorityOverrideHeaders(options.headers, "transport");
    assertNoAuthorityOverrideHeaders(opts.headers, "request");
    const headers: Record<string, string> = {
      "x-api-key": credential.apiKey,
      Authorization: `Bearer ${credential.apiKey}`,
      Accept: "application/json",
      ...(options.headers ?? {}),
      ...(opts.headers ?? {}),
    };
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    const init: RequestInit = {
      method,
      headers,
      // Authentication is attached before fetch. Following here would let the
      // runtime decide which custom credentials or bodies cross the redirect
      // boundary, so every redirect is surfaced to the caller instead.
      redirect: "manual",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? timeoutMs);
    init.signal = controller.signal;
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      // A caller-initiated abort is a cancellation, not a transient failure —
      // propagate it immediately instead of retrying. Our own timeout abort and
      // ordinary network errors ARE transient and retryable.
      if (opts.signal?.aborted) return { ok: false, retryable: false, error: err };
      return { ok: false, retryable: true, error: err };
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    }
    const authenticationFailure = response.status === 401 || response.status === 403;
    let parsed: unknown = undefined;
    // Authentication responses are controlled by a boundary that just received
    // the credential. Some providers echo rejected credentials in their error
    // payloads. Never read, parse, or retain that payload: an Error is commonly
    // enumerated, JSON-serialized, or inspected by a logger.
    if (authenticationFailure) {
      try {
        await response.body?.cancel();
      } catch {
        // A diagnostic body that cannot be cancelled is still never read.
      }
    } else {
      const text = await response.text();
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
    }
    if (!response.ok) {
      // A caller-provided retry status list must not turn a redirect into
      // repeated authenticated requests. Redirects are terminal regardless of
      // retry policy.
      if (response.status >= 300 && response.status < 400) {
        return {
          ok: false,
          retryable: false,
          error: new HasnaHttpError(method, rel, response.status, parsed),
        };
      }
      // An authentication failure is TERMINAL, regardless of retry policy — the
      // same rule redirects already follow, and for the same reason: a caller's
      // retry list must not turn one failure into repeated authenticated
      // requests. A rejected key does not become valid by being sent again, so
      // retrying only multiplies failed-auth events in the server's audit log
      // and delays the actionable error. This is also the boundary that keeps
      // 401 handling from drifting back toward retry-on-401 — the pattern that
      // silently rescues a revoked deliberate override as the wrong principal.
      if (authenticationFailure) {
        return {
          ok: false,
          retryable: false,
          error: new HasnaHttpError(method, rel, response.status, undefined, {
            source: credential.source,
            tier: credential.tier,
            guidance: authFailureGuidance(credential),
          }),
        };
      }
      const retry = resolveRetry(opts.retry);
      const retryable = retry ? retry.retryStatuses.includes(response.status) : false;
      return { ok: false, retryable, error: new HasnaHttpError(method, rel, response.status, parsed) };
    }
    return { ok: true, value: parsed as T };
  }

  async function request<T>(method: string, path: string, body?: unknown, opts: HasnaRequestOptions = {}): Promise<T> {
    const upper = method.toUpperCase();
    const rel = appendQuery(path.startsWith("/") ? path : `/${path}`, opts.query);
    const retry = resolveRetry(opts.retry);
    const methodRetryable = IDEMPOTENT_METHODS.has(upper) || Boolean(opts.idempotencyKey);
    const maxAttempts = retry && methodRetryable ? retry.retries + 1 : 1;

    // ONE request, ONE identity. The credential is resolved fresh here — so a
    // rotation is picked up by the next request without rebuilding the client —
    // but it is resolved exactly once for the whole retry loop. Re-resolving per
    // attempt would let a rotation land mid-request and send two attempts of the
    // same logical call under two different principals, which is precisely the
    // audit-log confusion that makes retry-on-401 the wrong pattern here.
    // A pointer tier resolves through the secrets vault at this request boundary.
    const binding = requestBindingProvider
      ? await requestBindingProvider()
      : {
          baseUrl: base,
          credential: await resolveRequestCredential(options.name, options.apiKey),
        };
    const url = `${binding.baseUrl}${rel}`;
    const credential = binding.credential;

    let last: { retryable: boolean; error: Error } | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await once<T>(upper, rel, url, body, opts, credential);
      if (result.ok) return result.value;
      last = result;
      const canRetry = retry !== null && methodRetryable && result.retryable && attempt < maxAttempts;
      if (!canRetry) break;
      const backoff = Math.min(retry!.maxDelayMs, retry!.baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * (backoff / 2 + 1));
      await sleep(backoff + jitter);
    }
    throw last!.error;
  }

  return {
    baseUrl: base,
    request,
    get: (path, opts) => request("GET", path, undefined, opts),
    post: (path, body, opts) => request("POST", path, body, opts),
    put: (path, body, opts) => request("PUT", path, body, opts),
    patch: (path, body, opts) => request("PATCH", path, body, opts),
    del: (path, body, opts) => request("DELETE", path, body, opts),
  };
}

/**
 * Build an authenticated HTTP transport from a static authority and a
 * per-request credential provider.
 */
export function createHasnaHttpTransport(options: HasnaHttpTransportOptions): HasnaHttpTransport {
  return createHasnaHttpTransportInternal(options);
}

/**
 * Resolve the sole public client transport and build it. Missing, blank,
 * conflicting, or invalid authority/credential configuration throws; there is
 * no local-data return branch.
 */
export function createClientTransport(
  name: string,
  env: Env = process.env,
  overrides?: Partial<Pick<HasnaHttpTransportOptions, "fetchImpl" | "headers" | "timeoutMs" | "retry" | "sleepImpl">> & {
    /** Tier-1 credential inputs, e.g. from `--api-key` / `--profile` flags. */
    credentials?: CredentialChainOptions;
  },
): { transport: "http"; client: HasnaHttpTransport; resolution: ClientTransportResolution } {
  const credentialOptions = overrides?.credentials;
  const snapshotOptions = { ...(credentialOptions ? { credentials: credentialOptions } : {}) };
  const resolution = resolveClientTransportSnapshot(name, env, snapshotOptions).resolution;

  const sameBinding = (
    left: ResolvedClientTransportSnapshot,
    right: ResolvedClientTransportSnapshot,
  ): boolean =>
    left.resolution.baseUrl === right.resolution.baseUrl &&
    left.credential.apiKey === right.credential.apiKey &&
    left.credential.pointerVaultKey === right.credential.pointerVaultKey &&
    left.credential.source === right.credential.source &&
    left.credential.tier === right.credential.tier;

  const unstableConfiguration = () =>
    new ClientTransportConfigurationError(
      name,
      "The configured service authority or credential changed while a request was being prepared; no authenticated request was sent.",
    );

  const requestBindingProvider: AuthenticatedRequestBindingProvider = async () => {
    // Read a stable pair rather than validating the authority and then reading
    // the credential independently. The second snapshot closes the bounded
    // authority/key rotation race; the final snapshot below revalidates the
    // exact reviewed pair immediately before dispatch.
    const first = resolveClientTransportSnapshot(name, env, snapshotOptions);
    const reviewed = resolveClientTransportSnapshot(name, env, snapshotOptions);
    if (!sameBinding(first, reviewed)) throw unstableConfiguration();
    if (reviewed.resolution.baseUrl !== resolution.baseUrl) {
      throw new ClientTransportConfigurationError(
        name,
        "The configured service authority changed; rebuild the client before sending credentials.",
      );
    }

    const credential = await resolveRequestCredential(name, () => reviewed.credential, env);
    const immediatelyBeforeDispatch = resolveClientTransportSnapshot(name, env, snapshotOptions);
    if (!sameBinding(reviewed, immediatelyBeforeDispatch)) throw unstableConfiguration();
    if (immediatelyBeforeDispatch.resolution.baseUrl !== resolution.baseUrl) {
      throw new ClientTransportConfigurationError(
        name,
        "The configured service authority changed; rebuild the client before sending credentials.",
      );
    }
    return { baseUrl: immediatelyBeforeDispatch.resolution.baseUrl, credential };
  };
  return {
    transport: "http",
    client: createHasnaHttpTransportInternal(
      {
        name,
        baseUrl: resolution.baseUrl,
        // The bound provider supplies this value for every request. This
        // fallback provider is unreachable and prevents a placeholder secret
        // from existing in source or generated artifacts.
        apiKey: () => {
          throw new Error("The authenticated request binding provider was not invoked.");
        },
        ...(overrides?.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
        ...(overrides?.headers ? { headers: overrides.headers } : {}),
        ...(overrides?.timeoutMs ? { timeoutMs: overrides.timeoutMs } : {}),
        ...(overrides?.retry !== undefined ? { retry: overrides.retry } : {}),
        ...(overrides?.sleepImpl ? { sleepImpl: overrides.sleepImpl } : {}),
      },
      requestBindingProvider,
    ),
    resolution,
  };
}
