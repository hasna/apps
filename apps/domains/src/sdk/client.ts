// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: domains 0.0.0

export interface Error { "error": string; "reason"?: string }

export interface HealthResponse { "status": string; "version": string; "latencyMs"?: number }

export interface ReadyResponse { "status": string; "version": string; "pendingMigrations"?: Array<string> }

export interface VersionResponse { "status": string; "version": string }

export interface DeleteResult { "id": string; "deleted": boolean }

export interface AvailabilityInput { "name": string }

export interface AvailabilityQuote { "name": string; "available": boolean; "price_usd"?: number; "registration_price_usd"?: number; "renewal_price_usd"?: number; "currency"?: string; "is_premium"?: boolean }

export interface DomainProvisioningRequest { "name": string; "max_price_usd": number; "years": number; "auto_renew": boolean; "registrar"?: "route53"; "dns_provider"?: "cloudflare"; "target"?: "shortlinks" | "website_origin"; "worker_name"?: string | null; "origin_hostname"?: string | null }

export interface DomainAdoptionRequest { "name": string; "dns_provider"?: "cloudflare"; "target": "shortlinks" | "website_origin"; "worker_name"?: string | null; "origin_hostname"?: string | null }

export interface DomainProvisioningProviderState { "quoted_price_usd"?: number; "currency"?: string; "registration_operation_id"?: string; "nameserver_operation_id"?: string; "cloudflare_zone_id"?: string; "cloudflare_nameservers"?: Array<string>; "route53_zone_ids_before_registration"?: Array<string>; "route53_hosted_zone_id"?: string; "route53_hosted_zone_cleaned"?: boolean; "worker_domain_bound"?: boolean; "website_origin_configured"?: boolean; "web_records"?: Array<ProvisionedWebRecord>; "target_checked_at"?: string; "last_provider_status"?: string; "registration_submitted_at"?: string; "nameservers_submitted_at"?: string }

export interface DomainProvisioningJob { "id": string; "domain_id": string; "name": string; "idempotency_key": string; "request_hash": string; "status": "requested" | "quoted" | "registration_submitting" | "registration_submitted" | "registered" | "zone_ready" | "nameservers_submitted" | "delegated" | "worker_bound" | "ready" | "manual_review" | "failed"; "max_price_usd": number; "years": number; "auto_renew": boolean; "acquisition_mode": "purchase" | "adopt"; "registrar": string; "dns_provider": string; "target": string; "worker_name": string | null; "origin_hostname": string | null; "provider_state": DomainProvisioningProviderState; "result": DomainProvisioningResult | null; "attempts": number; "error"?: string | null; "lease_until"?: string | null; "created_at": string; "updated_at": string }

export interface ProvisionedWebRecord { "type": "CNAME"; "name": string; "value": string; "proxied": true; "ttl": number }

export interface DomainProvisioningResult { "zone_ref": string; "nameservers": Array<string>; "web_records": Array<ProvisionedWebRecord>; "checked_at": string }

export interface HostedDnsRecord { "type": "TXT" | "CNAME" | "MX"; "name": string; "value": string; "ttl": number; "priority"?: number | null }

export interface DomainDnsReconciliationRequest { "records": Array<HostedDnsRecord> }

export interface DomainDnsReconciliation { "id": string; "provisioning_job_id": string; "domain_name": string; "idempotency_key": string; "request_hash": string; "status": "requested" | "applying" | "ready" | "manual_review"; "records": Array<HostedDnsRecord>; "result": { "records": Array<HostedDnsRecord>; "checked_at": string } | null; "error": string | null; "lease_until": string | null; "created_at": string; "updated_at": string }

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
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
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

    /** Check live registrar availability and current price. */
    async checkDomainAvailability(body: AvailabilityInput, init?: RequestInit): Promise<AvailabilityQuote> {
      return this.request("POST", `/v1/availability`, {
        body,
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

    /** Reserve, cap the total charge, purchase, delegate and bind a domain through the hosted Domains authority. */
    async requestDomainProvisioning(body: DomainProvisioningRequest, init?: RequestInit): Promise<DomainProvisioningJob> {
      return this.request("POST", `/v1/provisioning`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Adopt an existing portfolio domain into hosted provisioning without a registrar purchase. */
    async adoptOwnedDomainProvisioning(body: DomainAdoptionRequest, init?: RequestInit): Promise<DomainProvisioningJob> {
      return this.request("POST", `/v1/provisioning/adopt`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Read the durable provisioning job for a canonical domain name. */
    async getDomainProvisioningByName(name: string, init?: RequestInit): Promise<DomainProvisioningJob> {
      return this.request("GET", `/v1/provisioning/by-name/${encodeURIComponent(String(name))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Idempotently reconcile bounded TXT, CNAME, and MX record groups for a ready hosted domain. */
    async reconcileProvisionedDomainDns(name: string, body: DomainDnsReconciliationRequest, init?: RequestInit): Promise<DomainDnsReconciliation> {
      return this.request("POST", `/v1/provisioning/by-name/${encodeURIComponent(String(name))}/dns-reconcile`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Read a domain provisioning job. */
    async getDomainProvisioning(id: string, init?: RequestInit): Promise<DomainProvisioningJob> {
      return this.request("GET", `/v1/provisioning/${encodeURIComponent(String(id))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Advance one idempotent hosted provisioning step (operator recovery path). */
    async advanceDomainProvisioning(id: string, init?: RequestInit): Promise<DomainProvisioningJob> {
      return this.request("POST", `/v1/provisioning/${encodeURIComponent(String(id))}/advance`, {
        body: undefined,
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
