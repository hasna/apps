/**
 * Credential and authority resolution for the `@hasna/shortlinks/sdk` surface.
 *
 * There is exactly ONE resolver on the fleet — the client chain in
 * `@hasna/contracts/client` — and this module is the SDK's adapter onto it
 * (2026-09-04 adoption ruling, hasna/apps#1720). The SDK used to be a pure
 * generated client: its caller had to build the authority and credential
 * themselves, which produced a private copy of the chain per consumer. Now the
 * SDK resolves through the contracts chain per request, fresh:
 *
 *   1. an explicit argument     — `options.apiKey` / `options.baseUrl`
 *   2. a deliberate env pointer — `HASNA_SHORTLINKS_API_KEY_OVERRIDE`,
 *                                 `HASNA_PROFILE`, `HASNA_SHORTLINKS_API_KEY_REF`
 *   3. the macOS Keychain       — `hasna.credentials.shortlinks.api-key`
 *   4. disk                     — `~/.hasna/shortlinks/config/credentials` (0400/0600)
 *   5. `HASNA_SHORTLINKS_API_KEY` (alias `SHORTLINKS_API_KEY`)
 *
 * with the authority following `HASNA_SHORTLINKS_API_URL`, the Keychain
 * `api-url` item, the credentials file, and finally the fleet gateway
 * `https://api.hasna.com/shortlinks` — URLs never need configuring. A
 * credential that cannot be used, a declared-but-blank variable, an unreadable
 * credential file, an authority that is set but malformed — every one of those
 * THROWS. The SDK is hosted-only (the generated `/v1` client has no local
 * store), so a missing credential is a hard error, never a fallback.
 *
 * THE AUTHORITY PIN (#1794). An explicit `baseUrl` with no `apiKey` is a
 * caller pointing the client at an authority of their choosing — a local
 * serve, a staging box, a test double, any URL at all. The ambient chain holds
 * the credential written for the FLEET, and consulting it here would attach
 * the station's hosted key as `x-api-key` on every request to that other
 * authority. So an explicit `baseUrl` pins the credential with it: the SDK
 * returns `options.apiKey`, or nothing, and never asks the chain.
 */
import { resolveClientTransport, resolveCredential } from "@hasna/contracts/client";
import { shortlinksResolverInputs } from "../client-resolver-inputs.js";
import type {
  ShortlinksClientTransportResolution,
  ShortlinksCredentialChainOptions,
  ShortlinksResolvedCredential,
} from "../client-types.js";
import { ShortlinksApiClient } from "./generated.js";

type SdkEnv = Record<string, string | undefined>;

/** The resolved SDK transport: authority, credential, and WHERE each came from. */
export interface ShortlinksSdkTransport {
  /** The SDK is hosted-only: every resolved transport talks HTTP to the `/v1` API. */
  mode: "http";
  /**
   * Origin WITHOUT the `/v1` suffix, so a caller that composes `/v1/...` gets
   * exactly one version segment.
   */
  baseUrl: string;
  /** The credential the transport will send, or null when the caller pinned an authority without one. */
  apiKey: string | null;
  /** WHERE the credential came from — an env key NAME, a Keychain reference, a path. Never a value. */
  apiKeySource: string | null;
  /** WHERE the authority came from, or `"default"` for the fleet gateway. */
  apiUrlSource: string | null;
}

export interface ResolveShortlinksSdkTransportOptions {
  /** Tier 1: an explicit authority. Used verbatim, minus a trailing slash. Pins the credential (never the ambient key). */
  baseUrl?: string | undefined;
  /** Tier 1: an explicit credential. */
  apiKey?: string | undefined;
  /** Tier-1 profile selection and the injectable `security` runner tests use. */
  credentials?: ShortlinksCredentialChainOptions;
  /** Defaults to `process.env`. */
  env?: SdkEnv;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

function stripV1(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/**
 * Resolve the SDK's authority and credential, fresh, through the one
 * @hasna/contracts client chain. An explicit `baseUrl` pins the credential
 * (tier 1 only — the ambient fleet key is never attached to a caller-chosen
 * authority, #1794); otherwise the chain decides, and a missing credential
 * throws — the SDK is hosted-only and never degrades.
 */
export function resolveShortlinksSdkTransport(
  options: ResolveShortlinksSdkTransportOptions = {},
): ShortlinksSdkTransport {
  const rawEnv = options.env ?? (typeof process !== "undefined" ? (process.env as SdkEnv) : {});
  // The credential options the chain will see, assembled BEFORE the env is
  // normalised: dropping an explicit apiKey into the chain inputs is tier 1,
  // and folding it in before the inputs helper keeps one spelling of the gate.
  const requestedCredentials: ShortlinksCredentialChainOptions = {
    ...options.credentials,
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
  };
  // Normalise declared-but-blank authority variables WITHOUT handing the
  // resolver a silent copy: the Keychain tier's ambient gate travels with the
  // copy when one is forced (hasna/apps#1788). See ./client-resolver-inputs.ts.
  const { env, credentials } = shortlinksResolverInputs(rawEnv, requestedCredentials);

  // Tier 1, and the only way to reach an arbitrary authority: an explicit
  // argument is a deliberate selection, so it is never resolved around and the
  // ambient chain is never consulted for it (#1794).
  if (options.baseUrl) {
    return {
      mode: "http",
      baseUrl: stripV1(options.baseUrl),
      apiKey: options.apiKey ?? null,
      apiKeySource: options.apiKey ? "explicit apiKey argument" : null,
      apiUrlSource: "explicit baseUrl argument",
    };
  }

  // ONE pass down the chain, not two. `resolveClientTransport` resolves the
  // credential internally but deliberately returns only its SOURCE, while the
  // generated client needs the credential VALUE. Resolving here and handing
  // the value down as the chain's tier-1 argument makes the transport's
  // second pass a no-op (tier 1 returns immediately): the chain consults the
  // Keychain once and the transport decides the authority exactly as before.
  const credential: ShortlinksResolvedCredential | null = resolveCredential("shortlinks", env, credentials);
  if (!credential) {
    throw new Error(
      "SHORTLINKS_CREDENTIAL_MISSING: the /v1 SDK client is hosted-only and no Hasna Shortlinks " +
        "credential resolved. Looked at HASNA_SHORTLINKS_API_KEY_OVERRIDE / HASNA_PROFILE / " +
        "HASNA_SHORTLINKS_API_KEY_REF, the Keychain item hasna.credentials.shortlinks.api-key, " +
        "~/.hasna/shortlinks/config/credentials, then HASNA_SHORTLINKS_API_KEY.",
    );
  }
  const resolution: ShortlinksClientTransportResolution = resolveClientTransport("shortlinks", env, {
    credentials: { ...credentials, apiKey: credential.apiKey },
  });
  return {
    mode: "http",
    baseUrl: stripV1(resolution.baseUrl),
    apiKey: credential.apiKey,
    // The TRUE tier, not the tier-1 spelling the transport was handed: passing
    // the value down as an argument makes the transport report "explicit apiKey
    // argument", which would erase the Keychain/disk/env origin an operator
    // needs in a diagnostic. `credential.source` is that origin, never a value.
    apiKeySource: credential.source,
    apiUrlSource: resolution.apiUrlSource ?? "default",
  };
}

/**
 * Build the hosted `/v1` client with the fleet resolver behind it — the
 * generated {@link ShortlinksApiClient} takes an explicit `baseUrl` and has no
 * environment surface of its own, which left every caller writing a private
 * copy of the chain.
 *
 * The credential is refreshed PER REQUEST, not per client: the generated
 * client stores whatever key it is handed, so a client built once and held for
 * hours would keep sending the key that happened to resolve at startup — the
 * staleness the fresh-per-call chain exists to remove. A re-resolution that
 * throws or comes back empty leaves the constructed key in place, so a
 * transient unreadable Keychain cannot turn a working client into a failing
 * one mid-flight.
 *
 * Throws when no credential resolves: this client speaks only to the hosted
 * authority, so there is no local mode to degrade to.
 */
export function createShortlinksApiClient(
  options: ResolveShortlinksSdkTransportOptions = {},
): ShortlinksApiClient {
  const resolved = resolveShortlinksSdkTransport(options);
  if (resolved.mode !== "http" || !resolved.apiKey) {
    throw new Error(
      "SHORTLINKS_CREDENTIAL_MISSING: the /v1 client is hosted-only and no Hasna Shortlinks " +
        "credential resolved. Set HASNA_SHORTLINKS_API_KEY, add the Keychain item " +
        "hasna.credentials.shortlinks.api-key, or write ~/.hasna/shortlinks/config/credentials. " +
        "An explicit baseUrl pins an explicit apiKey — the ambient fleet key is never attached to " +
        "a caller-chosen authority.",
    );
  }
  const baseFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  // The per-request re-resolution must not TALK: it re-runs the same resolution
  // that already succeeded above against the same environment. The refreshed
  // credential is used; nothing else about the result matters.
  const refreshOptions: ResolveShortlinksSdkTransportOptions = options;
  const fetchWithFreshCredential = ((input: RequestInfo | URL, init?: RequestInit) => {
    // Normalise whatever shape the init carries. The generated client hands us
    // a plain record today, but that was asserted only in a comment: an object
    // spread over a `Headers` instance or a tuple array yields `{}` and would
    // silently drop EVERY header, Content-Type included, the moment the client
    // is regenerated. `Headers` normalises all three shapes for us.
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    try {
      const fresh = resolveShortlinksSdkTransport(refreshOptions).apiKey;
      if (fresh) headers["x-api-key"] = fresh;
    } catch {
      // keep the credential the client was constructed with
    }
    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;
  return new ShortlinksApiClient({
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    fetch: fetchWithFreshCredential,
    ...(options.headers ? { headers: options.headers } : {}),
  });
}