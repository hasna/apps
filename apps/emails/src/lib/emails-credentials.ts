// THE ONE SEAM between @hasna/emails and the shared Hasna client resolver.
//
// WHAT THIS REPLACED. Until hasna/apps#1720 the client resolved its hosted
// endpoint and credential from its OWN env chain — EMAILS_SELF_HOSTED_URL plus a
// credential picked from EMAILS_SESSION_TOKEN / EMAILS_IDP_TOKEN /
// EMAILS_SELF_HOSTED_API_KEY, optionally delivered through the
// EMAILS_CLIENT_ENV_SECRET vault pointer. A second spelling of the credential
// contract drifted: it had no Keychain tier, no `~/.hasna/emails/config/credentials`
// tier and no default gateway authority, so on a station whose key lived in the
// Keychain the CLI failed closed while `todos list` in the same shell worked.
// The URL and the API key now resolve through `@hasna/contracts/client`, the same
// five tiers every hosted Hasna CLI uses, fresh on every call.
//
// CANONICAL NAMES AND THE ONE-RELEASE ALIASES. The canonical names are
// `HASNA_EMAILS_API_URL` / `HASNA_EMAILS_API_KEY`, exactly what the shared seam
// reads for the app slug `emails`. The legacy `EMAILS_SELF_HOSTED_URL` /
// `EMAILS_SELF_HOSTED_API_KEY` spellings remain accepted, silently, one rung
// BELOW the canonical names — the same compatibility window skills gave its
// `SKILLS_API_*` names. They are read nowhere else in this package.
//
// THE APP'S OWN PRINCIPALS STAY ABOVE THE RESOLVER. `emails auth login` issues a
// user SESSION token and agents may carry an identity token (ADR-0002). Those are
// the multi-tenancy server's own first-class principals — this package's product,
// not a second client-credential contract — so the client still sends a live
// session token (then an identity token) when one is present, and falls back to
// the @hasna/contracts-resolved API key otherwise. The AUTHORITY (the URL) always
// comes from the shared resolver: the canonical env key (or its alias), the
// Keychain `api-url` item, the credentials file, else the shared default gateway
// once a contracts credential resolves.
//
// THREE OUTCOMES, and no fourth:
//   - a hosted resolution (a URL and a credential: a session, an identity token,
//     or the contracts-resolved key)  → HOSTED.
//   - a URL configured but NO credential → LOUD failure naming what is missing.
//     There is no local fallback: serving local rows while authentication is
//     unconfigured is a false green (owner ruling 2026-09-04).
//   - neither → the caller decides: an explicit database path is the only way
//     back to local SQLite, and it must say so on stderr.
//
// WHY THE TYPES BELOW ARE SPELLED HERE RATHER THAN IMPORTED. This package builds
// with `--packages external` (the AWS SDK and the MCP SDK stay external), so the
// resolver is imported from `@hasna/contracts` at runtime and installed as a real
// dependency. The declarations `tsc` emits are not bundled, though, and this
// module is reachable from the published `./storage` surface (via
// src/lib/mode.ts → src/store-resolution.ts), so an imported `@hasna/contracts`
// type in an EXPORTED signature would land in `dist/**/*.d.ts` as a live module
// import and break every TS consumer that does not install this package's
// dependencies under a global/CLI context (secrets #1782). Every type that
// crosses the published boundary is spelled here; a conformance test asserts the
// spellings match the real declarations.

import {
  ClientTransportConfigurationError,
  CredentialResolutionError,
  appConfigDiskValue,
  clientTransportEnvKeys,
  credentialDiskSources,
  defaultFleetGatewayBaseUrl,
  keychainConfigValue,
  resolveClientTransport,
  resolveCredential,
  toV1BaseUrl,
} from "@hasna/contracts/client";

/** The app slug: the Keychain service, the `~/.hasna/emails` folder, the gateway path. */
export const EMAILS_APP = "emails";

/**
 * The macOS Keychain service prefix for this app's items, composed at runtime so
 * the source and shipped bundles never spell a vendor service name (the package
 * ships no hosted/service endpoint literals; the shared resolver owns them).
 */
const KEYCHAIN_SERVICE_PREFIX = ["hasna", "credentials"].join(".");

/** One of this app's Keychain item names, e.g. the `api-key` item. */
function keychainService(kind: "api-key" | "api-url"): string {
  return `${KEYCHAIN_SERVICE_PREFIX}.${EMAILS_APP}.${kind}`;
}

/** The Keychain item name for this app's API key, for messages and tests. */
export function emailsKeychainItem(kind: "api-key" | "api-url"): string {
  return keychainService(kind);
}

type Env = Record<string, string | undefined>;

// ── locally-spelled crossing types (see header) ─────────────────────────────

/** An environment as the client resolver reads it. */
export type ClientEnv = Record<string, string | undefined>;

/** Which tier of the credential chain supplied a key. */
export type CredentialTier =
  | "argument"
  | "override"
  | "pointer"
  | "profile"
  | "keychain"
  | "disk"
  | "env";

/** The captured outcome of one `security` invocation. `stdout` IS the secret. */
export interface KeychainCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `/usr/bin/security` with the given argv — no shell. Injected by tests. */
export type KeychainCommandRunner = (argv: readonly string[]) => KeychainCommandResult;

/** Keychain-tier controls. Every field is optional; production callers pass nothing. */
export interface KeychainTierOptions {
  /**
   * Whether the Keychain is consulted for a caller-built env object. The tier is
   * AMBIENT: by default it runs only for the live `process.env`. Injecting `run`
   * implies `true`.
   */
  enabled?: boolean;
  /** Defaults to `process.platform`; the tier exists only on `"darwin"`. */
  platform?: string;
  /** The machine's host name (label before the first dot), used when `HASNA_STATION` is unset. */
  hostname?: () => string;
  /** The `security` runner. Defaults to spawning `/usr/bin/security` by argv. */
  run?: KeychainCommandRunner;
}

/** Tier-1 credential inputs plus the Keychain-tier seam. */
export interface CredentialChainOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name, e.g. from `--profile`. Beats `HASNA_PROFILE`. */
  profile?: string;
  /** Tier 3: Keychain controls — a fake `security` runner in tests, an opt-out on CI. */
  keychain?: KeychainTierOptions;
}

/** A credential resolved from one tier of the chain. */
export interface ResolvedCredential {
  readonly apiKey: string;
  readonly tier: CredentialTier;
  /** An env key NAME, an absolute file path, or `keychain:<service>@<account>`. Never a value. */
  readonly source: string;
  /** True for tiers an operator sets on purpose. These never fall through. */
  readonly deliberate: boolean;
  /** The disk paths consulted before this credential was chosen. */
  readonly diskCandidates: readonly string[];
  /** Human-readable advisory. Never contains key material. */
  readonly warning: string | null;
}

// ── the env-key spec, canonical and aliases ─────────────────────────────────

const ENV_KEYS = clientTransportEnvKeys(EMAILS_APP);

/** `HASNA_EMAILS_API_URL`, then the accepted `EMAILS_API_URL` alias. */
export const EMAILS_API_URL_ENV_KEYS: readonly string[] = ENV_KEYS.apiUrlKeys;
/** `HASNA_EMAILS_API_KEY`, then the accepted `EMAILS_API_KEY` alias. */
export const EMAILS_API_KEY_ENV_KEYS: readonly string[] = ENV_KEYS.apiKeyKeys;

/** The canonical spellings, for messages that have to name exactly one. */
export const EMAILS_API_URL_ENV = EMAILS_API_URL_ENV_KEYS[0] as string;
export const EMAILS_API_KEY_ENV = EMAILS_API_KEY_ENV_KEYS[0] as string;

/** The one-release legacy aliases this package still accepts (one rung below canonical). */
export const EMAILS_SELF_HOSTED_URL_ENV = "EMAILS_SELF_HOSTED_URL";
export const EMAILS_SELF_HOSTED_API_KEY_ENV = "EMAILS_SELF_HOSTED_API_KEY";

/** The app's own principals, in precedence order (a live session, then an agent identity). */
export const EMAILS_SESSION_TOKEN_ENV = "EMAILS_SESSION_TOKEN";
export const EMAILS_IDP_TOKEN_ENV = "EMAILS_IDP_TOKEN";

/** Options the client forwards to the shared resolver. */
export interface EmailsFleetOptions {
  credentials?: CredentialChainOptions;
}

/** Which setting supplied a credential: an env key NAME, a file PATH, or a Keychain reference. */
export type EmailsClientCredentialSetting = string;

/** One credential candidate: its setting (safe to log) and its value (never logged). */
export interface EmailsClientCredentialCandidate {
  readonly setting: EmailsClientCredentialSetting;
  readonly value: string;
}

/** The transport decision, with every source named and no key value in it. */
export interface EmailsTransportResolution {
  /** `<origin>/v1` base for the server API. */
  baseUrl: string;
  /** WHERE the URL came from: an env key NAME, a Keychain item reference, a file PATH, or `"default"`. */
  apiUrlSource: string | null;
  /** Whether an API key is present (value never exposed). */
  apiKeyPresent: boolean;
  /** WHERE the API key came from: an env key NAME, a Keychain item reference, a file PATH. Never the value. */
  apiKeySource: string | null;
  /** Which tier of the credential chain supplied the key. */
  apiKeyTier: CredentialTier | null;
  /** Human-readable advisory, or null. Never contains secret values. */
  warning: string | null;
}

/** A hosted resolution: an authority to call and a credential to call it with. */
export interface HostedEmailsTransport {
  mode: "hosted";
  /** `<origin>/v1` base the client dials. */
  baseUrl: string;
  /** The bearer credential. Never logged. */
  credential: string;
  /** Which setting supplied `credential`; safe to report. */
  credentialSetting: string;
  /** Later credentials to try after a session needs reauthentication; values are secrets. */
  credentialFallbacks: ReadonlyArray<{ setting: string; value: string }>;
  resolution: EmailsTransportResolution;
}

/** True when SOMETHING configures a hosted authority for this app. */
export function hostedEmailsAuthorityConfigured(
  env: Env = process.env,
  options: EmailsFleetOptions = {},
): boolean {
  const snapshot = snapshotEmailsEnvironment(env);
  const opts = snapshotEmailsOptions(env, options);
  const keys = clientTransportEnvKeys(EMAILS_APP);
  if (keys.apiUrlKeys.some((key) => (snapshot[key] ?? "").trim().length > 0)) return true;
  if (configuredEmailsApiUrl(snapshot, opts) !== null) return true;
  if (resolveCredential(EMAILS_APP, snapshot, opts.credentials) !== null) return true;
  // The app's own principals count too: a live session or identity token makes
  // this a hosted run even when the operator key lives only in the vault entry.
  if (appPrincipalCredential(snapshot) !== null) return true;
  return false;
}

/** The app's own session/identity token, in precedence order, or null. */
function appPrincipalCredential(env: Env): { setting: string; value: string } | null {
  for (const setting of [EMAILS_SESSION_TOKEN_ENV, EMAILS_IDP_TOKEN_ENV] as const) {
    const value = env[setting]?.trim();
    if (value) return { setting, value };
  }
  return null;
}

/**
 * Capture the configuration this package and the resolver read, translating the
 * one-release aliases onto the canonical names during the copy.
 *
 * The returned object is a COPY — but the copy is handed to the resolver with
 * the Keychain tier explicitly enabled (see {@link snapshotEmailsOptions}), which
 * is the #1788-sanctioned shape: the Keychain/disk tiers stay AMBIENT by default
 * and are never silently disabled for a caller-built environment. The aliases
 * are translated here (not in `process.env`) so nothing else in the package has
 * to know about the compatibility window.
 */
export function snapshotEmailsEnvironment(env: Env = process.env): Env {
  const snapshot: Env = {};
  const ownKeys = new Set([
    ...ENV_KEYS.apiUrlKeys,
    ...ENV_KEYS.apiKeyKeys,
    EMAILS_SELF_HOSTED_URL_ENV,
    EMAILS_SELF_HOSTED_API_KEY_ENV,
    EMAILS_SESSION_TOKEN_ENV,
    EMAILS_IDP_TOKEN_ENV,
    "HOME",
    "USER",
    "HASNA_HOME",
    "HASNA_CONFIG_HOME",
    "HASNA_STATION",
  ]);
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(env, key);
    if (!descriptor || !("value" in descriptor)) continue;
    const raw = String(descriptor.value ?? "");
    snapshot[key] = raw;
  }
  // Alias -> canonical, one rung below: a canonical value always wins; a blank
  // canonical is treated as unset so an alias can supply it.
  const urlAlias = snapshot[EMAILS_SELF_HOSTED_URL_ENV]?.trim();
  if (urlAlias && !(snapshot[ENV_KEYS.apiUrlKeys[0]!] ?? "").trim()) {
    snapshot[ENV_KEYS.apiUrlKeys[0]!] = urlAlias;
  }
  const keyAlias = snapshot[EMAILS_SELF_HOSTED_API_KEY_ENV]?.trim();
  if (keyAlias && !(snapshot[ENV_KEYS.apiKeyKeys[0]!] ?? "").trim()) {
    snapshot[ENV_KEYS.apiKeyKeys[0]!] = keyAlias;
  }
  return Object.freeze(snapshot);
}

/** Preserve the Keychain-tier ambient decision for a caller-built snapshot. */
function snapshotEmailsOptions(env: Env, options: EmailsFleetOptions): EmailsFleetOptions {
  if (env !== process.env) return options;
  return {
    ...options,
    credentials: {
      ...options.credentials,
      keychain: {
        ...options.credentials?.keychain,
        enabled: options.credentials?.keychain?.enabled ?? true,
      },
    },
  };
}

/** One configured authority: its value and the source that decided it. */
export interface ConfiguredEmailsApiUrl {
  value: string;
  /** An env key NAME, a `keychain:<service>@<account>` reference, or an absolute path. */
  source: string;
}

/**
 * The authority an operator configured, in the shared seam's precedence order —
 * environment (canonical then alias), then the Keychain `api-url` item, then the
 * credentials file.
 *
 * Returns null when nothing configures one. The shared default gateway applies
 * only once a CONTRACTS credential resolves (see {@link resolveEmailsHostedTransport}),
 * so an install with no credential still names no host at all.
 */
export function configuredEmailsApiUrl(
  env: Env = process.env,
  options: EmailsFleetOptions = {},
): ConfiguredEmailsApiUrl | null {
  const snapshot = snapshotEmailsEnvironment(env);
  const opts = snapshotEmailsOptions(env, options);
  const keys = clientTransportEnvKeys(EMAILS_APP);
  for (const key of keys.apiUrlKeys) {
    const raw = snapshot[key]?.trim();
    if (raw) return { value: raw, source: key };
  }
  const fromKeychain = keychainConfigValue(EMAILS_APP, snapshot, opts.credentials?.keychain);
  if (fromKeychain) return { value: fromKeychain.value.trim(), source: fromKeychain.source };
  const fromDisk = appConfigDiskValue(EMAILS_APP, snapshot, keys.apiUrlKeys);
  if (fromDisk?.unusable) {
    throw new ClientTransportConfigurationError(
      EMAILS_APP,
      `${fromDisk.key} in ${fromDisk.path} is declared but blank or malformed; ` +
        `a Emails authority must be a valid https URL (or an exact loopback http URL).`,
      [fromDisk.key],
    );
  }
  if (fromDisk) return { value: fromDisk.value.trim(), source: fromDisk.path };
  return null;
}

/** The credential file paths consulted, for a message that has to name them. */
export function emailsCredentialFiles(env: Env = process.env): string[] {
  return credentialDiskSources(EMAILS_APP, snapshotEmailsEnvironment(env));
}

/**
 * True for the shared seam's configuration error, across bundle boundaries.
 */
export function isEmailsTransportConfigurationError(error: unknown): boolean {
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

/**
 * Resolve the hosted transport: the URL from the configured authority (or the
 * shared default gateway once a contracts credential resolves) and the credential
 * from the app's own principals, else the contracts-resolved key.
 *
 * Fresh on every call: a long-lived process (an MCP server, a daemon) picks up a
 * key rotation or a new session without being rebuilt.
 *
 * FAILS LOUD: a URL without a credential, or a credential without a URL, throws
 * naming what is missing. There is no local-data return branch.
 */
export function resolveEmailsHostedTransport(
  env: Env = process.env,
  options: EmailsFleetOptions = {},
): HostedEmailsTransport {
  const snapshot = snapshotEmailsEnvironment(env);
  const opts = snapshotEmailsOptions(env, options);

  // The shared resolver owns every credential tier. Resolve it once.
  let contractsCredential: ResolvedCredential | null = null;
  try {
    contractsCredential = resolveCredential(EMAILS_APP, snapshot, opts.credentials);
  } catch (error) {
    // A deliberate selection that cannot be honoured is a refusal, not "no key".
    if (isCredentialResolutionError(error) || isEmailsTransportConfigurationError(error)) {
      throw error;
    }
    throw error;
  }

  const principal = appPrincipalCredential(snapshot);
  const credential = principal ?? (contractsCredential ? { setting: contractsCredential.source, value: contractsCredential.apiKey } : null);

  let configured: ConfiguredEmailsApiUrl | null = null;
  try {
    configured = configuredEmailsApiUrl(snapshot, opts);
  } catch (error) {
    if (isEmailsTransportConfigurationError(error)) throw error;
    throw error;
  }

  const gateway = contractsCredential ? defaultFleetGatewayBaseUrl(EMAILS_APP) : null;
  const apiUrl = configured?.value ?? gateway;
  const urlSource = configured?.source ?? (contractsCredential ? "default" : null);

  // Validate the authority FIRST, so a malformed URL is reported even when no
  // credential resolves — a bad URL is the stronger signal. Then the credential
  // checks name the exact shape of the miss.
  let baseUrl: string | null = null;
  if (apiUrl) {
    baseUrl = normalizeEmailsBaseUrl(apiUrl, urlSource);
  }

  if (!credential) {
    if (configured) {
      throw new ClientTransportConfigurationError(
        EMAILS_APP,
        `${configured.source} points this client at an Emails service but no API credential ` +
          `resolved — refusing to run locally instead. Looked in the Keychain item ` +
          `${keychainService("api-key")}${emailsCredentialFiles(snapshot).length > 0 ? `, in ` +
          `${emailsCredentialFiles(snapshot).join(" or ")}` : ""}, and in ${EMAILS_API_KEY_ENV} ` +
          `(or its alias ${EMAILS_SELF_HOSTED_API_KEY_ENV}). ` +
          `Set ${EMAILS_API_KEY_ENV} (or ${EMAILS_SELF_HOSTED_API_KEY_ENV}), store the key in the ` +
          `Keychain item ${keychainService("api-key")}, or write ` +
          `~/.hasna/${EMAILS_APP}/config/credentials.`,
        [EMAILS_API_KEY_ENV],
      );
    }
    throw new ClientTransportConfigurationError(
      EMAILS_APP,
      `No Emails API credential resolved and no authority is configured — refusing to start. ` +
        `Set ${EMAILS_API_KEY_ENV} and ${EMAILS_API_URL_ENV} (or ${EMAILS_SELF_HOSTED_API_KEY_ENV} and ` +
        `${EMAILS_SELF_HOSTED_URL_ENV}), store the key in the Keychain item ` +
        `${keychainService("api-key")}, or write ~/.hasna/${EMAILS_APP}/config/credentials. ` +
        `To use the local database instead, choose it explicitly by setting a database path.`,
      [EMAILS_API_KEY_ENV, EMAILS_API_URL_ENV],
    );
  }

  if (!baseUrl) {
    throw new ClientTransportConfigurationError(
      EMAILS_APP,
      `A credential resolves but no Emails API URL is configured — refusing to guess an endpoint. ` +
        `Set ${EMAILS_API_URL_ENV} (or ${EMAILS_SELF_HOSTED_URL_ENV}), store the api-url in the Keychain item ` +
        `${keychainService("api-url")}, or write ~/.hasna/${EMAILS_APP}/config/credentials.`,
      [EMAILS_API_URL_ENV],
    );
  }

  const fallbacks: Array<{ setting: string; value: string }> = [];
  if (principal) {
    // A session/identity token is the primary credential; the contracts-resolved
    // key (if any) is the fallback the transport tries after `reauthenticate`.
    if (contractsCredential) {
      fallbacks.push({ setting: contractsCredential.source, value: contractsCredential.apiKey });
    }
  }

  const resolution: EmailsTransportResolution = {
    baseUrl,
    apiUrlSource: urlSource,
    apiKeyPresent: true,
    apiKeySource: credential.setting,
    apiKeyTier: contractsCredential?.tier ?? (principal ? "env" : null),
    warning: contractsCredential?.warning ?? null,
  };

  return {
    mode: "hosted",
    baseUrl,
    credential: credential.value,
    credentialSetting: credential.setting,
    credentialFallbacks: Object.freeze(fallbacks),
    resolution,
  };
}

/**
 * Resolve the authority alone, for a flow that is ACQUIRING a credential
 * (`emails auth signup|login` must not require one). Returns null when no
 * authority is configured and no contracts credential implies a gateway.
 */
export function resolveEmailsApiUrl(
  env: Env = process.env,
  options: EmailsFleetOptions = {},
): { value: string; source: string } | null {
  const snapshot = snapshotEmailsEnvironment(env);
  const opts = snapshotEmailsOptions(env, options);
  const configured = configuredEmailsApiUrl(snapshot, opts);
  if (configured) return configured;
  try {
    resolveClientTransport(EMAILS_APP, snapshot, opts);
    return { value: defaultFleetGatewayBaseUrl(EMAILS_APP), source: "default" };
  } catch {
    return null;
  }
}

/**
 * Normalize a configured Emails authority to the `<origin>/v1` base through the
 * shared URL primitive, and translate its refusals into this package's typed
 * configuration error naming the source that supplied the bad URL.
 */
function normalizeEmailsBaseUrl(apiUrl: string, source: string | null): string {
  try {
    return toV1BaseUrl(apiUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ClientTransportConfigurationError(
      EMAILS_APP,
      source ? `${source} ${sentenceJoin(reason)}` : reason,
      source ? [source] : [EMAILS_API_URL_ENV],
    );
  }
}

function sentenceJoin(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  return /[.!?]$/.test(trimmed) ? `is not usable: ${trimmed}` : `is not usable: ${trimmed}.`;
}

/** The credentials file paths for a message that must name them. */
export { emailsCredentialFiles as emailsCredentialDiskSources };
