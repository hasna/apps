/**
 * Canonical contacts client transport.
 *
 * Public clients have exactly one data path: an authenticated HTTPS `/v1`
 * authority. The server URL is always explicit; this module never composes or
 * guesses a hosted URL. API-key resolution and per-request rotation are owned
 * by `@hasna/contracts/client`, so key material is never exposed by status
 * objects or cached in this package.
 *
 * SQLite, PostgreSQL DSNs, and storage/deployment modes are not client
 * transports. A stale selector is a configuration error, not a reason to read
 * a different data set.
 */
import {
  createClientTransport,
  resolveClientTransport as resolveSharedClientTransport,
  type ClientTransportResolution as SharedClientTransportResolution,
  type HasnaHttpTransport,
  type HasnaRequestOptions,
  type QueryParams,
} from "@hasna/contracts/client";

export type Env = Record<string, string | undefined>;
export type { QueryParams };

export const RETIRED_CLIENT_SELECTOR_KEYS = [
  "HASNA_CONTACTS_STORAGE_MODE",
  "CONTACTS_STORAGE_MODE",
  "HASNA_CONTACTS_MODE",
  "CONTACTS_MODE",
  "HASNA_CONTACTS_DB_PATH",
  "CONTACTS_DB_PATH",
  "HASNA_CONTACTS_DATABASE_URL",
  "CONTACTS_DATABASE_URL",
] as const;

function configuredKeys(env: Env, keys: readonly string[]): string[] {
  return keys.filter((key) => env[key] !== undefined && env[key]!.trim().length > 0);
}

function assertNoRetiredClientSelectors(env: Env): void {
  const found = configuredKeys(env, RETIRED_CLIENT_SELECTOR_KEYS);
  if (found.length === 0) return;
  throw new ContactsClientConfigurationError(
    "RETIRED_CONTACTS_CLIENT_SELECTOR",
    `Contacts clients use only HASNA_CONTACTS_API_URL plus an API key resolved by @hasna/contracts. ` +
      `Remove retired client selector${found.length === 1 ? "" : "s"}: ${found.join(", ")}. ` +
      "PostgreSQL configuration belongs only on contacts-serve; local SQLite is available only through the explicit legacy migration command.",
  );
}

function assertHttpsBaseUrl(baseUrl: string): void {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") {
    throw new ContactsClientConfigurationError(
      "CONTACTS_API_HTTPS_REQUIRED",
      "HASNA_CONTACTS_API_URL must use HTTPS. Plain HTTP and local-store fallback are disabled for contacts clients.",
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
  apiKeyTier: SharedClientTransportResolution["apiKeyTier"];
  configured: boolean;
  misconfigured: boolean;
  issue: string | null;
  warning: string | null;
}

function unconfiguredResolution(
  resolution: SharedClientTransportResolution,
  issue: string,
): ClientTransportResolution {
  return {
    transport: "unconfigured",
    baseUrl: null,
    apiUrlSource: resolution.apiUrlSource,
    apiKeyPresent: resolution.apiKeyPresent,
    apiKeySource: resolution.apiKeySource,
    apiKeyTier: resolution.apiKeyTier,
    configured: false,
    misconfigured: true,
    issue,
    warning: null,
  };
}

/**
 * Resolve value-free connection diagnostics. This function does not invent a
 * default authority and never reports a local transport as usable.
 */
export function resolveContactsClientTransport(name: string, env: Env = process.env): ClientTransportResolution {
  if (name !== "contacts") {
    throw new ContactsClientConfigurationError("CONTACTS_CLIENT_NAME_INVALID", "This resolver only accepts the contacts app slug.");
  }
  assertNoRetiredClientSelectors(env);

  const resolution = resolveSharedClientTransport(name, env);
  if (resolution.transport !== "http" || !resolution.baseUrl) {
    const issue = resolution.misconfigured
      ? "The configured contacts API URL or credential is invalid or incomplete."
      : "HASNA_CONTACTS_API_URL and a resolvable contacts API key are required; no local fallback exists.";
    return unconfiguredResolution(resolution, issue);
  }

  try {
    assertHttpsBaseUrl(resolution.baseUrl);
  } catch (error) {
    return {
      ...unconfiguredResolution(
        resolution,
        error instanceof Error ? error.message : String(error),
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
    warning: null,
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

/** Build the sole contacts client. Any incomplete configuration is terminal. */
export function resolveContactsStorageClient(name: string, env: Env = process.env): ResolveStorageClientResult {
  const resolution = resolveContactsClientTransport(name, env);
  if (!resolution.configured || !resolution.baseUrl) {
    throw new ContactsClientConfigurationError(
      "CONTACTS_API_NOT_CONFIGURED",
      `${resolution.issue ?? "The contacts API client is not configured."} ` +
        "Configure HASNA_CONTACTS_API_URL and a contacts API key; the client will not read or create a local SQLite database.",
    );
  }

  const wired = createClientTransport(name, env);
  if (wired.transport !== "http") {
    throw new ContactsClientConfigurationError(
      "CONTACTS_API_NOT_CONFIGURED",
      "The shared client seam did not resolve an HTTP authority; local fallback is disabled.",
    );
  }
  assertHttpsBaseUrl(wired.client.baseUrl);
  return { transport: "https", client: createStorageClient(name, wired.client), resolution };
}
