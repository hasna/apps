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
 * TRANSPORT SELECTION, NOT A MODE AXIS. The storage-mode axis is retired
 * (owner directive 2026-08-15): no `*_MODE` switch exists, no command is
 * gated on the transport, and there is no second-class "local mode" to opt
 * into. Every command works in BOTH transports:
 *
 *   - hosted — any registry authority + credential the chain resolves
 *     (env pair, Keychain items, or the credentials file) drives registry
 *     reads (sync, pinned installs) against that origin;
 *   - local — the bundled registry + the on-box SQLite store at the
 *     effective data root. Local is the baseline: when nothing configures a
 *     registry authority, commands simply use it.
 *
 * STRICT PAIR, FAIL LOUD — for DECLARED intent only. A DECLARED authority
 * (any authority/credential env name set) that cannot resolve a credential is
 * a refusal (REMOTE_API_KEY_MISSING / REMOTE_API_CONFIG_MISSING), never
 * half-open progress and never a silent local read: a tier the operator named
 * must never fall through to a different dataset. An environment that
 * declares nothing simply uses the local store — the baseline, not a
 * fallback that had to be earned. `HASNA_HOOKS_LOCAL=1` (alias
 * `HOOKS_LOCAL=1`) remains accepted as an explicit local selection and short-
 * circuits the chain before any Keychain/disk consultation, preserving the
 * hermetic promise for scrubbed environments.
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
import { hasHooksEnvAuthorityIntent, hooksResolverInputs, selectsHooksLocalStore } from "./local-opt-in.js";
import type { HooksCredentialOptions, HooksLocalOptInEnv } from "./resolver-types.js";
/** The transport: remote (resolver-backed registry) or local (bundled registry + on-box store). */
export type HooksTransportKind = "remote" | "local";

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
 * The transport decision every surface makes: remote (resolver-backed) or
 * local (bundled registry + on-box store).
 *
 * Local returns `authority: null` and carries no key. Remote always carries
 * a fully resolved pair — the seam throws before returning a half-configured
 * one when the environment DECLARED an authority it cannot honour.
 */
export interface HooksTransportResolution {
  kind: HooksTransportKind;
  /** `"local"` for the on-box store, else `"<api key source>+<api url source>"`. */
  source: string;
  /** The resolved remote pair; null on the local transport. */
  authority: HooksRemoteAuthority | null;
}

/** Where the one-line local-store notice goes. Defaults to `process.stderr`. */
export type HooksTransportNotice = (line: string) => void;

let localNoticePrinted = false;

/** Reset the once-per-process notice. Test seam only. */
export function __resetHooksLocalNotice(): void {
  localNoticePrinted = false;
}

function announceLocal(notice: HooksTransportNotice | undefined, reason: string): void {
  if (localNoticePrinted) return;
  localNoticePrinted = true;
  const line =
    `hooks: no registry authority resolved (${reason}); using the bundled registry and the local ` +
    `store at ${getHooksDataDir()}. Configure a registry with HASNA_HOOKS_API_URL + a credential ` +
    `(HASNA_HOOKS_API_KEY, the Keychain item hasna.credentials.hooks.api-key, or ` +
    `~/.hasna/hooks/config/credentials) to go hosted.`;
  if (notice) notice(line);
  else if (typeof process !== "undefined") process.stderr.write(`${line}\n`);
}

/** Strip the `/v1` suffix the resolver normalised onto the authority. */
export function hooksRegistryOrigin(v1BaseUrl: string): string {
  return v1BaseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/**
 * Re-throw a `@hasna/contracts` resolution failure as hooks' own strict-pair
 * diagnostic, preserving the resolver's message (which names every tier it
 * consulted) behind the stable `REMOTE_API_*` code callers match on. Called
 * ONLY when the environment declared a registry authority that could not be
 * honoured — an undeclared environment uses the local store instead.
 */
export function rethrowHooksAuthorityFailure(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  // CredentialFileUnsafeError is not re-exported from @hasna/contracts/client
  // (1.0.2), so the unsafe-file refusal is matched by name, like todos.
  if (name === "CredentialResolutionError" || name === "CredentialFileUnsafeError") {
    throw new Error(
      `REMOTE_API_CREDENTIAL_INVALID: ${message} A declared registry tier that cannot be honoured ` +
        "is a refusal — refusing to fall through to a different dataset. Set the env pair " +
        "(HASNA_HOOKS_API_URL + HASNA_HOOKS_API_KEY) or HASNA_HOOKS_LOCAL=1 for the local store.",
      { cause: error },
    );
  }
  if (/no API key could be resolved/.test(message)) {
    if (/is not set and no API key could be resolved/.test(message)) {
      throw new Error(
        "REMOTE_API_CONFIG_MISSING: no hooks registry credential resolved from the Keychain item " +
          `hasna.credentials.hooks.api-key, ~/.hasna/hooks/config/credentials, or HASNA_HOOKS_API_KEY. ${message} ` +
          "The declared authority requires a credential — refusing to fall through to a different " +
          "dataset. Set HASNA_HOOKS_API_URL + HASNA_HOOKS_API_KEY together, or HASNA_HOOKS_LOCAL=1 " +
          "for the local store",
        { cause: error },
      );
    }
    throw new Error(
      "REMOTE_API_KEY_MISSING: the remote hooks registry requires HASNA_HOOKS_API_KEY, the Keychain item " +
        `hasna.credentials.hooks.api-key, or ~/.hasna/hooks/config/credentials. ${message} ` +
        "A declared URL without a credential is a refusal — refusing to fall through to a " +
        "different dataset. Set the strict pair, or HASNA_HOOKS_LOCAL=1 for the local store",
      { cause: error },
    );
  }
  throw new Error(
    `REMOTE_API_URL_INVALID: ${message} resolving the declared authority failed — refusing to fall through to a different dataset`,
    { cause: error },
  );
}

/** Tier-1 credential inputs and Keychain-tier controls, forwarded verbatim. */
export type { HooksCredentialOptions } from "./resolver-types.js";

export interface HooksTransportOptions {
  /** Tier-1 credential inputs (`--api-key` / `--profile`) and the injectable `security` runner tests use. */
  credentials?: HooksCredentialOptions;
  /** Where the one-line local-store notice goes. Defaults to `process.stderr`. */
  notice?: HooksTransportNotice;
}

/**
 * Resolve the hooks transport. Selection order:
 *
 *  1. `HASNA_HOOKS_LOCAL`/`HOOKS_LOCAL` with nothing else configured in the
 *     env — the explicit local selection. The chain is never consulted, so
 *     no Keychain item and no credential file is read (hermetic promise).
 *  2. Otherwise `@hasna/contracts` resolves the credential AND the authority
 *     together as one strict pair. Success is remote.
 *  3. If nothing resolves AND the environment declared no authority, the
 *     local store is the baseline transport — every command works, hosted or
 *     local, and no command is gated on the transport (owner directive
 *     2026-08-15: the storage-mode axis is retired).
 *  4. If the environment DECLARED an authority (any env authority/credential
 *     name set) but the chain cannot honour it, the seam throws — a
 *     deliberate tier never falls through to a different dataset.
 */
export function resolveHooksTransport(
  env: HooksLocalOptInEnv = process.env,
  options: HooksTransportOptions = {},
): HooksTransportResolution {
  if (selectsHooksLocalStore(env)) {
    announceLocal(options.notice, "HASNA_HOOKS_LOCAL selects the local store");
    return { kind: "local", source: "local", authority: null };
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
    // Declared intent that cannot be honoured: strict-pair refusal, never a
    // silent read of a different dataset. Undeclared environments simply use
    // the local store — the baseline transport in the retired mode axis.
    if (hasHooksEnvAuthorityIntent(env)) rethrowHooksAuthorityFailure(error);
    announceLocal(options.notice, "nothing in the environment configures a registry authority");
    return { kind: "local", source: "local", authority: null };
  }
  // Nothing resolved and nothing was declared: local is the baseline, not a
  // fallback that needs permission.
  if (!credential) {
    announceLocal(options.notice, "no registry credential resolved");
    return { kind: "local", source: "local", authority: null };
  }
  return {
    kind: "remote",
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
 * The registry keys the publish surface checks. `hooks serve` never picks a
 * transport; it only needs to know whether a credential exists to honour a
 * PUT. Resolved fresh on every call, through the same chain as
 * {@link resolveHooksTransport}, so a key rotation heals a long-lived server
 * without a restart.
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