/**
 * Credential and authority resolution for the `@hasna/conversations/sdk` surface.
 *
 * There is exactly ONE resolver on the fleet — the client chain in
 * `@hasna/contracts/client` — and this module is the SDK's adapter onto it
 * (2026-09-04 adoption ruling, hasna/apps#1720). The generated
 * `ConversationsClient` takes an explicit `baseUrl` and an optional `apiKey`
 * and has no environment surface of its own, which left every SDK consumer
 * writing a private copy of the chain while the CLI, the MCP server and the
 * library `getStore()` resolved through the shared seam. Now the SDK resolves
 * through the same chain, fresh on every call:
 *
 *   1. an explicit argument     — `options.apiKey` / `options.baseUrl`
 *   2. a deliberate env pointer — `HASNA_CONVERSATIONS_API_KEY_OVERRIDE`,
 *                                 `HASNA_PROFILE`, `HASNA_CONVERSATIONS_API_KEY_REF`
 *   3. the macOS Keychain       — `hasna.credentials.conversations.api-key`
 *                                 (account HASNA_STATION, else `hostname -s`, else USER)
 *   4. disk                     — `~/.hasna/conversations/config/credentials` (0400/0600)
 *   5. `HASNA_CONVERSATIONS_API_KEY` (alias `CONVERSATIONS_API_KEY`)
 *
 * with the authority following `HASNA_CONVERSATIONS_API_URL`, the Keychain
 * `api-url` item, the credentials file, and finally the fleet gateway
 * `https://api.hasna.com/conversations` — URLs never need configuring. A
 * credential that cannot be used, a declared-but-blank variable, an unreadable
 * credential file, an authority that is set but malformed — every one of those
 * THROWS. The SDK is hosted-only (the generated `/v1` client has no local
 * store), so a missing credential is a hard error, never a fallback.
 *
 * THE LOCAL OPT-IN IS NOT THIS CLIENT'S TO SERVE. `HASNA_CONVERSATIONS_DB_PATH`
 * selects the on-box SQLite store for the CLI, the MCP server and `getStore()`.
 * An HTTP client cannot talk to it, and quietly resolving a hosted credential
 * beside it would put the SDK on the fleet while every other surface in the
 * same shell is local — the split-brain this package exists to prevent. So the
 * opt-in is a refusal here, naming `getStore()` as the local route.
 *
 * THE AUTHORITY PIN (#1794). An explicit `baseUrl` with no `apiKey` is a caller
 * pointing the client at an authority of their choosing — a local serve, a
 * staging box, a test double, any URL at all. The ambient chain holds the
 * credential written for the FLEET, and consulting it here would attach the
 * station's hosted key as `x-api-key` on every request to that other
 * authority. So an explicit `baseUrl` pins the credential with it: the SDK
 * returns `options.apiKey`, or nothing, and never asks the chain.
 *
 * THE AMBIENT GATE (#1788). The chain's Keychain tier runs only for the live
 * `process.env` object (or a copy that carries its `keychain.enabled` control).
 * The inputs helper preserves identity when there is nothing to normalise and
 * carries the gate across when a declared-but-blank alias forces a copy, so a
 * blank `CONVERSATIONS_API_URL=` in the shell never silently turns the
 * Keychain off.
 */
import { resolveClientTransport, resolveCredential } from "@hasna/contracts/client";
import type {
  ClientTransportResolution,
  CredentialChainOptions,
  ResolvedCredential,
} from "@hasna/contracts/client";
import {
  APP,
  DB_PATH_KEYS,
  conversationsResolverInputs,
  isConversationsLocalOptIn,
} from "../lib/contracts-env.js";
import { ConversationsClient } from "./index.js";

type SdkEnv = Record<string, string | undefined>;

/** The resolved SDK transport: authority, credential, and WHERE each came from. */
export interface ConversationsSdkTransport {
  /** The SDK is hosted-only: every resolved transport talks HTTP to the `/v1` API. */
  mode: "http";
  /**
   * Origin (plus any gateway path prefix) WITHOUT the `/v1` suffix, so the
   * generated client — which composes `/v1/...` itself — gets exactly one
   * version segment.
   */
  baseUrl: string;
  /** The credential the transport will send, or null when the caller pinned an authority without one. */
  apiKey: string | null;
  /** WHERE the credential came from — an env key NAME, a Keychain reference, a path. Never a value. */
  apiKeySource: string | null;
  /** WHERE the authority came from, or `"default"` for the fleet gateway. */
  apiUrlSource: string | null;
}

export interface ResolveConversationsSdkTransportOptions {
  /** Tier 1: an explicit authority. Used verbatim, minus a trailing slash. Pins the credential (never the ambient key). */
  baseUrl?: string | undefined;
  /** Tier 1: an explicit credential. */
  apiKey?: string | undefined;
  /** Tier-1 profile selection and the injectable `security` runner tests use. */
  credentials?: CredentialChainOptions;
  /** Defaults to `process.env` (by identity, so the Keychain tier stays live). */
  env?: SdkEnv;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

/** A resolution the hosted-only SDK cannot honour. The code names which rule refused. */
export class ConversationsSdkResolutionError extends Error {
  readonly code: "CONVERSATIONS_CREDENTIAL_MISSING" | "CONVERSATIONS_LOCAL_STORE_SELECTED";
  constructor(code: ConversationsSdkResolutionError["code"], message: string) {
    super(`${code}: ${message}`);
    this.name = "ConversationsSdkResolutionError";
    this.code = code;
  }
}

function stripV1(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

const TIERS_CONSULTED =
  "Looked at HASNA_CONVERSATIONS_API_KEY_OVERRIDE / HASNA_PROFILE / HASNA_CONVERSATIONS_API_KEY_REF, " +
  "the Keychain item hasna.credentials.conversations.api-key, ~/.hasna/conversations/config/credentials, " +
  "then HASNA_CONVERSATIONS_API_KEY.";

/**
 * Resolve the SDK's authority and credential, fresh, through the one
 * @hasna/contracts client chain. An explicit `baseUrl` pins the credential
 * (tier 1 only — the ambient fleet key is never attached to a caller-chosen
 * authority, #1794); otherwise the chain decides, and a missing credential
 * throws — the SDK is hosted-only and never degrades.
 */
export function resolveConversationsSdkTransport(
  options: ResolveConversationsSdkTransportOptions = {},
): ConversationsSdkTransport {
  const rawEnv: SdkEnv = options.env ?? (typeof process !== "undefined" ? (process.env as SdkEnv) : {});

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

  // The on-box store was asked for by name. This client cannot serve it, and
  // going hosted beside it would split the shell across two datasets.
  if (isConversationsLocalOptIn(rawEnv)) {
    throw new ConversationsSdkResolutionError(
      "CONVERSATIONS_LOCAL_STORE_SELECTED",
      `${DB_PATH_KEYS[0]} / ${DB_PATH_KEYS[1]} selects the on-box SQLite store, which the hosted-only ` +
        "./sdk client cannot talk to. Use getStore() from @hasna/conversations for the local store, or " +
        "unset the store path and provide a hosted credential. " + TIERS_CONSULTED,
    );
  }

  // The credential options the chain will see, assembled BEFORE the env is
  // normalised: an explicit apiKey is tier 1, and folding it in before the
  // inputs helper keeps one spelling of the gate. The helper removes
  // declared-but-blank authority variables WITHOUT handing the resolver a
  // silent copy — the Keychain tier's ambient gate travels with the copy when
  // one is forced (#1788).
  const requestedCredentials: CredentialChainOptions = {
    ...options.credentials,
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
  };
  const { env, credentials } = conversationsResolverInputs(rawEnv, requestedCredentials);

  // ONE pass down the chain, not two. `resolveClientTransport` resolves the
  // credential internally but deliberately returns only its SOURCE, while the
  // generated client needs the credential VALUE. Resolving here and handing
  // the value down as the chain's tier-1 argument makes the transport's second
  // pass a no-op (tier 1 returns immediately): the chain consults the Keychain
  // once and the transport decides the authority exactly as before.
  const credential: ResolvedCredential | null = resolveCredential(APP, env, credentials);
  if (!credential) {
    throw new ConversationsSdkResolutionError(
      "CONVERSATIONS_CREDENTIAL_MISSING",
      "the /v1 SDK client is hosted-only and no Hasna Conversations credential resolved. " + TIERS_CONSULTED +
        ` (The on-box store is reachable only through getStore() with ${DB_PATH_KEYS[0]} set — local mode is opt-in, never a fallback.)`,
    );
  }
  const resolution: ClientTransportResolution = resolveClientTransport(APP, env, {
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
 * Build the hosted `/v1` client with the fleet resolver behind it.
 *
 * The credential is refreshed PER REQUEST, not per client: the generated
 * client stores whatever key it is handed, so a client built once and held
 * for hours would keep sending the key that happened to resolve at startup —
 * the staleness the fresh-per-call chain exists to remove. A re-resolution
 * that throws or comes back empty leaves the constructed key in place, so a
 * transient unreadable Keychain cannot turn a working client into a failing
 * one mid-flight.
 *
 * Throws when no credential resolves: this client speaks only to the hosted
 * authority, so there is no local mode to degrade to. An explicit `baseUrl`
 * without an `apiKey` builds an UNAUTHENTICATED client on purpose (#1794).
 */
export function createConversationsClient(
  options: ResolveConversationsSdkTransportOptions = {},
): ConversationsClient {
  const resolved = resolveConversationsSdkTransport(options);
  const baseFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  // The per-request re-resolution re-runs the same resolution that already
  // succeeded above against the same options. The refreshed credential is
  // used; nothing else about the result matters.
  const fetchWithFreshCredential = ((input: RequestInfo | URL, init?: RequestInit) => {
    // Normalise whatever shape the init carries. The generated client hands us
    // a plain record today, but an object spread over a `Headers` instance or
    // a tuple array yields `{}` and would silently drop EVERY header,
    // Content-Type included, the moment the client is regenerated. `Headers`
    // normalises all three shapes for us.
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    try {
      const fresh = resolveConversationsSdkTransport(options).apiKey;
      if (fresh) headers["x-api-key"] = fresh;
    } catch {
      // keep the credential the client was constructed with
    }
    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;
  return new ConversationsClient({
    baseUrl: resolved.baseUrl,
    ...(resolved.apiKey ? { apiKey: resolved.apiKey } : {}),
    fetch: fetchWithFreshCredential,
    ...(options.headers ? { headers: options.headers } : {}),
  });
}
