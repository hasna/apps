// Typed client for the secrets serve API (@hasna/secrets/sdk).
//
// The method surface mirrors the serve OpenAPI document (src/server/openapi.ts).
// It does NOT open its own HTTP transport: every request routes through the ONE
// shared Hasna transport (createHasnaHttpTransport) that the ApiStore uses, so
// there is a single auth/retry/timeout implementation — no raw `fetch` and no
// second parallel transport. Auth is sent as BOTH `Authorization: Bearer` and
// `x-api-key` (the serve accepts either), matching the Store transport exactly.
//
// This is a client-only surface: it always talks to a remote `<baseUrl>` and can
// never touch local data, so it cannot split-brain.

import { createHasnaHttpTransport, HasnaHttpError } from "../store/client.js";
// TYPES come from the published spelling. `CredentialProvider` in particular is
// part of `SecretsClientOptions`, which IS the `.`/`./sdk` type entry: naming
// @hasna/contracts here would put a build-time-only import into dist/sdk.d.ts
// and break every TS consumer (see ../store/client-types.ts).
import type {
  CredentialProvider,
  HasnaHttpTransport,
  HasnaRequestOptions,
  QueryParams,
} from "../store/client-types.js";

export interface Status { "status": string; "version": string; "mode": string }

export type ReadyStatus = Status & { "pendingMigrations"?: Array<string> };

export interface SecretMetadata { "key": string; "type": "api_key" | "password" | "token" | "credential" | "other"; "label"?: string | null; "expires_at"?: string | null; "created_at": string; "updated_at": string }

export interface Secret { "key": string; "value": string; "type": string; "label"?: string | null; "expires_at"?: string | null; "created_at"?: string; "updated_at"?: string }

export interface SecretInput { "key": string; "value": string; "type"?: "api_key" | "password" | "token" | "credential" | "other"; "label"?: string; "ttl"?: string; "reason"?: string; "change_kind"?: string; "batch_id"?: string }

export type VersionChangeKind = "initial" | "set" | "rotation" | "import" | "restore" | "migration";

export interface SecretVersionMeta {
  "version": number;
  "change_kind": VersionChangeKind;
  "reason"?: string | null;
  "label"?: string | null;
  "created_at": string;
  "created_by": string;
  "source_version"?: number | null;
  "batch_id"?: string | null;
  "provider_expires_at"?: string | null;
  "value_length": number;
  "fingerprint": string;
  "current": boolean;
}

export type SecretVersionCheck = SecretVersionMeta & { "hash": string };

export interface RestoreInput {
  "key": string;
  "version": number;
  "reason": string;
  "expected_current_version": number;
}

export interface VaultItemMetadata { "id": string; "kind": string; "title": string; "subtitle"?: string | null; "domains": Array<string>; "tags": Array<string>; "favorite": boolean; "created_at": string; "updated_at": string }

export type VaultItem = VaultItemMetadata & { "data": Record<string, unknown> };

export interface VaultItemInput { "id"?: string; "kind": string; "title": string; "subtitle"?: string; "domains"?: Array<string>; "tags"?: Array<string>; "favorite"?: boolean; "data": Record<string, unknown> }

export interface UserInput { "id": string; "name": string; "type"?: "human" | "agent" }

export interface SecretsClientOptions {
  /** Base URL origin, e.g. process.env.APP_API_URL (`https://secrets.your-deployment.example`). */
  baseUrl: string;
  /**
   * API key, sent as Bearer + x-api-key.
   *
   * Prefer a {@link CredentialProvider} — the shared transport calls it fresh
   * for every request, so a long-lived client picks up a key rotation (and the
   * `HASNA_SECRETS_API_KEY_REF` pointer tier) without being rebuilt. A plain
   * string is still accepted and is treated as a deliberate, explicit
   * credential. `createSecretsClientFromEnv` passes a provider.
   */
  apiKey?: string | CredentialProvider;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export class SecretsClient {
  private readonly transport: HasnaHttpTransport;

  constructor(options: SecretsClientOptions) {
    if (!options.baseUrl) throw new Error("SecretsClient requires a baseUrl.");
    // The OpenAPI paths already carry their own prefix (`/v1/...`, `/health`,
    // `/version`), so the transport base is the raw origin, not `<origin>/v1`.
    this.transport = createHasnaHttpTransport({
      name: "secrets",
      baseUrl: options.baseUrl.replace(/\/+$/, ""),
      apiKey: options.apiKey ?? "",
      ...(options.fetch ? { fetchImpl: (input, init) => options.fetch!(input, init) } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
    });
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit }): Promise<T> {
    const requestOpts: HasnaRequestOptions = {};
    if (opts.query) requestOpts.query = opts.query as QueryParams;
    const initHeaders = opts.init?.headers as Record<string, string> | undefined;
    if (initHeaders) requestOpts.headers = initHeaders;
    if (opts.init?.signal) requestOpts.signal = opts.init.signal;
    try {
      return await this.transport.request<T>(method, path, opts.body, requestOpts);
    } catch (error) {
      if (error instanceof HasnaHttpError) {
        throw new ApiError(error.status, `${method} ${path} failed: ${error.status}`, error.body);
      }
      throw error;
    }
  }

    /** Liveness probe */
    async health(init?: RequestInit): Promise<Status> {
      return this.request("GET", `/health`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Readiness probe */
    async ready(init?: RequestInit): Promise<ReadyStatus> {
      return this.request("GET", `/ready`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List audit log entries */
    async listAudit(query?: { "key"?: string; "limit"?: number }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/audit`, {
        body: undefined,
        query,
        init,
      });
    }

    /** List vault item metadata */
    async listItems(query?: { "kind"?: string }, init?: RequestInit): Promise<{ "items"?: Array<VaultItemMetadata> }> {
      return this.request("GET", `/v1/items`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create or update a vault item */
    async putItem(body: VaultItemInput, init?: RequestInit): Promise<VaultItem> {
      return this.request("POST", `/v1/items`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Search vault item metadata */
    async searchItems(query?: { "q": string }, init?: RequestInit): Promise<{ "results"?: Array<VaultItemMetadata> }> {
      return this.request("GET", `/v1/items/search`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Get a vault item with decrypted payload */
    async getItem(id: string, init?: RequestInit): Promise<VaultItem> {
      return this.request("GET", `/v1/items/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a vault item */
    async deleteItem(id: string, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("DELETE", `/v1/items/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List secret metadata */
    async listSecrets(query?: { "namespace"?: string }, init?: RequestInit): Promise<{ "secrets"?: Array<SecretMetadata> }> {
      return this.request("GET", `/v1/secrets`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create or update a secret */
    async putSecret(body: SecretInput, init?: RequestInit): Promise<SecretMetadata> {
      return this.request("POST", `/v1/secrets`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Delete a secret by key */
    async deleteSecret(query?: { "key": string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("DELETE", `/v1/secrets`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Get a secret value by key */
    async getSecret(query?: { "key": string }, init?: RequestInit): Promise<Secret> {
      return this.request("GET", `/v1/secrets/get`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Search secret metadata */
    async searchSecrets(query?: { "q": string }, init?: RequestInit): Promise<{ "results"?: Array<SecretMetadata> }> {
      return this.request("GET", `/v1/secrets/search`, {
        body: undefined,
        query,
        init,
      });
    }

    /** List secret version metadata (never value material) */
    async listSecretVersions(query?: { "key": string; "limit"?: number }, init?: RequestInit): Promise<{ "versions"?: Array<SecretVersionMeta> }> {
      return this.request("GET", `/v1/secrets/versions`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Version evidence in the get --check class: length + sha256, never the value */
    async checkSecretVersion(query?: { "key": string; "version": number }, init?: RequestInit): Promise<{ "check"?: SecretVersionCheck }> {
      return this.request("GET", `/v1/secrets/versions/check`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Append-only restore: server-side copy of a historical value into a new current version */
    async restoreSecretVersion(body: RestoreInput, init?: RequestInit): Promise<{ "restored"?: SecretVersionMeta }> {
      return this.request("POST", `/v1/secrets/restore`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List registered users */
    async listUsers(query?: { "type"?: string }, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("GET", `/v1/users`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Register a user or agent */
    async registerUser(body: UserInput, init?: RequestInit): Promise<Record<string, unknown>> {
      return this.request("POST", `/v1/users`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Version info */
    async version(init?: RequestInit): Promise<Status> {
      return this.request("GET", `/version`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
