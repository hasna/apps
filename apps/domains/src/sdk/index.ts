// Typed SDK for @hasna/domains — the hosted HTTP client surface.
//
// The client is GENERATED from the domains-serve OpenAPI document
// (src/sdk/client.ts, regenerate with `bun run sdk:gen`). This module wires
// it to the ONE credential/authority resolver in the fleet — the
// @hasna/contracts client seam (`../lib/domains-resolver.ts`) — so the SDK,
// the CLI and the MCP server all answer "which key, from where, against which
// service" identically.
//
// PRECEDENCE (resolved fresh on every call, five tiers, see
// @hasna/contracts/client):
//   1. an explicit argument           — `overrides.apiKey` / `overrides.profile`
//   2. a deliberate env pointer       — HASNA_DOMAINS_API_KEY_OVERRIDE,
//                                       HASNA_PROFILE, HASNA_DOMAINS_API_KEY_REF
//   3. the macOS Keychain             — hasna.credentials.domains.api-key,
//                                       account HASNA_STATION -> hostname -s -> USER
//   4. disk, read at call time        — ~/.hasna/domains/config/credentials
//                                       (0400/0600; HASNA_HOME / HASNA_CONFIG_HOME override)
//   5. HASNA_DOMAINS_API_KEY in the process env — a legitimate tier, no notice
//
// The service URL follows the same ladder (HASNA_DOMAINS_API_URL, the Keychain
// `api-url` item, the credentials file) and defaults to the fleet gateway
// `https://api.hasna.com/domains` once a credential resolves. The unprefixed
// DOMAINS_API_URL / DOMAINS_API_KEY names are NOT read by this module at all:
// the shared resolver's silent-alias fallback is the only place they are ever
// accepted (one release), and the canonical HASNA_DOMAINS_* names always win.
// No DSN is ever carried, and no key value is logged.
//
// THE AUTHORITY PIN (#1794). An EXPLICIT `baseUrl` argument is a deliberate
// authority selection: the client is built to talk to exactly that origin, and
// it NEVER picks up an ambient fleet key — from the Keychain, the disk, or
// `HASNA_DOMAINS_API_KEY` — unless the caller also pinned one with an explicit
// `apiKey` argument. A key that resolved against another authority must not
// silently authenticate against the one the caller named.
//
// PER-REQUEST, NOT PER-CLIENT. `DomainsClient` is generated and stores
// whatever `apiKey` it is handed, so a client built once and held for hours
// would keep sending the key that happened to resolve at startup — the
// staleness the fresh-per-call ruling exists to remove. Rather than fork the
// generated file, the credential is refreshed in a `fetch` wrapper: the
// generated request has already set `x-api-key` from its stored value by the
// time we see it, and we overwrite that header with the key the chain resolves
// NOW (completing a secrets-vault pointer at the same boundary). A
// re-resolution that throws leaves the generated header in place, so a
// transient unreadable Keychain cannot turn a working client into a failing
// one mid-flight.
//
// There is no local fallback here: an SDK client with no resolvable credential
// THROWS, so a caller cannot read a local dataset while believing it is talking
// to the fleet. Local mode is the CLI/store opt-in (`domains.db`), not an SDK
// surface.

export * from "./client.js";
import {
  completePointerCredential,
  resolveClientTransport,
  resolveCredential,
} from "@hasna/contracts/client";
import type {
  CredentialChainOptions,
  KeychainTierOptions,
} from "../lib/client-types.js";
import { DOMAINS_APP_NAME, domainsResolverInputs } from "../lib/domains-resolver.js";
import { DomainsClient, type DomainsClientOptions } from "./client.js";

type ClientEnv = Record<string, string | undefined>;

/** Options accepted on top of the generated client options. */
export interface CreateDomainsClientOptions extends Partial<DomainsClientOptions> {
  /** Tier-1 identity selection (`--profile`), passed through to the seam. */
  profile?: string;
  /**
   * Tier-3 controls: a `security` runner for tests, or an opt-out on a CI Mac.
   * Production callers pass nothing — the tier is ambient for `process.env`
   * and off for a caller-built env.
   */
  keychain?: KeychainTierOptions;
}

/**
 * Build a `DomainsClient` whose credential and base URL come from the shared
 * @hasna/contracts resolver.
 *
 * Throws when no credential resolves from any tier — the SDK never falls back
 * to an unauthenticated client or to local data. An EXPLICIT `baseUrl`
 * argument with no explicit `apiKey` builds an unauthenticated client pinned
 * to that authority: the ambient fleet key is never attached (#1794).
 */
export function createDomainsClientFromEnv(
  env: ClientEnv = process.env,
  overrides: CreateDomainsClientOptions = {},
): DomainsClient {
  const { baseUrl: baseUrlOverride, apiKey: apiKeyOverride, profile, keychain, ...rest } = overrides;

  // Tier 1: an explicit authority is a deliberate selection, so it is never
  // resolved around — and it never gains a key the caller did not pin.
  if (baseUrlOverride !== undefined) {
    return new DomainsClient({
      baseUrl: baseUrlOverride,
      ...(apiKeyOverride !== undefined ? { apiKey: apiKeyOverride } : {}),
      ...rest,
    });
  }

  const credentials: CredentialChainOptions = {
    ...(apiKeyOverride !== undefined ? { apiKey: apiKeyOverride } : {}),
    ...(profile ? { profile } : {}),
    ...(keychain ? { keychain } : {}),
  };
  // The credential options the chain will see, assembled BEFORE the env is
  // normalised: dropping a declared-but-blank variable hands the resolver a
  // copy, and a copy is not the ambient environment its Keychain tier gates
  // on, so the gate has to travel with it (see `domainsResolverInputs`).
  const { env: resolverEnv, credentials: resolverCredentials } = domainsResolverInputs(env, credentials);

  const resolution = resolveClientTransport(DOMAINS_APP_NAME, resolverEnv, {
    credentials: resolverCredentials,
  });
  const credential = resolveCredential(DOMAINS_APP_NAME, resolverEnv, resolverCredentials);
  if (!credential) {
    // Unreachable: resolveClientTransport throws first. Kept so a future
    // resolver change cannot turn a missing credential into an anonymous client.
    throw new Error(
      "domains SDK: no API key resolved from any credential tier; refusing to build an unauthenticated client. " +
        "Looked at HASNA_DOMAINS_API_KEY_OVERRIDE / HASNA_PROFILE / HASNA_DOMAINS_API_KEY_REF, the Keychain item " +
        "hasna.credentials.domains.api-key, ~/.hasna/domains/config/credentials, then HASNA_DOMAINS_API_KEY.",
    );
  }

  // The seam hands back `<origin>/v1`; the generated client already carries the
  // `/v1` prefix on its data routes and needs the origin-and-path root (the
  // `/health` and `/ready` probes live above `/v1`).
  const baseUrl = resolution.baseUrl.replace(/\/v1$/, "");

  // A vault pointer carries no value at construction time — it is completed
  // through the secrets SDK on each request, exactly as the shared transport
  // does it, so a rotated vault item is picked up without a restart. All other
  // tiers are re-resolved per request for the same reason: a rotation heals a
  // long-lived client without a rebuild.
  const baseFetch = rest.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const fetchWithFreshCredential = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Normalise whatever shape the init carries. `Headers` handles a plain
    // record, a `Headers` instance, and a tuple array alike.
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    try {
      const fresh = resolveCredential(DOMAINS_APP_NAME, resolverEnv, resolverCredentials);
      if (fresh) {
        const key = fresh.tier === "pointer"
          ? (await completePointerCredential(DOMAINS_APP_NAME, fresh, resolverEnv)).apiKey
          : fresh.apiKey;
        headers["x-api-key"] = key;
      }
    } catch {
      // keep the credential the client was constructed with
    }
    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;

  return new DomainsClient({
    baseUrl,
    apiKey: credential.apiKey,
    ...rest,
    fetch: fetchWithFreshCredential,
  });
}