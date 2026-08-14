// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: domains 0.0.0

export interface Error { "error": string; "reason"?: string }

export interface HealthResponse { "status": string; "version": string; "mode": string; "latencyMs"?: number }

export interface ReadyResponse { "status": string; "version": string; "mode": string; "pendingMigrations"?: Array<string> }

export interface VersionResponse { "status": string; "version": string; "mode": string }

export interface DeleteResult { "id": string; "deleted": boolean }

export interface Domain { "id": string; "name": string; "registrar"?: string | null; "status": string; "registered_at"?: string | null; "expires_at"?: string | null; "auto_renew": boolean; "is_premium": boolean; "premium_price"?: number | null; "standard_price"?: number | null; "purchase_price"?: number | null; "purchase_date"?: string | null; "nameservers"?: Array<string>; "whois"?: Record<string, unknown>; "ssl_expires_at"?: string | null; "ssl_issuer"?: string | null; "notes"?: string | null; "metadata"?: Record<string, unknown>; "created_at": string; "updated_at": string }

export interface DomainList { "domains": Array<Domain>; "count": number }

export interface CreateDomainInput { "name": string; "registrar"?: string; "status"?: string; "registered_at"?: string; "expires_at"?: string; "auto_renew"?: boolean; "is_premium"?: boolean; "premium_price"?: number; "standard_price"?: number; "purchase_price"?: number; "purchase_date"?: string; "nameservers"?: Array<string>; "whois"?: Record<string, unknown>; "ssl_expires_at"?: string; "ssl_issuer"?: string; "notes"?: string; "metadata"?: Record<string, unknown> }

export interface UpdateDomainInput { "name"?: string; "registrar"?: string | null; "status"?: string; "registered_at"?: string | null; "expires_at"?: string | null; "auto_renew"?: boolean; "is_premium"?: boolean; "premium_price"?: number | null; "standard_price"?: number | null; "purchase_price"?: number | null; "purchase_date"?: string | null; "nameservers"?: Array<string>; "whois"?: Record<string, unknown>; "ssl_expires_at"?: string | null; "ssl_issuer"?: string | null; "notes"?: string | null; "metadata"?: Record<string, unknown> }

export interface DnsRecord { "id": string; "domain_id": string; "type": string; "name": string; "value": string; "ttl": number; "priority"?: number | null; "created_at": string }

export interface DnsRecordList { "records": Array<DnsRecord>; "count": number }

export interface CreateDnsRecordInput { "type": "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SRV"; "name": string; "value": string; "ttl"?: number; "priority"?: number }

export interface DomainOffer { "id": string; "domain_id": string; "our_offer"?: number | null; "their_ask"?: number | null; "status": string; "notes"?: string | null; "created_at": string }

export interface OfferList { "offers": Array<DomainOffer>; "count": number }

export interface CreateOfferInput { "our_offer"?: number; "their_ask"?: number; "status"?: string; "notes"?: string }

export interface DomainStats { "total": number; "active"?: number; "expired"?: number; "transferring"?: number; "redemption"?: number; "auto_renew_enabled"?: number; "expiring_30_days"?: number; "ssl_expiring_30_days"?: number }

export interface DomainsClientOptions {
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

export class DomainsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: DomainsClientOptions) {
    if (!options.baseUrl) throw new Error("DomainsClient requires a baseUrl.");
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

    /** Liveness probe (DB reachable). */
    async getHealth(init?: RequestInit): Promise<HealthResponse> {
      return this.request("GET", `/health`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Readiness probe (DB reachable and schema migrated). */
    async getReady(init?: RequestInit): Promise<ReadyResponse> {
      return this.request("GET", `/ready`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Get a DNS record by id. */
    async getDnsRecord(id: string, init?: RequestInit): Promise<DnsRecord> {
      return this.request("GET", `/v1/dns/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a DNS record. */
    async deleteDnsRecord(id: string, init?: RequestInit): Promise<DeleteResult> {
      return this.request("DELETE", `/v1/dns/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List domains. */
    async listDomains(query?: { "search"?: string; "status"?: string; "limit"?: number; "offset"?: number }, init?: RequestInit): Promise<DomainList> {
      return this.request("GET", `/v1/domains`, {
        body: undefined,
        query,
        init,
      });
    }

    /** Create a domain. */
    async createDomain(body: CreateDomainInput, init?: RequestInit): Promise<Domain> {
      return this.request("POST", `/v1/domains`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get a domain by id. */
    async getDomain(id: string, init?: RequestInit): Promise<Domain> {
      return this.request("GET", `/v1/domains/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete a domain. */
    async deleteDomain(id: string, init?: RequestInit): Promise<DeleteResult> {
      return this.request("DELETE", `/v1/domains/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Update a domain. */
    async updateDomain(id: string, body: UpdateDomainInput, init?: RequestInit): Promise<Domain> {
      return this.request("PATCH", `/v1/domains/${encodeURIComponent(String(id))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List DNS records for a domain. */
    async listDnsRecords(id: string, init?: RequestInit): Promise<DnsRecordList> {
      return this.request("GET", `/v1/domains/${encodeURIComponent(String(id))}/dns`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create a DNS record for a domain. */
    async createDnsRecord(id: string, body: CreateDnsRecordInput, init?: RequestInit): Promise<DnsRecord> {
      return this.request("POST", `/v1/domains/${encodeURIComponent(String(id))}/dns`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List marketplace offers for a domain. */
    async listOffers(id: string, init?: RequestInit): Promise<OfferList> {
      return this.request("GET", `/v1/domains/${encodeURIComponent(String(id))}/offers`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create a marketplace offer for a domain. */
    async createOffer(id: string, body: CreateOfferInput, init?: RequestInit): Promise<DomainOffer> {
      return this.request("POST", `/v1/domains/${encodeURIComponent(String(id))}/offers`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Portfolio statistics. */
    async getDomainStats(init?: RequestInit): Promise<DomainStats> {
      return this.request("GET", `/v1/stats`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Service version and mode. */
    async getVersion(init?: RequestInit): Promise<VersionResponse> {
      return this.request("GET", `/version`, {
        body: undefined,
        query: undefined,
        init,
      });
    }
}
