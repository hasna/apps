/**
 * The transport seam for @hasna/hooks — the ONE place the remote-registry
 * authority and its credential resolve.
 *
 * There is exactly ONE resolver on the fleet — the client chain in
 * `@hasna/contracts/client` — and this module is hooks' adapter onto it
 * (2026-09-04 adoption ruling, hasna/apps#1720). hooks used to carry its own
 * chain: a URL ladder reading `HASNA_HOOKS_API_URL` / `HOOKS_API_URL` /
 * `HASNA_HOOKS_REGISTRY_URL` / `HOOKS_REGISTRY_URL` and then the `api_url`
 * field of `~/.hasna/hooks/config.json`, with the key resolved separately — a
 * LOOSE pair where a URL alone proceeded and a key was only demanded by the
 * publish route. All of it is gone. The chain is the fleet's five, resolved
 * fresh on every call:
 *
 *   1. an explicit argument      — `credentials.apiKey` / `credentials.profile`
 *   2. a deliberate env pointer  — `HASNA_HOOKS_API_KEY_OVERRIDE`, `HASNA_PROFILE`,
 *                                  `HASNA_HOOKS_API_KEY_REF`
 *   3. the macOS Keychain        — `hasna.credentials.hooks.api-key` / `.api-url`
 *   4. disk                      — `~/.hasna/hooks/config/credentials` (0400/0600)
 *   5. `HASNA_HOOKS_API_KEY`     — a legitimate tier, no deprecation notice
 *
 * with the registry URL following `HASNA_HOOKS_API_URL`, the Keychain `api-url`
 * item, the credentials file, and finally the fleet gateway
 * `https://api.hasna.com/hooks`. The legacy unprefixed `HOOKS_*` spellings
 * remain only as the resolver's silent alias fallback for one release.
 *
 * STRICT PAIR, FAIL LOUD. A registry URL selects the remote registry and a
 * credential is REQUIRED with it: hosted configuration that resolves a URL but
 * no key is a refusal (REMOTE_API_KEY_MISSING / REMOTE_API_CONFIG_MISSING),
 * never half-open progress and never a silent local read. There is no local
 * fallback and no local-fallback event: local mode (bundled registry + local
 * SQLite store) is reachable ONLY through the explicit opt-in
 * `HASNA_HOOKS_LOCAL=1` (alias `HOOKS_LOCAL=1`), and a local run says so once
 * per process on stderr.
 *
 * The registry API surface lives at `<origin>/api/v1` (catalog, lock,
 * artifacts) while the resolver normalises authorities to `<origin>/v1`, so
 * {@link hooksRegistryOrigin} strips the resolver's `/v1` suffix back to the
 * origin the registry routes hang off.
 *
 * ONE PASS DOWN THE CHAIN, NOT TWO. `resolveClientTransport` resolves the
 * credential internally but deliberately returns only its SOURCE, so reading
 * the value used to mean calling `resolveCredential` again one line later —
 * and on macOS each pass spawns `/usr/bin/security`, so a surface that
 * re-resolves per request paid two spawns per request for one answer.
 * Resolving here and handing the value down as the chain's tier-1 argument
 * makes the second pass a no-op instead: tier 1 returns immediately, so the
 * transport still decides the authority exactly as before while consulting the
 * Keychain once. It also closes a real TOCTOU — the key the transport
 * validated and the key we sent were two separate reads, and a rotation
 * between them made them different keys.
 */
import {
  CredentialResolutionError,
  resolveClientTransport,
  resolveCredential,
  type ClientTransportResolution,
} from "@hasna/contracts/client";
import { getHooksDataDir } from "../config.js";
import { hooksResolverInputs, selectsHooksLocalStore } from "./local-opt-in.js";
import type { HooksCredentialOptions, HooksLocalOptInEnv } from "./resolver-types.js";
/** The unhosted mode: bundled registry + local SQLite store. Never a default. */
export type HooksTransportMode = "remote" | "local";

/** The resolved remote-registry authority pair. Never carries a value besides `apiKey`. */
export interface HooksRemoteAuthority {
  /**
   * Registry origin WITHOUT the `/v1` suffix the resolver appends — the sync
   * client composes `/api/v1/...` routes on top of it.
   */
  origin: string;
  /** The credential, resolved together with the authority it will be sent to. */
  apiKey: string;
  /** WHERE the authority came from: an env key NAME, a Keychain item reference, a file PATH, or "default". */
  apiUrlSource: string | null;
  /** WHERE the credential came from: an env key NAME, a Keychain item reference, or a file PATH. Never a value. */
  apiKeySource: string | null;
  /** Which tier of the chain supplied the credential. */
  apiKeyTier: string | null;
  /** The resolver's `<origin>/v1` base, for diagnostics. */
  v1BaseUrl: string;
  /** Human-readable warning, or null. Never contains secret values. */
  warning: string | null;
}

/**
 * The transport decision every hosted surface makes: remote (resolver-backed)
 * or local (explicit opt-in, resolver never consulted).
 *
 * Local mode returns `authority: null` and carries no key. Remote mode always
 * carries a fully resolved pair — the seam throws before returning a
 * half-configured one.
 */
export interface HooksTransportResolution {
  mode: HooksTransportMode;
  /** `"local-opt-in"` for the deliberate unhosted store, else `"<api key source>+<api url source>"`. */
  source: string;
  /** The resolved remote pair; null in local mode. */
  authority: HooksRemoteAuthority | null;
}

/** Where the one-line local-mode notice goes. Defaults to `process.stderr`. */
export type HooksTransportNotice = (line: string) => void;

let localNoticePrinted = false;

/** Reset the once-per-process local-mode notice. Test seam only. */
export function __resetHooksLocalNotice(): void {
  localNoticePrinted = false;
}

function announceLocal(notice: HooksTransportNotice | undefined, reason: string): void {
  if (localNoticePrinted) return;
  localNoticePrinted = true;
  const line =
    `hooks: LOCAL mode — ${reason}; using the bundled registry and the local store at ` +
    `${getHooksDataDir()}, not a remote registry. Set HASNA_HOOKS_API_KEY (or the Keychain item ` +
    `hasna.credentials.hooks.api-key / ~/.hasna/hooks/config/credentials) to go remote.`;
  if (notice) notice(line);
  else if (typeof process !== "undefined") process.stderr.write(`${line}\n`);
}

/**
 * Announce the unhosted mode on stderr, once per process. Surfaces that never
 * resolve the transport (the CLI gate opening through the opt-in) still have
 * to SAY the run is local — the "local on stderr" doctrine (2026-09-04).
 */
export function announceHooksLocalMode(
  reason = "HASNA_HOOKS_LOCAL is set and nothing configures a registry authority",
  notice?: HooksTransportNotice,
): void {
  announceLocal(notice, reason);
}

/** Strip the `/v1` suffix the resolver normalised onto the authority. */
export function hooksRegistryOrigin(v1BaseUrl: string): string {
  return v1BaseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/**
 * Re-throw a `@hasna/contracts` resolution failure as hooks' own fail-closed
 * diagnostic, preserving the resolver's message (which names every tier it
 * consulted) behind the stable `REMOTE_API_*` code callers match on. Nothing
 * here ever returns a client or a local store: every arm throws.
 */
export function rethrowHooksAuthorityFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  // CredentialFileUnsafeError is not re-exported from @hasna/contracts/client
  // (1.0.2), so the unsafe-file refusal is matched by name, like todos.
  if (name === "CredentialResolutionError" || name === "CredentialFileUnsafeError") {
    throw new Error(
      `REMOTE_API_CREDENTIAL_INVALID: ${message} There is no local fallback: ` +
        "local mode is opt-in only (HASNA_HOOKS_LOCAL=1) and is disabled by default — failing closed",
      { cause: error },
    );
  }
  if (/no API key could be resolved/.test(message)) {
    if (/is not set and no API key could be resolved/.test(message)) {
      throw new Error(
        "REMOTE_API_CONFIG_MISSING: no hooks registry credential resolved from the Keychain item " +
          `hasna.credentials.hooks.api-key, ~/.hasna/hooks/config/credentials, or HASNA_HOOKS_API_KEY. ${message} ` +
          "There is no local fallback: local mode is opt-in only (HASNA_HOOKS_LOCAL=1, alias HOOKS_LOCAL=1) " +
          "and is disabled by default — failing closed instead of serving the local store",
        { cause: error },
      );
    }
    throw new Error(
      "REMOTE_API_KEY_MISSING: the remote hooks registry requires HASNA_HOOKS_API_KEY, the Keychain item " +
        `hasna.credentials.hooks.api-key, or ~/.hasna/hooks/config/credentials. ${message} ` +
        "There is no local fallback: local mode is opt-in only (HASNA_HOOKS_LOCAL=1) and is disabled by default — failing closed",
      { cause: error },
    );
  }
  throw new Error(
    `REMOTE_API_URL_INVALID: ${message} local mode fallback is disabled`,
    { cause: error },
  );
}

/** Tier-1 credential inputs and Keychain-tier controls, forwarded verbatim. */
export type { HooksCredentialOptions } from "./resolver-types.js";

export interface HooksTransportOptions {
  /** Tier-1 credential inputs (`--api-key` / `--profile`) and the injectable `security` runner tests use. */
  credentials?: HooksCredentialOptions;
  /** Where the one-line local-mode notice goes. Defaults to `process.stderr`. */
  notice?: HooksTransportNotice;
}

/**
 * Resolve the hooks transport. The deliberate unhosted opt-in is answered
 * first and WITHOUT consulting the resolver; otherwise `@hasna/contracts`
 * resolves the credential AND the authority together as one strict pair, and
 * any failure to do so is a throw — the client never defaults to the on-box
 * store (owner ruling 2026-09-04). Resolved fresh on every call.
 */
export function resolveHooksTransport(
  env: HooksLocalOptInEnv = process.env,
  options: HooksTransportOptions = {},
): HooksTransportResolution {
  if (selectsHooksLocalStore(env)) {
    announceLocal(options.notice, "HASNA_HOOKS_LOCAL is set and nothing configures a registry authority");
    return { mode: "local", source: "local-opt-in", authority: null };
  }

  const { env: resolverEnv, credentials } = hooksResolverInputs(env, options.credentials);
  const tier1 = options.credentials?.apiKey;
  const credentialOptions: HooksCredentialOptions =
    tier1 !== undefined ? { ...credentials, apiKey: tier1 } : credentials;

  let resolution: ClientTransportResolution;
  let credential: ReturnType<typeof resolveCredential>;
  try {
    // ONE pass down the chain: resolve the credential, then hand its value
    // back as tier 1 so the transport validates the SAME key it reports
    // without consulting the Keychain a second time.
    credential = resolveCredential("hooks", resolverEnv, credentialOptions);
    resolution = resolveClientTransport("hooks", resolverEnv, {
      credentials: credential ? { ...credentialOptions, apiKey: credential.apiKey } : credentialOptions,
    });
  } catch (error) {
    rethrowHooksAuthorityFailure(error);
  }
  // The resolver refuses to return a resolution without a credential, so a
  // null here is unreachable — but the pair must stay a STRICT pair even if a
  // future resolver generation changes that.
  if (!credential) {
    throw new Error(
      "REMOTE_API_CONFIG_MISSING: no hooks registry credential resolved; " +
        "local mode fallback is disabled",
    );
  }
  return {
    mode: "remote",
    // The TRUE source, not the tier-1 spelling the transport was handed:
    // passing the value down as an argument makes the transport report
    // "explicit apiKey argument", which would erase the Keychain/disk/env
    // origin an operator needs in a diagnostic. `credential.source` is that
    // origin, and never a value.
    source: `${credential.source}+${resolution.apiUrlSource ?? "default"}`,
    authority: {
      origin: hooksRegistryOrigin(resolution.baseUrl),
      apiKey: credential.apiKey,
      apiUrlSource: resolution.apiUrlSource,
      apiKeySource: credential.source,
      apiKeyTier: credential.tier,
      v1BaseUrl: resolution.baseUrl,
      warning: resolution.warning,
    },
  };
}

/**
 * The registry keys the publish surface checks. Local-by-design commands
 * (`hooks serve`) never pick a transport; they only need to know whether a
 * credential exists to honour a PUT. Resolved fresh on every call, through the
 * same chain as {@link resolveHooksTransport}, so a key rotation heals a
 * long-lived server without a restart.
 *
 * Returns `undefined` when no credential resolves — reads stay open and
 * publish refuses — and THROWS on a deliberate tier that exists but cannot be
 * honoured (a locked Keychain, an unsafe credential file), because falling
 * through to another identity is the one silent failure the chain exists to
 * end.
 */
export function resolveHooksServePublishKey(
  env: HooksLocalOptInEnv = process.env,
  options: HooksTransportOptions = {},
): string | undefined {
  const { env: resolverEnv, credentials } = hooksResolverInputs(env, options.credentials);
  const tier1 = options.credentials?.apiKey;
  const credentialOptions: HooksCredentialOptions =
    tier1 !== undefined ? { ...credentials, apiKey: tier1 } : credentials;
  return resolveCredential("hooks", resolverEnv, credentialOptions)?.apiKey;
}