/**
 * The `./sdk` surface's adapter onto the ONE shared credential chain
 * (owner directive 2026-09-04, hasna/apps#1720).
 *
 * The generated `AttachmentsApiClient` takes an explicit `baseUrl` and
 * `apiKey` and has no environment surface of its own — which left every
 * caller writing a private copy of the chain. This module is that surface.
 *
 * AUTHORITY-PINNED CREDENTIALS (#1794). An explicit `baseUrl` with no
 * `apiKey` returns `apiKey: null` and NEVER attaches the ambient fleet key:
 * the credential is pinned to the authority it resolved with, and a client
 * built without one fails loudly in `createAttachmentsApiClient` rather than
 * silently borrowing some other authority's identity. When neither argument
 * is given, the shared chain decides both (env pair, Keychain `api-url` /
 * `api-key` items, `~/.hasna/attachments/config/credentials`, default fleet
 * gateway `https://api.hasna.com/attachments`), resolved FRESH on every call.
 */
import {
  resolveClientTransport,
  resolveCredential,
} from "@hasna/contracts/client";
import {
  stripV1,
  type AttachmentsCredentialChainOptions,
  type AttachmentsCredentialTier,
  type Env,
} from "../core/client-config";
import { AttachmentsApiClient, type AttachmentsApiClientOptions } from "./generated.js";

type FetchInput = Parameters<typeof fetch>[0];

/** The `./sdk` surface's resolution answer. Locally spelled: published types never import @hasna/contracts. */
export interface AttachmentsSdkTransport {
  /** `"http"` — the SDK is hosted-only; there is no local store to select. */
  mode: "http";
  /** Origin (plus any gateway path prefix) WITHOUT `/v1`, exactly what the generated client expects. */
  baseUrl: string;
  /** The credential, or `null` when only an explicit `baseUrl` was given. */
  apiKey: string | null;
  /** WHERE the credential came from — an env key NAME, a Keychain reference, a path. Never a value. */
  apiKeySource: string | null;
  apiKeyTier: AttachmentsCredentialTier | null;
  /** WHERE the authority came from, or `"default"` for the fleet gateway. */
  apiUrlSource: string;
}

export interface ResolveAttachmentsSdkTransportOptions {
  /** Tier 1: an explicit authority. Used verbatim, minus a trailing `/v1` or slash. */
  baseUrl?: string;
  /** Tier 1: an explicit credential. */
  apiKey?: string;
  /** Tier-1 profile selection and the injectable `security` runner tests use. */
  credentials?: AttachmentsCredentialChainOptions;
  /** Defaults to `process.env`. A caller-built env is the hermetic seam: Keychain stays off. */
  env?: Env;
}

/**
 * Resolve the SDK's authority and credential. Explicit arguments win; with
 * neither, the @hasna/contracts chain decides and throws on a half-configured
 * pair or an unresolvable credential — the hosted-only SDK has no local mode.
 */
export function resolveAttachmentsSdkTransport(
  options: ResolveAttachmentsSdkTransportOptions = {},
): AttachmentsSdkTransport {
  const env: Env = options.env ?? (typeof process !== "undefined" ? (process.env as Env) : {});
  const requestedCredentials: AttachmentsCredentialChainOptions = {
    ...options.credentials,
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
  };

  // Tier 1, and the only way to reach an arbitrary authority: an explicit
  // argument is a deliberate selection. With no apiKey the answer is
  // `apiKey: null` — the ambient fleet key is NEVER attached to an authority
  // the caller picked themselves (#1794).
  if (options.baseUrl) {
    return {
      mode: "http",
      baseUrl: stripV1(options.baseUrl),
      apiKey: options.apiKey ?? null,
      apiKeySource: options.apiKey ? "explicit apiKey argument" : null,
      apiKeyTier: options.apiKey ? "argument" : null,
      apiUrlSource: "explicit baseUrl argument",
    };
  }

  // ONE pass down the credential chain, handed to the transport as tier 1 so
  // the authority pass does not re-read the Keychain for the credential item.
  const credential = resolveCredential("attachments", env, requestedCredentials);
  const chainOptions = credential
    ? { credentials: { ...requestedCredentials, apiKey: credential.apiKey } }
    : { credentials: requestedCredentials };
  const resolution = resolveClientTransport("attachments", env, chainOptions);
  if (!credential) {
    throw new Error(
      "ATTACHMENTS_CREDENTIAL_MISSING: no Hasna Attachments credential resolved. " +
        "Looked at HASNA_ATTACHMENTS_API_KEY_OVERRIDE / HASNA_PROFILE / HASNA_ATTACHMENTS_API_KEY_REF, " +
        "the Keychain item hasna.credentials.attachments.api-key, ~/.hasna/attachments/config/credentials, " +
        "then HASNA_ATTACHMENTS_API_KEY.",
    );
  }
  return {
    mode: "http",
    baseUrl: stripV1(resolution.baseUrl),
    apiKey: credential.apiKey,
    // The TRUE tier and source, not the tier-1 spelling the transport was
    // handed, so a diagnostic names the Keychain/disk/env origin.
    apiKeySource: credential.source,
    apiKeyTier: credential.tier,
    apiUrlSource: resolution.apiUrlSource ?? "default",
  };
}

/**
 * Build the hosted `/v1` client with the shared resolver behind it. The
 * generated client stores whatever `apiKey` it is handed for its lifetime, so
 * the credential is refreshed inside a `fetch` wrapper on EVERY request — a
 * key rotation heals a long-lived SDK client without rebuilding it.
 *
 * Throws when no credential resolves: this client speaks only to the hosted
 * authority.
 */
export function createAttachmentsApiClient(
  options: ResolveAttachmentsSdkTransportOptions & Pick<AttachmentsApiClientOptions, "fetch" | "headers"> = {},
): AttachmentsApiClient {
  const resolved = resolveAttachmentsSdkTransport(options);
  if (!resolved.apiKey) {
    throw new Error(
      "ATTACHMENTS_CREDENTIAL_MISSING: the /v1 client is hosted-only and no Hasna Attachments credential " +
        "resolved. An explicit baseUrl never borrows the ambient fleet key — pass apiKey, or let the shared " +
        "chain resolve both.",
    );
  }
  const baseFetch =
    options.fetch ?? ((input: FetchInput, init?: RequestInit) => fetch(input, init));
  // The per-request re-resolution must not TALK: it re-runs the resolution
  // that already succeeded above against the same inputs.
  const refreshOptions: ResolveAttachmentsSdkTransportOptions = { ...options };
  const fetchWithFreshCredential = ((input: FetchInput, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    try {
      const fresh = resolveAttachmentsSdkTransport(refreshOptions).apiKey;
      if (fresh) headers["x-api-key"] = fresh;
    } catch {
      // keep the credential the client was constructed with
    }
    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;
  return new AttachmentsApiClient({
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    fetch: fetchWithFreshCredential,
    ...(options.headers ? { headers: options.headers } : {}),
  });
}