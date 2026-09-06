/**
 * The app's authority + credential boundary: the ONE resolver in
 * `@hasna/contracts/client` (owner directive 2026-09-04, hasna/apps#1720).
 *
 * Retired with this rewrite — the per-app env chain is gone:
 *
 *   - `*_MODE` / `*_STORAGE_MODE` switches (no transport is ever selected by a
 *     mode word; the resolver decides by what RESOLVES, and hosted mode fails
 *     loud when nothing does),
 *   - client database URLs / `DB_PATH` (a client never opens a database),
 *   - `~/.hasna/fleet-env`, `~/.hasna/cloud`, `~/.config/hasna`,
 *     `$XDG_CONFIG_HOME`, and any `~/.attachments/config.json` key store
 *     (nothing reads them; an operator who still writes one gets the resolver's
 *     env/Keychain/disk tiers instead),
 *   - the DEPRECATED legacy-notice machinery (the resolver accepts the
 *     unprefixed aliases as a silent, lower-precedence fallback for one
 *     release; it never prints a deprecation notice).
 *
 * The chain, resolved FRESH on every call (a long-lived MCP server or SDK
 * client therefore picks up a rotation without being rebuilt):
 *
 *   1. an explicit argument        — `credentials.apiKey` / `credentials.profile`
 *   2. a deliberate env pointer    — `HASNA_ATTACHMENTS_API_KEY_OVERRIDE`,
 *                                    `HASNA_PROFILE`, `HASNA_ATTACHMENTS_API_KEY_REF`
 *   3. the macOS Keychain          — generic-password `hasna.credentials.attachments.api-key`,
 *                                    account `HASNA_STATION`, else `hostname -s`, else `USER`
 *   4. disk                        — `~/.hasna/attachments/config/credentials`, owner-only
 *                                    (`HASNA_HOME` / `HASNA_CONFIG_HOME` move the root)
 *   5. `HASNA_ATTACHMENTS_API_KEY` — a legitimate tier below disk, no deprecation notice
 *
 * and the authority follows `HASNA_ATTACHMENTS_API_URL`, the Keychain `api-url`
 * item, the credentials file, and finally DEFAULTS to the fleet gateway
 * `https://api.hasna.com/attachments` (the client appends `/v1`). The legacy
 * unprefixed `ATTACHMENTS_*` spellings survive only as the resolver's silent
 * alias fallback for one release.
 *
 * FAIL LOUD: hosted mode with no credential throws — there is no SQLite
 * fallback, no local-fallback event, and no local default.
 */
import {
  ClientTransportConfigurationError,
  clientTransportEnvKeys,
  resolveClientTransport,
  resolveCredential,
  type ResolveClientTransportOptions,
} from "@hasna/contracts/client";

/** Process-environment shape accepted by the shared seam. */
export type Env = Record<string, string | undefined>;

/** Locally spelled so the published `.d.ts` never imports @hasna/contracts (#1782). */
export type AttachmentsCredentialTier =
  | "argument"
  | "override"
  | "pointer"
  | "profile"
  | "keychain"
  | "disk"
  | "env";

/** The captured outcome of one injected `security` invocation (locally spelled). */
export interface KeychainCommandResult {
  /** Exit status; null when the tool could not be started or was killed. */
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Credential-chain options, locally spelled mirror of the shared seam's
 * `CredentialChainOptions` (published declarations must not import
 * `@hasna/contracts`, #1782). Structurally identical, so it is handed to the
 * resolver as-is.
 */
export interface AttachmentsCredentialChainOptions {
  /** Tier 1: an explicit key, e.g. from `--api-key`. */
  apiKey?: string;
  /** Tier 1: an explicit profile name, e.g. from `--profile`. Beats `HASNA_PROFILE`. */
  profile?: string;
  /** Tier 3: Keychain controls — a fake `security` runner in tests, an opt-out on CI. */
  keychain?: {
    enabled?: boolean;
    /** Defaults to `process.platform`; the tier exists only on `"darwin"`. */
    platform?: string;
    hostname?: () => string;
    run?: (argv: readonly string[]) => KeychainCommandResult;
  };
}

/** The env key names the resolver consults, locally spelled (messages and diagnostics only). */
export interface AttachmentsClientEnvKeys {
  /** API base-URL keys, in precedence order. */
  apiUrlKeys: string[];
  /** API-key keys, in precedence order. */
  apiKeyKeys: string[];
}

/** The resolver's answer: WHERE the credential and authority came from. Never a value except `apiKey`. */
export interface AttachmentsTransportResolution {
  /** The authority the client talks to — origin + path prefix, WITHOUT `/v1` (the legacy `url` shape). */
  url: string;
  /** The resolver's `<origin>/v1` base. */
  baseUrl: string;
  /**
   * The credential. NON-ENUMERABLE on the returned object — enumeration,
   * spread and JSON serialization cannot spill it (property access works).
   */
  apiKey: string;
  /** WHERE the key came from — an env key NAME, a Keychain reference, or an absolute file PATH. Never a value. */
  apiKeySource: string | null;
  apiKeyTier: AttachmentsCredentialTier;
  /** WHERE the authority came from, or `"default"` when the fleet gateway applies. */
  apiUrlSource: string | null;
  /** Which source selected the transport (env key name, Keychain reference, path, or `"default"`). */
  transportSource: string;
  /** Human-readable advisory; never contains key material. */
  warning: string | null;
}

export interface ResolveAttachmentsTransportOptions {
  /** Tier-1 credential inputs (`--api-key` / `--profile`) and Keychain-tier controls. */
  credentials?: AttachmentsCredentialChainOptions;
}

/** Remove the resolver's `/v1` suffix; callers that compose their own version segments get the origin. */
export function stripV1(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/**
 * The env key names the resolver consults for attachments. Used for messages
 * and diagnostics only — never as a way to read a value past the seam.
 */
export function attachmentsClientEnvKeys(): AttachmentsClientEnvKeys {
  return clientTransportEnvKeys("attachments");
}

/**
 * Resolve the authoritative transport fresh: one pass down the credential
 * chain, one pass over the authority ladder, both in `@hasna/contracts`.
 * Throws on missing, blank, conflicting or invalid configuration — there is
 * no local return branch.
 */
export function resolveAttachmentsTransport(
  env: Env = process.env,
  options: ResolveAttachmentsTransportOptions = {},
): AttachmentsTransportResolution {
  const credentials: AttachmentsCredentialChainOptions = options.credentials ?? {};

  // ONE Keychain pass, not two. Resolution would otherwise spawn
  // `/usr/bin/security` once for the credential value and again inside the
  // transport pass for the same item; handing the resolved value down as
  // tier 1 makes the second pass return it immediately. The transport still
  // decides the authority exactly as before. This also closes a TOCTOU: the
  // key the transport validated and the key we send are the same read.
  const credential = resolveCredential("attachments", env, credentials);
  const chainOptions: ResolveClientTransportOptions = credential
    ? { credentials: { ...credentials, apiKey: credential.apiKey } }
    : { credentials };
  const resolution = resolveClientTransport("attachments", env, chainOptions);

  const apiKey = credential?.apiKey;
  if (!apiKey) {
    // Unreachable: the transport throws whenever no credential resolves. The
    // guard is the loud local refusal that keeps an unauthenticated client
    // from ever being constructed if the two calls drift apart.
    const [urlKey] = clientTransportEnvKeys("attachments").apiUrlKeys;
    throw new ClientTransportConfigurationError(
      "attachments",
      `${urlKey} is not set and no API key could be resolved for 'attachments'; ` +
        `refusing to construct an unauthenticated client. Looked at ` +
        `HASNA_ATTACHMENTS_API_KEY_OVERRIDE / HASNA_PROFILE / HASNA_ATTACHMENTS_API_KEY_REF, the Keychain ` +
        `item hasna.credentials.attachments.api-key, ~/.hasna/attachments/config/credentials, then ` +
        `HASNA_ATTACHMENTS_API_KEY.`,
      [resolution.transportSource],
    );
  }

  const report = {
    url: stripV1(resolution.baseUrl),
    baseUrl: resolution.baseUrl,
    apiKey,
    apiKeySource: credential.source,
    apiKeyTier: credential.tier,
    apiUrlSource: resolution.apiUrlSource,
    transportSource: resolution.transportSource,
    warning: resolution.warning,
  };
  // The value stays a defensible property without being spilled by
  // enumeration, spread, serialization or inspection — the same seal the
  // shared seam applies to its own ResolvedCredential.
  Object.defineProperty(report, "apiKey", {
    value: apiKey,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return report;
}