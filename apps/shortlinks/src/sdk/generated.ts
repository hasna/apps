// @generated from src/serve/openapi.ts by scripts/generate-sdk.ts — DO NOT EDIT.
// Regenerate: bun run sdk:generate

// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: ShortlinksApi 0.0.0

export interface Link { "id": string; "domain_id": string; "hostname": string; "slug": string; "destination_url": string; "title"?: string | null; "active": boolean; "expires_at"?: string | null; "short_url"?: string; "metadata"?: Record<string, unknown>; "created_at": string; "updated_at"?: string }

export interface Domain { "id": string; "hostname": string; "provider": string; "default_domain": boolean; "origin_url"?: string | null; "notes"?: string | null; "metadata"?: Record<string, unknown>; "created_at": string; "updated_at"?: string }

export interface LinkStats { "link": Link; "clicks": number; "last_clicked_at"?: string | null; "top_referrers"?: Array<{ "referer"?: string | null; "clicks"?: number }>; "top_user_agents"?: Array<{ "user_agent"?: string | null; "clicks"?: number }> }

export type LinkList = Array<{ "id": string; "domain_id": string; "hostname": string; "slug": string; "destination_url": string; "title"?: string | null; "active": boolean; "expires_at"?: string | null; "short_url"?: string; "metadata"?: Record<string, unknown>; "created_at": string; "updated_at"?: string }>;

export type DomainList = Array<{ "id": string; "hostname": string; "provider": string; "default_domain": boolean; "origin_url"?: string | null; "notes"?: string | null; "metadata"?: Record<string, unknown>; "created_at": string; "updated_at"?: string }>;

export interface TotalStats { "domains": number; "links": number; "clicks": number }

export interface CreateLinkRequest { "url": string; "domain"?: string; "slug"?: string; "title"?: string; "expires_at"?: string; "length"?: number; "metadata"?: Record<string, unknown> }

export interface AddDomainRequest { "hostname": string; "provider"?: string; "default"?: boolean; "origin_url"?: string; "notes"?: string; "metadata"?: Record<string, unknown> }

export interface DeleteResponse { "deleted": boolean; "slug"?: string }

export interface DomainDeleteResponse { "deleted": boolean; "hostname"?: string }

export interface HealthStatus { "status": string; "version": string; "mode": string; "db_latency_ms"?: number }

export interface ReadyStatus { "status": string; "version": string; "mode": string; "pending_migrations"?: Array<string> }

export interface VersionInfo { "status": string; "version": string; "mode": string; "name"?: string }

export interface ErrorResponse { "error": string; "reason"?: string }

export interface ShortlinksApiClientOptions {
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

export class ShortlinksApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: ShortlinksApiClientOptions) {
    if (!options.baseUrl) throw new Error("ShortlinksApiClient requires a baseUrl.");
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

    /** Liveness probe. */
    async getHealth(init?: RequestInit): Promise<HealthStatus> {
      return this.request("GET", `/health`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Readiness probe (DB reachable and schema migrated). */
    async getReady(init?: RequestInit): Promise<ReadyStatus> {
      return this.request("GET", `/ready`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List configured domains. */
    async listDomains(init?: RequestInit): Promise<DomainList> {
      return this.request("GET", `/v1/domains`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Add or update a domain. */
    async addDomain(body: AddDomainRequest, init?: RequestInit): Promise<Domain> {
      return this.request("POST", `/v1/domains`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Delete a domain and all of its links and clicks. */
    async deleteDomain(hostname: string, init?: RequestInit): Promise<DomainDeleteResponse> {
      return this.request("DELETE", `/v1/domains/${encodeURIComponent(String(hostname))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List shortlinks. */
    async listLinks(query?: { "domain"?: string; "active"?: boolean; "limit"?: number }, init?: RequestInit): Promise<LinkList> {
      return this.request("GET", `/v1/links`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create a shortlink. */
    async createLink(body: CreateLinkRequest, init?: RequestInit): Promise<Link> {
      return this.request("POST", `/v1/links`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get a shortlink by slug. */
    async getLink(slug: string, query?: { "domain"?: string }, init?: RequestInit): Promise<Link> {
      return this.request("GET", `/v1/links/${encodeURIComponent(String(slug))}`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Delete a shortlink. */
    async deleteLink(slug: string, query?: { "domain"?: string }, init?: RequestInit): Promise<DeleteResponse> {
      return this.request("DELETE", `/v1/links/${encodeURIComponent(String(slug))}`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Disable a shortlink. */
    async disableLink(slug: string, query?: { "domain"?: string }, init?: RequestInit): Promise<Link> {
      return this.request("POST", `/v1/links/${encodeURIComponent(String(slug))}/disable`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Enable a shortlink. */
    async enableLink(slug: string, query?: { "domain"?: string }, init?: RequestInit): Promise<Link> {
      return this.request("POST", `/v1/links/${encodeURIComponent(String(slug))}/enable`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Click stats for a shortlink. */
    async getLinkStats(slug: string, query?: { "domain"?: string }, init?: RequestInit): Promise<LinkStats> {
      return this.request("GET", `/v1/links/${encodeURIComponent(String(slug))}/stats`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Resolve a slug to its destination without recording a click. */
    async resolveLink(slug: string, query?: { "domain"?: string }, init?: RequestInit): Promise<Link> {
      return this.request("GET", `/v1/resolve/${encodeURIComponent(String(slug))}`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Total domains/links/clicks counts. */
    async getStats(init?: RequestInit): Promise<TotalStats> {
      return this.request("GET", `/v1/stats`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Service version and mode. */
    async getVersion(init?: RequestInit): Promise<VersionInfo> {
      return this.request("GET", `/version`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
