// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: SecretsApi 0.1.32

export interface Status { "status": string; "version": string; "mode": string }

export type ReadyStatus = Status & { "pendingMigrations"?: Array<string> };

export interface SecretMetadata { "key": string; "type": "api_key" | "password" | "token" | "credential" | "other"; "label"?: string | null; "expires_at"?: string | null; "created_at": string; "updated_at": string }

export interface Secret { "key": string; "value": string; "type": string; "label"?: string | null; "expires_at"?: string | null; "created_at"?: string; "updated_at"?: string }

export interface SecretInput { "key": string; "value": string; "type"?: "api_key" | "password" | "token" | "credential" | "other"; "label"?: string; "ttl"?: string }

export interface VaultItemMetadata { "id": string; "kind": string; "title": string; "subtitle"?: string | null; "domains": Array<string>; "tags": Array<string>; "favorite": boolean; "created_at": string; "updated_at": string }

export type VaultItem = VaultItemMetadata & { "data": Record<string, unknown> };

export interface VaultItemInput { "id"?: string; "kind": string; "title": string; "subtitle"?: string; "domains"?: Array<string>; "tags"?: Array<string>; "favorite"?: boolean; "data": Record<string, unknown> }

export interface UserInput { "id": string; "name": string; "type"?: "human" | "agent" }

export interface SecretsClientOptions {
  /** Base URL, e.g. process.env.APP_API_URL. */
  baseUrl: string;
  /** API key, e.g. process.env.APP_API_KEY. Sent as the 'x-api-key' header. */
  apiKey?: string;
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
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: SecretsClientOptions) {
    if (!options.baseUrl) throw new Error("SecretsClient requires a baseUrl.");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseHeaders = options.headers ?? {};
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit }): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { Accept: "application/json", ...this.baseHeaders, ...(opts.init?.headers as Record<string, string> | undefined) };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    let payload: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }
    const response = await this.fetchImpl(url.toString(), { ...opts.init, method, headers, body: payload });
    const text = await response.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
    if (!response.ok) {
      throw new ApiError(response.status, `${method} ${path} failed: ${response.status}`, data);
    }
    return data as T;
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
