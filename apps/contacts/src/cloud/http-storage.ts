/**
 * Canonical contacts client transport.
 *
 * Clients have two data paths, both first-class:
 *
 *   - ApiStore  — an authenticated HTTPS `/v1` authority, resolved by
 *     `@hasna/contracts/client` — the ONE fleet resolver. The authority
 *     defaults to the fleet gateway `https://api.hasna.com/contacts` once any
 *     credential tier resolves, and `HASNA_CONTACTS_API_URL`, the Keychain
 *     `api-url` item, or the credentials file override it. API-key resolution
 *     and per-request rotation are owned by the shared resolver, so key
 *     material is never exposed by status objects or cached in this package.
 *   - LocalStore — on-box SQLite at the XDG data path (or
 *     `HASNA_CONTACTS_DB_PATH`), selected automatically when no API authority
 *     resolves. The storage-mode axis is retired: no mode switch selects a
 *     transport, and commands are never gated on one.
 *
 * `getStore()` (src/store) chooses: a resolved API authority + credential →
 * ApiStore; otherwise LocalStore.
 */
import {
  ClientTransportConfigurationError,
  createHasnaHttpTransport,
  resolveCredential,
  resolveClientTransport as resolveSharedClientTransport,
  type ClientTransportResolution as SharedClientTransportResolution,
  type CredentialChainOptions,
  type CredentialTier,
  type HasnaHttpTransport,
  type HasnaRequestOptions,
  type QueryParams,
} from "@hasna/contracts/client";
import { assertConfigurationUnchanged, clientConfigurationStamp } from "./client-config.js";
import { contactsResolverCredentials } from "./resolver-inputs.js";
import type { Env } from "./resolver-inputs.js";

export type { Env, QueryParams };

// The shared @hasna/contracts resolver serves hosted-only packages and still
// appends this sentence to its "no credential resolved" refusal. It describes
// EVERY client of that resolver; since the storage-mode axis retired, the
// @hasna/contacts client DOES use the on-box SQLite store whenever no API
// configuration resolves, so this exact sentence is false for contacts and
// must not ship on its diagnostic surfaces. Replaced verbatim in displayIssue
// (the "." closes the resolver's own lead sentence, which ended at the em
// dash), never reworded: what remains is the resolver's own value-free context.
const DISPLAY_ISSUE_STALE_SENTENCE = " — public clients never fall back to SQLite or another local store.";

/** Surface a resolver diagnostic issue for status/connection output. Strips the
 * hosted-only fallback sentence (see above) so diagnostics never contradict
 * the transport they report; all other message content is preserved as-is. */
export function displayIssue(issue: string | null): string | null {
  if (issue === null) return null;
  return issue.replaceAll(DISPLAY_ISSUE_STALE_SENTENCE, ".");
}

function assertHttpsBaseUrl(baseUrl: string): void {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") {
    throw new ContactsClientConfigurationError(
      "CONTACTS_API_HTTPS_REQUIRED",
      "HASNA_CONTACTS_API_URL must use HTTPS.",
    );
  }
}

export class ContactsClientConfigurationError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "ContactsClientConfigurationError";
  }
}

export interface ClientTransportResolution {
  transport: "https" | "unconfigured";
  baseUrl: string | null;
  apiUrlSource: string | null;
  apiKeyPresent: boolean;
  apiKeySource: string | null;
  apiKeyTier: CredentialTier | null;
  configured: boolean;
  misconfigured: boolean;
  issue: string | null;
  warning: string | null;
}

function unconfiguredResolution(
  issue: string,
  resolution: Pick<
    SharedClientTransportResolution,
    "apiUrlSource" | "apiKeyPresent" | "apiKeySource" | "apiKeyTier"
  > | null,
  warning: string | null = null,
): ClientTransportResolution {
  return {
    transport: "unconfigured",
    baseUrl: null,
    apiUrlSource: resolution?.apiUrlSource ?? null,
    apiKeyPresent: resolution?.apiKeyPresent ?? false,
    apiKeySource: resolution?.apiKeySource ?? null,
    apiKeyTier: resolution?.apiKeyTier ?? null,
    configured: false,
    misconfigured: true,
    issue,
    warning,
  };
}

/**
 * Resolve value-free connection diagnostics.
 *
 * A miss (no authority or credential) is reported here as `unconfigured`
 * (never as a usable transport); callers decide whether that means the local
 * SQLite transport or a hard API requirement. The shared resolver's own hard
 * refusals — a blank declared variable, a conflict, an unreadable credential
 * file — stay hard errors, exactly as the resolver throws them.
 */
export function resolveContactsClientTransport(
  name: string,
  env: Env = process.env,
  credentials: CredentialChainOptions = {},
): ClientTransportResolution {
  if (name !== "contacts") {
    throw new ContactsClientConfigurationError("CONTACTS_CLIENT_NAME_INVALID", "This resolver only accepts the contacts app slug.");
  }
  const stamp = clientConfigurationStamp(env);
  let resolution: SharedClientTransportResolution;
  try {
    resolution = resolveSharedClientTransport(name, env, {
      credentials: contactsResolverCredentials(env, credentials),
    });
  } catch (error) {
    assertConfigurationUnchanged(env, stamp);
    if (error instanceof ClientTransportConfigurationError) {
      return unconfiguredResolution(error.message, null);
    }
    throw error;
  }
  assertConfigurationUnchanged(env, stamp);

  try {
    assertHttpsBaseUrl(resolution.baseUrl);
  } catch (error) {
    return {
      ...unconfiguredResolution(
        error instanceof Error ? error.message : String(error),
        resolution,
      ),
      apiKeyPresent: resolution.apiKeyPresent,
    };
  }

  return {
    transport: "https",
    baseUrl: resolution.baseUrl,
    apiUrlSource: resolution.apiUrlSource,
    apiKeyPresent: resolution.apiKeyPresent,
    apiKeySource: resolution.apiKeySource,
    apiKeyTier: resolution.apiKeyTier,
    configured: true,
    misconfigured: false,
    issue: null,
    warning: resolution.warning,
  };
}

export interface StorageClient {
  readonly name: string;
  readonly baseUrl: string;
  readonly transport: HasnaHttpTransport;
  list<T = unknown>(resource: string, opts?: HasnaRequestOptions): Promise<T>;
  get<T = unknown>(resource: string, id: string, opts?: HasnaRequestOptions): Promise<T | null>;
  create<T = unknown>(resource: string, body: unknown, opts?: HasnaRequestOptions): Promise<T>;
  update<T = unknown>(resource: string, id: string, patch: unknown, opts?: HasnaRequestOptions & { method?: "PATCH" | "PUT" }): Promise<T>;
  delete<T = unknown>(resource: string, id: string, opts?: HasnaRequestOptions): Promise<T | undefined>;
}

function resourcePath(resource: string): string {
  const trimmed = resource.replace(/^\/+|\/+$/g, "");
  if (!trimmed) throw new Error("resource must be a non-empty path segment");
  return `/${trimmed}`;
}

function entityPath(resource: string, id: string): string {
  if (!String(id)) throw new Error("id must be a non-empty string");
  return `${resourcePath(resource)}/${encodeURIComponent(String(id))}`;
}

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `contacts_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { status?: unknown }).status === 404);
}

export function createStorageClient(name: string, transport: HasnaHttpTransport): StorageClient {
  return {
    name,
    baseUrl: transport.baseUrl,
    transport,
    list: (resource, opts) => transport.get(resourcePath(resource), opts),
    async get(resource, id, opts) {
      try {
        return await transport.get(entityPath(resource, id), opts);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    create: (resource, body, opts = {}) =>
      transport.post(resourcePath(resource), body, {
        ...opts,
        idempotencyKey: opts.idempotencyKey ?? newIdempotencyKey(),
      }),
    update: (resource, id, patch, opts = {}) => {
      const { method = "PATCH", ...requestOptions } = opts;
      return (method === "PUT" ? transport.put : transport.patch)(entityPath(resource, id), patch, requestOptions);
    },
    async delete(resource, id, opts) {
      try {
        return await transport.del(entityPath(resource, id), undefined, opts);
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
  };
}

export interface ResolveStorageClientResult {
  transport: "https";
  client: StorageClient;
  resolution: ClientTransportResolution;
}

/** Build the contacts client for a resolved API configuration. An incomplete
 * configuration is terminal for THIS function — callers that want the
 * automatic transport fallback (hosted API when configured, local SQLite
 * otherwise) resolve through `getStore()` instead. */
export function resolveContactsStorageClient(
  name: string,
  env: Env = process.env,
  credentials: CredentialChainOptions = {},
): ResolveStorageClientResult {
  const resolution = resolveContactsClientTransport(name, env, credentials);
  if (!resolution.configured || !resolution.baseUrl) {
    throw new ContactsClientConfigurationError(
      "CONTACTS_API_NOT_CONFIGURED",
      `${resolution.issue ?? "The contacts API client is not configured."} ` +
        "Configure HASNA_CONTACTS_API_URL and a contacts API key to use the hosted API; " +
        "without them the client uses the local SQLite store.",
    );
  }

  const baseUrl = resolution.baseUrl;
  // The chain options the resolver saw, decided on the ORIGINAL env before
  // any snapshot copy exists: the per-request re-resolution below hands the
  // resolver a copy, and #1788 requires the Keychain gate to travel with it
  // rather than silently turning the machine's tier off on every request.
  const chainOptions = contactsResolverCredentials(env, credentials);
  // Bind the authority for the lifetime of this Store. Each request resolves a
  // fresh credential, but a changed authority requires a new client, not a key
  // intended for the new server sent to the previous server. The send guard
  // also runs after asynchronous vault resolution and before every retry.
  const request: HasnaHttpTransport["request"] = async (method, path, body, opts) => {
    const stamp = clientConfigurationStamp(env);
    const snapshot = { ...env };
    const current = resolveContactsClientTransport(name, snapshot, chainOptions);
    if (!current.configured || current.baseUrl !== baseUrl) {
      throw new ContactsClientConfigurationError("CONTACTS_AUTHORITY_CHANGED", "Client authority changed or disappeared; construct a new client before sending data.");
    }
    const credential = resolveCredential(name, snapshot, chainOptions);
    if (!credential) throw new ContactsClientConfigurationError("CONTACTS_API_NOT_CONFIGURED", "No credential is available.");
    assertConfigurationUnchanged(env, stamp);
    const transport = createHasnaHttpTransport({
      name,
      baseUrl,
      apiKey: () => credential,
      fetchImpl: (input, init) => {
        assertConfigurationUnchanged(env, stamp);
        return globalThis.fetch(input, init);
      },
    });
    return transport.request(method, path, body, opts);
  };
  const transport: HasnaHttpTransport = {
    baseUrl, request,
    get: (path, opts) => request("GET", path, undefined, opts),
    post: (path, body, opts) => request("POST", path, body, opts),
    put: (path, body, opts) => request("PUT", path, body, opts),
    patch: (path, body, opts) => request("PATCH", path, body, opts),
    del: (path, body, opts) => request("DELETE", path, body, opts),
  };
  return { transport: "https", client: createStorageClient(name, transport), resolution };
}
