/**
 * Typed open-files SDK — generated from the serve OpenAPI (`src/server/openapi.ts`)
 * via @hasna/contracts. Import from "@hasna/files/sdk".
 *
 * Credentials and authority come from the ONE @hasna/contracts client resolver —
 * the same chain the CLI and the MCP server use, resolved fresh per request
 * (hasna/apps#1720). The SDK has no env reading of its own any more; in
 * particular the old `FILES_API_URL` / `FILES_API_KEY` reads that SHADOWED the
 * canonical `HASNA_FILES_*` names are gone. Those two names survive only as a
 * silent alias inside the shared resolver, for one release.
 *
 * Plain construction still works for a deliberate self-hosted pin:
 *   const files = new FilesClient({ baseUrl: "https://files.example.test", apiKey: "k" });
 * The resolver-backed factory is {@link createFilesClientFromEnv}.
 */
export * from "./client.js";
export { openApiDocument, OPENAPI_VERSION } from "../server/openapi.js";
import { resolveClientTransport, resolveCredential, completePointerCredential, toV1BaseUrl } from "@hasna/contracts/client";
import type { CredentialChainOptions } from "@hasna/contracts/client";
import { FilesClient, type FilesClientOptions } from "./client.js";
import type { FilesCredentialChainOptions, FilesCredentialTier, ClientEnv } from "../store/client-types.js";

/** The app slug the shared client seam resolves credentials and authority for. */
export const FILES_APP_NAME = "files" as const;

/** Options accepted on top of the generated client surface. */
export interface CreateFilesClientOptions extends Partial<FilesClientOptions> {
  /**
   * Tier-1 credential inputs (`apiKey` / `profile`) and Keychain-tier controls
   * (an injected `security` runner for tests), forwarded to the shared
   * resolver. Spelled locally so the published `.d.ts` stays dependency-free.
   */
  credentials?: FilesCredentialChainOptions;
}

/**
 * Build a {@link FilesClient} whose credential and base URL come from the
 * shared @hasna/contracts resolver — FRESH ON EVERY REQUEST, so a long-lived
 * agent loop picks up a key rotation without being rebuilt. The client never
 * carries a process-snapshot of the credential.
 *
 * Throws when no credential resolves — the SDK never falls back to an
 * unauthenticated client or to local data.
 *
 * AUTHORITY PINNING (#1794). An explicit `baseUrl` pins the authority the
 * caller named. With an explicit `apiKey` the pair is a deliberate
 * caller-owned pin and the ambient chain (Keychain, credentials file,
 * `HASNA_FILES_API_KEY`) is never consulted. With a `baseUrl` and NO `apiKey`,
 * the client is built WITHOUT any credential — the ambient fleet key is never
 * attached to an authority it was not resolved for.
 */
export function createFilesClientFromEnv(
  env: ClientEnv = process.env,
  overrides: CreateFilesClientOptions = {},
): FilesClient {
  const { credentials: chainOptions, ...clientOverrides } = overrides;
  const explicitBaseUrl = clientOverrides.baseUrl ?? undefined;
  const explicitApiKey = overrides.apiKey ?? undefined;

  // A caller-pinned authority never receives the ambient credential chain. The
  // authority is normalised to the fleet's `<origin>/v1` spelling either way,
  // because the generated client's data paths carry no `/v1` prefix of their own.
  if (explicitBaseUrl !== undefined) {
    const options: FilesClientOptions = { ...clientOverrides, baseUrl: toV1BaseUrl(explicitBaseUrl) } as FilesClientOptions;
    if (explicitApiKey !== undefined) options.apiKey = explicitApiKey;
    return new FilesClient(options);
  }
  if (explicitApiKey !== undefined) {
    return new FilesClient({ ...clientOverrides, apiKey: explicitApiKey } as FilesClientOptions);
  }

  const chain: CredentialChainOptions = (chainOptions ?? {}) as CredentialChainOptions;
  const clientEnv = env as Record<string, string | undefined>;
  // The transport resolution validates the authority AND proves a credential
  // exists (it throws otherwise) before any client is handed back.
  const resolution = resolveClientTransport(FILES_APP_NAME, clientEnv, { credentials: chain });
  // `resolution.baseUrl` is the `<origin>/v1` request root; the OpenAPI paths
  // this client sends carry no `/v1` prefix of their own, so the root is passed
  // through as-is (toV1BaseUrl is idempotent for a resolved `<origin>/v1`).
  const baseUrl = toV1BaseUrl(resolution.baseUrl);
  const callerFetch = clientOverrides.fetch ?? globalThis.fetch;

  const authenticatedFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // THE chain, per request: an MCP server or agent loop holds this client for
    // hours, and a rotation must heal the NEXT request, not the next restart.
    // The authority was pinned by THIS resolution, so the credential is the one
    // this authority resolved with — always.
    const credential = resolveCredential(FILES_APP_NAME, clientEnv, chain);
    if (!credential) {
      throw new Error(
        "createFilesClientFromEnv: no files API key resolved at request time; refusing an unauthenticated request",
      );
    }
    const apiKey = credential.tier === "pointer"
      ? (await completePointerCredential(FILES_APP_NAME, credential, clientEnv)).apiKey
      : credential.apiKey;
    const headers = new Headers(init?.headers);
    headers.set("x-api-key", apiKey);
    return callerFetch(String(input), { ...init, headers });
  }) as typeof fetch;

  return new FilesClient({ ...clientOverrides, baseUrl, fetch: authenticatedFetch } as FilesClientOptions);
}

/**
 * The resolver's transport report for the environment — which tier supplied
 * the credential and which source the authority came from, never a value.
 * Exported so a caller can see (and tests can pin) what a run will do.
 */
export interface FilesSdkTransportReport {
  /** `<origin>/v1` base the client would target. */
  baseUrl: string;
  /** An env key NAME, a file PATH, a Keychain reference, or "default". */
  apiUrlSource: string | null;
  /** An env key NAME, a file PATH, or a Keychain reference. Never a value. */
  apiKeySource: string | null;
  /** Which tier of the chain supplied the key: a deliberate selection or ambient. */
  apiKeyTier: FilesCredentialTier;
}

/**
 * Resolve the SDK transport report WITHOUT building a client. Same fresh chain
 * as {@link createFilesClientFromEnv}; throws when no credential resolves.
 */
export function resolveFilesSdkTransport(
  env: ClientEnv = process.env,
  credentials?: FilesCredentialChainOptions,
): FilesSdkTransportReport {
  const chain: CredentialChainOptions = (credentials ?? {}) as CredentialChainOptions;
  const resolution = resolveClientTransport(FILES_APP_NAME, env as Record<string, string | undefined>, {
    credentials: chain,
  });
  return {
    baseUrl: resolution.baseUrl,
    apiUrlSource: resolution.apiUrlSource,
    apiKeySource: resolution.apiKeySource,
    apiKeyTier: resolution.apiKeyTier,
  };
}