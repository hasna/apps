// ── The domains Store abstraction ────────────────────────────────────────────
//
// ONE interface, TWO transports. Every CLI command, MCP tool, and SDK caller
// that reads or writes domains DATA goes through `DomainsStore`. There are
// exactly two implementations:
//
//   • LocalStore — on-box SQLite. Delegates to the query/mutate helpers in the
//     ../db/* modules (domain-records, dns-records, alerts, domain-owners,
//     domain-history, domain-reputation). Those modules are the sqlite backing
//     of this transport and are ONLY reached through LocalStore.
//   • ApiStore   — the self_hosted/cloud HTTP API at `<API_URL>/v1` with a
//     bearer key. Delegates to the vendored @hasna/contracts storage client and
//     its transport escape hatch for nested resources.
//
// `getStore()` resolves which transport to use from the client-flip env
// (HASNA_DOMAINS_API_URL + HASNA_DOMAINS_API_KEY / HASNA_DOMAINS_STORAGE_MODE).
// Callers NEVER branch on mode themselves and NEVER touch sqlite or fetch
// directly — that split-brain bug is exactly what this module eliminates.
//
// `self_hosted` and `cloud` are the SAME client code (ApiStore); only the URL
// and key differ, and that distinction is server-side tenancy. `local` is
// first-class and fully functional.
//
// SAFETY: the API key never leaves the transport; it is never logged, returned,
// or embedded in any value produced here. Only the HTTP transport ever holds it.
// A raw DB DSN/DATABASE_URL is NEVER used on the client side.

import {
  resolveStorageClient,
  type HasnaStorageClient,
} from "@hasna/contracts/client/storage";

import * as records from "./domain-records.js";
import * as dns from "./dns-records.js";
import * as alertsDb from "./alerts.js";
import * as owners from "./domain-owners.js";
import * as history from "./domain-history.js";
import * as reputation from "./domain-reputation.js";

import type {
  CreateDomainInput,
  Domain,
  DomainDetails,
  DomainEmailLink,
  DomainOffer,
  DomainStats,
  ListDomainsOptions,
  RecordDomainPurchaseInput,
  UpdateDomainInput,
  CreateDomainOfferInput,
  CreateDomainEmailLinkInput,
  DomainStatus,
} from "./domain-records.js";
import type {
  DnsRecord,
  CreateDnsRecordInput,
  UpdateDnsRecordInput,
} from "./dns-records.js";
import type { Alert, CreateAlertInput } from "./alerts.js";
import type {
  DomainOwner,
  CreateDomainOwnerInput,
  DomainOwnerSource,
  DomainWithOwner,
} from "./domain-owners.js";
import type {
  DomainHistory,
  CreateHistoryEntryInput,
  DomainHistoryType,
} from "./domain-history.js";
import type {
  DomainReputation,
  CreateReputationInput,
} from "./domain-reputation.js";

const APP = "domains";

/**
 * The server's per-response row cap for `/v1/domains` (server/repo.ts clamps
 * `limit` to `[1, 1000]`). ApiStore paginates in units of this size so cloud
 * reads return the full result set instead of the server's default LIMIT 100.
 */
const DOMAINS_PAGE_SIZE = 1000;

type Env = Record<string, string | undefined>;

// ── The single data interface ────────────────────────────────────────────────

export interface DomainsStore {
  /** Which transport backs this store (for banners/diagnostics only). */
  readonly transport: "local" | "cloud-http";

  // domains
  createDomain(input: CreateDomainInput): Promise<Domain>;
  getDomain(id: string): Promise<Domain | null>;
  getDomainByName(name: string): Promise<Domain | null>;
  getDomainByIdentifier(identifier: string): Promise<Domain | null>;
  getDomainDetails(identifier: string): Promise<DomainDetails | null>;
  listDomains(options?: ListDomainsOptions): Promise<Domain[]>;
  updateDomain(id: string, input: UpdateDomainInput): Promise<Domain | null>;
  deleteDomain(id: string): Promise<boolean>;
  countDomains(): Promise<number>;
  searchDomains(query: string): Promise<Domain[]>;
  getByRegistrar(registrar: string): Promise<Domain[]>;
  listExpiring(days: number): Promise<Domain[]>;
  listSslExpiring(days: number): Promise<Domain[]>;
  getDomainStats(): Promise<DomainStats>;
  markDomainPremium(identifier: string, premiumPrice: number, standardPrice?: number): Promise<Domain | null>;
  updateDomainLifecycleStatus(identifier: string, status: DomainStatus, notes?: string): Promise<Domain | null>;
  recordDomainPurchase(identifier: string, input: RecordDomainPurchaseInput): Promise<Domain | null>;

  // offers
  createDomainOffer(input: CreateDomainOfferInput): Promise<DomainOffer>;
  getDomainOffer(id: string): Promise<DomainOffer | null>;
  listDomainOffers(domainId: string): Promise<DomainOffer[]>;

  // email links
  linkDomainEmail(input: CreateDomainEmailLinkInput): Promise<DomainEmailLink>;
  getDomainEmailLink(id: string): Promise<DomainEmailLink | null>;
  listDomainEmailLinks(domainId: string): Promise<DomainEmailLink[]>;

  // dns records
  createDnsRecord(input: CreateDnsRecordInput): Promise<DnsRecord>;
  getDnsRecord(id: string): Promise<DnsRecord | null>;
  listDnsRecords(domainId: string, type?: DnsRecord["type"]): Promise<DnsRecord[]>;
  updateDnsRecord(id: string, input: UpdateDnsRecordInput): Promise<DnsRecord | null>;
  deleteDnsRecord(id: string): Promise<boolean>;

  // alerts
  createAlert(input: CreateAlertInput): Promise<Alert>;
  getAlert(id: string): Promise<Alert | null>;
  listAlerts(domainId: string): Promise<Alert[]>;
  deleteAlert(id: string): Promise<boolean>;

  // owners
  createDomainOwner(input: CreateDomainOwnerInput): Promise<DomainOwner>;
  getDomainOwner(id: string): Promise<DomainOwner | null>;
  getDomainOwnerByDomain(domainId: string): Promise<DomainOwner | null>;
  getDomainOwnerByDomainName(domainName: string): Promise<DomainOwner | null>;
  listDomainOwners(options?: { search?: string; source?: DomainOwnerSource; verified?: boolean }): Promise<DomainOwner[]>;
  updateDomainOwner(id: string, input: Partial<CreateDomainOwnerInput>): Promise<DomainOwner | null>;
  deleteDomainOwner(id: string): Promise<boolean>;
  listDomainsWithOwners(): Promise<DomainWithOwner[]>;

  // history
  createHistoryEntry(input: CreateHistoryEntryInput): Promise<DomainHistory>;
  getHistoryEntry(id: string): Promise<DomainHistory | null>;
  getHistoryByDomain(domainId: string, options?: { type?: DomainHistoryType; limit?: number }): Promise<DomainHistory[]>;
  getLatestSnapshot(domainId: string, type: DomainHistoryType): Promise<DomainHistory | null>;
  getHistoryByDateRange(startDate: string, endDate: string, domainId?: string): Promise<DomainHistory[]>;
  listDomainsWithHistoryChanges(): Promise<Array<{ domain_id: string; domain_name: string; latest_snapshot_type: string; latest_snapshot_at: string; snapshot_count: number }>>;
  deleteHistoryEntry(id: string): Promise<boolean>;
  deleteHistoryByDomain(domainId: string): Promise<boolean>;

  // reputation
  upsertDomainReputation(input: CreateReputationInput): Promise<DomainReputation>;
  getDomainReputation(domainId: string): Promise<DomainReputation | null>;
  getDomainReputationByName(domainName: string): Promise<DomainReputation | null>;
  updateDomainReputation(id: string, input: Partial<CreateReputationInput>): Promise<DomainReputation | null>;
  listBlacklistedDomains(): Promise<DomainReputation[]>;
  listHighThreatDomains(threshold?: number): Promise<DomainReputation[]>;
  deleteDomainReputation(id: string): Promise<boolean>;
}

// ── LocalStore ────────────────────────────────────────────────────────────────
// Delegates to the sqlite-backed helper modules. Every method is async so the
// interface is transport-agnostic; the sqlite calls themselves are synchronous.

export class LocalStore implements DomainsStore {
  readonly transport = "local" as const;

  async createDomain(input: CreateDomainInput) { return records.createDomain(input); }
  async getDomain(id: string) { return records.getDomain(id); }
  async getDomainByName(name: string) { return records.getDomainByName(name); }
  async getDomainByIdentifier(identifier: string) { return records.getDomainByIdentifier(identifier); }
  async getDomainDetails(identifier: string) { return records.getDomainDetails(identifier); }
  async listDomains(options: ListDomainsOptions = {}) { return records.listDomains(options); }
  async updateDomain(id: string, input: UpdateDomainInput) { return records.updateDomain(id, input); }
  async deleteDomain(id: string) { return records.deleteDomain(id); }
  async countDomains() { return records.countDomains(); }
  async searchDomains(query: string) { return records.searchDomains(query); }
  async getByRegistrar(registrar: string) { return records.getByRegistrar(registrar); }
  async listExpiring(days: number) { return records.listExpiring(days); }
  async listSslExpiring(days: number) { return records.listSslExpiring(days); }
  async getDomainStats() { return records.getDomainStats(); }
  async markDomainPremium(identifier: string, premiumPrice: number, standardPrice?: number) { return records.markDomainPremium(identifier, premiumPrice, standardPrice); }
  async updateDomainLifecycleStatus(identifier: string, status: DomainStatus, notes?: string) { return records.updateDomainLifecycleStatus(identifier, status, notes); }
  async recordDomainPurchase(identifier: string, input: RecordDomainPurchaseInput) { return records.recordDomainPurchase(identifier, input); }

  async createDomainOffer(input: CreateDomainOfferInput) { return records.createDomainOffer(input); }
  async getDomainOffer(id: string) { return records.getDomainOffer(id); }
  async listDomainOffers(domainId: string) { return records.listDomainOffers(domainId); }

  async linkDomainEmail(input: CreateDomainEmailLinkInput) { return records.linkDomainEmail(input); }
  async getDomainEmailLink(id: string) { return records.getDomainEmailLink(id); }
  async listDomainEmailLinks(domainId: string) { return records.listDomainEmailLinks(domainId); }

  async createDnsRecord(input: CreateDnsRecordInput) { return dns.createDnsRecord(input); }
  async getDnsRecord(id: string) { return dns.getDnsRecord(id); }
  async listDnsRecords(domainId: string, type?: DnsRecord["type"]) { return dns.listDnsRecords(domainId, type); }
  async updateDnsRecord(id: string, input: UpdateDnsRecordInput) { return dns.updateDnsRecord(id, input); }
  async deleteDnsRecord(id: string) { return dns.deleteDnsRecord(id); }

  async createAlert(input: CreateAlertInput) { return alertsDb.createAlert(input); }
  async getAlert(id: string) { return alertsDb.getAlert(id); }
  async listAlerts(domainId: string) { return alertsDb.listAlerts(domainId); }
  async deleteAlert(id: string) { return alertsDb.deleteAlert(id); }

  async createDomainOwner(input: CreateDomainOwnerInput) { return owners.createDomainOwner(input); }
  async getDomainOwner(id: string) { return owners.getDomainOwner(id); }
  async getDomainOwnerByDomain(domainId: string) { return owners.getDomainOwnerByDomain(domainId); }
  async getDomainOwnerByDomainName(domainName: string) { return owners.getDomainOwnerByDomainName(domainName); }
  async listDomainOwners(options: { search?: string; source?: DomainOwnerSource; verified?: boolean } = {}) { return owners.listDomainOwners(options); }
  async updateDomainOwner(id: string, input: Partial<CreateDomainOwnerInput>) { return owners.updateDomainOwner(id, input); }
  async deleteDomainOwner(id: string) { return owners.deleteDomainOwner(id); }
  async listDomainsWithOwners() { return owners.listDomainsWithOwners(); }

  async createHistoryEntry(input: CreateHistoryEntryInput) { return history.createHistoryEntry(input); }
  async getHistoryEntry(id: string) { return history.getHistoryEntry(id); }
  async getHistoryByDomain(domainId: string, options?: { type?: DomainHistoryType; limit?: number }) { return history.getHistoryByDomain(domainId, options); }
  async getLatestSnapshot(domainId: string, type: DomainHistoryType) { return history.getLatestSnapshot(domainId, type); }
  async getHistoryByDateRange(startDate: string, endDate: string, domainId?: string) { return history.getHistoryByDateRange(startDate, endDate, domainId); }
  async listDomainsWithHistoryChanges() { return history.listDomainsWithHistoryChanges(); }
  async deleteHistoryEntry(id: string) { return history.deleteHistoryEntry(id); }
  async deleteHistoryByDomain(domainId: string) { return history.deleteHistoryByDomain(domainId); }

  async upsertDomainReputation(input: CreateReputationInput) { return reputation.upsertDomainReputation(input); }
  async getDomainReputation(domainId: string) { return reputation.getDomainReputation(domainId); }
  async getDomainReputationByName(domainName: string) { return reputation.getDomainReputationByName(domainName); }
  async updateDomainReputation(id: string, input: Partial<CreateReputationInput>) { return reputation.updateDomainReputation(id, input); }
  async listBlacklistedDomains() { return reputation.listBlacklistedDomains(); }
  async listHighThreatDomains(threshold?: number) { return reputation.listHighThreatDomains(threshold); }
  async deleteDomainReputation(id: string) { return reputation.deleteDomainReputation(id); }
}

// ── ApiStore ────────────────────────────────────────────────────────────────
// Routes every operation to the cloud HTTP API. CRUD on top-level resources goes
// through the storage client; nested collections (per-domain dns/alerts/offers/
// emails/owners/history/reputation) use the transport escape hatch.

/** Drop nullish query entries so we never send empty params to the API. */
function q(params: Record<string, string | number | boolean | null | undefined>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") out[k] = v;
  return out;
}

function enc(id: string): string {
  return encodeURIComponent(id);
}

export class ApiStore implements DomainsStore {
  readonly transport = "cloud-http" as const;
  constructor(private readonly client: HasnaStorageClient) {}

  private get http() {
    return this.client.transport;
  }

  // ── domains ────────────────────────────────────────────────────────────────

  async createDomain(input: CreateDomainInput): Promise<Domain> {
    return this.client.create<Domain>("domains", input);
  }

  async getDomain(id: string): Promise<Domain | null> {
    return this.client.get<Domain>("domains", id);
  }

  async getDomainByName(name: string): Promise<Domain | null> {
    const matches = await this.listDomains({ search: name });
    return matches.find((d) => d.name === name) ?? null;
  }

  async getDomainByIdentifier(identifier: string): Promise<Domain | null> {
    const byId = await this.client.get<Domain>("domains", identifier);
    if (byId) return byId;
    return this.getDomainByName(identifier);
  }

  async getDomainDetails(identifier: string): Promise<DomainDetails | null> {
    const domain = await this.getDomainByIdentifier(identifier);
    if (!domain) return null;
    const [offers, emails] = await Promise.all([
      this.listDomainOffers(domain.id),
      this.listDomainEmailLinks(domain.id),
    ]);
    return { domain, offers, emails };
  }

  async listDomains(options: ListDomainsOptions = {}): Promise<Domain[]> {
    // Parity contract with LocalStore (db/domain-records.listDomains): filter by
    // search/status/registrar/is_premium, order by name ASC, then apply
    // offset/limit AFTER filtering. The cloud `/v1/domains` endpoint only filters
    // on search/status, caps each response at 1000 rows, and — critically —
    // defaults to LIMIT 100 when no limit is sent (server/repo.ts). LocalStore is
    // unbounded, so any request that must return more than the server's page (or
    // that needs client-side registrar/is_premium filtering) MUST paginate the
    // full match set; otherwise cloud silently drops rows beyond the first 100.
    const needsClientFilter =
      options.registrar !== undefined || options.is_premium !== undefined;

    // Fast path: a bounded request the server satisfies exactly in one call —
    // no client-side filter and an explicit limit within the server's page cap.
    if (!needsClientFilter && typeof options.limit === "number" && options.limit <= DOMAINS_PAGE_SIZE) {
      const result = await this.client.list<Domain>("domains", {
        query: q({
          search: options.search,
          status: options.status,
          limit: options.limit,
          offset: options.offset,
        }),
      });
      const raw = result.raw as { domains?: Domain[] } | undefined;
      return raw?.domains ?? result.items;
    }

    // Parity path: gather ALL rows matching the server-side filters (search/
    // status), then apply client-side registrar/is_premium filters and
    // offset/limit exactly like LocalStore.
    let items = await this.listAllDomains(q({ search: options.search, status: options.status }));
    if (options.registrar !== undefined) items = items.filter((d) => d.registrar === options.registrar);
    if (options.is_premium !== undefined) items = items.filter((d) => d.is_premium === options.is_premium);
    const offset = options.offset ?? 0;
    if (offset > 0) items = items.slice(offset);
    if (typeof options.limit === "number") items = items.slice(0, options.limit);
    return items;
  }

  /**
   * Page through `/v1/domains` until the full result set for the given
   * server-side query (search/status only) is retrieved. The server orders by
   * name ASC and caps each page at {@link DOMAINS_PAGE_SIZE}; a short page means
   * the end has been reached. This is what makes cloud parity match LocalStore's
   * unbounded reads at >100-domain scale.
   */
  private async listAllDomains(serverQuery: Record<string, string | number | boolean>): Promise<Domain[]> {
    const acc: Domain[] = [];
    let offset = 0;
    for (;;) {
      const result = await this.client.list<Domain>("domains", {
        query: { ...serverQuery, limit: DOMAINS_PAGE_SIZE, offset },
      });
      const raw = result.raw as { domains?: Domain[] } | undefined;
      const page = raw?.domains ?? result.items;
      acc.push(...page);
      if (page.length < DOMAINS_PAGE_SIZE) break;
      offset += DOMAINS_PAGE_SIZE;
    }
    return acc;
  }

  async updateDomain(id: string, input: UpdateDomainInput): Promise<Domain | null> {
    const existing = await this.client.get<Domain>("domains", id);
    if (!existing) return null;
    return this.client.update<Domain>("domains", id, input);
  }

  async deleteDomain(id: string): Promise<boolean> {
    const existing = await this.client.get<Domain>("domains", id);
    if (!existing) return false;
    await this.client.delete("domains", id);
    return true;
  }

  async countDomains(): Promise<number> {
    return (await this.getDomainStats()).total;
  }

  async searchDomains(query: string): Promise<Domain[]> {
    return this.listDomains({ search: query });
  }

  async getByRegistrar(registrar: string): Promise<Domain[]> {
    return this.listDomains({ registrar });
  }

  async listExpiring(days: number): Promise<Domain[]> {
    const now = Date.now();
    const horizon = now + days * 24 * 60 * 60 * 1000;
    const domains = await this.listDomains({ status: "active" });
    return domains
      .filter((d) => {
        if (!d.expires_at) return false;
        const exp = Date.parse(d.expires_at);
        return Number.isFinite(exp) && exp >= now && exp <= horizon;
      })
      .sort((a, b) => Date.parse(a.expires_at ?? "") - Date.parse(b.expires_at ?? ""));
  }

  async listSslExpiring(days: number): Promise<Domain[]> {
    const now = Date.now();
    const horizon = now + days * 24 * 60 * 60 * 1000;
    const domains = await this.listDomains({});
    return domains
      .filter((d) => {
        if (!d.ssl_expires_at) return false;
        const exp = Date.parse(d.ssl_expires_at);
        return Number.isFinite(exp) && exp >= now && exp <= horizon;
      })
      .sort((a, b) => Date.parse(a.ssl_expires_at ?? "") - Date.parse(b.ssl_expires_at ?? ""));
  }

  async getDomainStats(): Promise<DomainStats> {
    const result = await this.client.list<never>("stats");
    return result.raw as DomainStats;
  }

  async markDomainPremium(identifier: string, premiumPrice: number, standardPrice?: number): Promise<Domain | null> {
    const domain = await this.getDomainByIdentifier(identifier);
    if (!domain) return null;
    return this.updateDomain(domain.id, {
      is_premium: true,
      premium_price: premiumPrice,
      standard_price: standardPrice ?? domain.standard_price,
      status: domain.status === "discovered" ? "premium_only" : domain.status,
    });
  }

  async updateDomainLifecycleStatus(identifier: string, status: DomainStatus, notes?: string): Promise<Domain | null> {
    const domain = await this.getDomainByIdentifier(identifier);
    if (!domain) return null;
    return this.updateDomain(domain.id, { status, notes: notes ?? domain.notes ?? undefined });
  }

  async recordDomainPurchase(identifier: string, input: RecordDomainPurchaseInput): Promise<Domain | null> {
    const domain = await this.getDomainByIdentifier(identifier);
    if (!domain) return null;
    return this.updateDomain(domain.id, {
      registrar: input.registrar,
      status: "purchased",
      purchase_price: input.price,
      purchase_date: input.purchase_date ?? new Date().toISOString(),
      expires_at: input.expires_at ?? domain.expires_at ?? undefined,
      auto_renew: input.auto_renew ?? domain.auto_renew,
      standard_price: input.standard_price ?? domain.standard_price,
      notes: input.notes ?? domain.notes ?? undefined,
    });
  }

  // ── offers ───────────────────────────────────────────────────────────────

  async createDomainOffer(input: CreateDomainOfferInput): Promise<DomainOffer> {
    const { domain_id, ...body } = input;
    return this.http.post<DomainOffer>(`/domains/${enc(domain_id)}/offers`, body);
  }

  async getDomainOffer(id: string): Promise<DomainOffer | null> {
    return this.http.get<DomainOffer | null>(`/offers/${enc(id)}`).catch(() => null);
  }

  async listDomainOffers(domainId: string): Promise<DomainOffer[]> {
    const res = await this.http.get<{ offers?: DomainOffer[] }>(`/domains/${enc(domainId)}/offers`);
    return res.offers ?? [];
  }

  // ── email links ────────────────────────────────────────────────────────────

  async linkDomainEmail(input: CreateDomainEmailLinkInput): Promise<DomainEmailLink> {
    const { domain_id, ...body } = input;
    return this.http.post<DomainEmailLink>(`/domains/${enc(domain_id)}/emails`, body);
  }

  async getDomainEmailLink(id: string): Promise<DomainEmailLink | null> {
    return this.http.get<DomainEmailLink | null>(`/emails/${enc(id)}`).catch(() => null);
  }

  async listDomainEmailLinks(domainId: string): Promise<DomainEmailLink[]> {
    const res = await this.http.get<{ emails?: DomainEmailLink[] }>(`/domains/${enc(domainId)}/emails`);
    return res.emails ?? [];
  }

  // ── dns records ────────────────────────────────────────────────────────────

  async createDnsRecord(input: CreateDnsRecordInput): Promise<DnsRecord> {
    const { domain_id, ...body } = input;
    return this.http.post<DnsRecord>(`/domains/${enc(domain_id)}/dns`, body);
  }

  async getDnsRecord(id: string): Promise<DnsRecord | null> {
    return this.client.get<DnsRecord>("dns", id);
  }

  async listDnsRecords(domainId: string, type?: DnsRecord["type"]): Promise<DnsRecord[]> {
    const res = await this.http.get<{ records?: DnsRecord[] }>(`/domains/${enc(domainId)}/dns`, { query: q({ type }) });
    return res.records ?? [];
  }

  async updateDnsRecord(id: string, input: UpdateDnsRecordInput): Promise<DnsRecord | null> {
    const existing = await this.getDnsRecord(id);
    if (!existing) return null;
    return this.client.update<DnsRecord>("dns", id, input);
  }

  async deleteDnsRecord(id: string): Promise<boolean> {
    const existing = await this.getDnsRecord(id);
    if (!existing) return false;
    await this.client.delete("dns", id);
    return true;
  }

  // ── alerts ───────────────────────────────────────────────────────────────

  async createAlert(input: CreateAlertInput): Promise<Alert> {
    const { domain_id, ...body } = input;
    return this.http.post<Alert>(`/domains/${enc(domain_id)}/alerts`, body);
  }

  async getAlert(id: string): Promise<Alert | null> {
    return this.client.get<Alert>("alerts", id);
  }

  async listAlerts(domainId: string): Promise<Alert[]> {
    const res = await this.http.get<{ alerts?: Alert[] }>(`/domains/${enc(domainId)}/alerts`);
    return res.alerts ?? [];
  }

  async deleteAlert(id: string): Promise<boolean> {
    const existing = await this.getAlert(id);
    if (!existing) return false;
    await this.client.delete("alerts", id);
    return true;
  }

  // ── owners ───────────────────────────────────────────────────────────────

  async createDomainOwner(input: CreateDomainOwnerInput): Promise<DomainOwner> {
    const { domain_id, ...body } = input;
    return this.http.post<DomainOwner>(`/domains/${enc(domain_id)}/owners`, body);
  }

  async getDomainOwner(id: string): Promise<DomainOwner | null> {
    return this.client.get<DomainOwner>("owners", id);
  }

  async getDomainOwnerByDomain(domainId: string): Promise<DomainOwner | null> {
    const res = await this.http.get<{ owners?: DomainOwner[] }>(`/domains/${enc(domainId)}/owners`);
    return res.owners?.[0] ?? null;
  }

  async getDomainOwnerByDomainName(domainName: string): Promise<DomainOwner | null> {
    const domain = await this.getDomainByName(domainName);
    if (!domain) return null;
    return this.getDomainOwnerByDomain(domain.id);
  }

  async listDomainOwners(options: { search?: string; source?: DomainOwnerSource; verified?: boolean } = {}): Promise<DomainOwner[]> {
    const res = await this.client.list<DomainOwner>("owners", {
      query: q({ search: options.search, source: options.source, verified: options.verified }),
    });
    const raw = res.raw as { owners?: DomainOwner[] } | undefined;
    return raw?.owners ?? res.items;
  }

  async updateDomainOwner(id: string, input: Partial<CreateDomainOwnerInput>): Promise<DomainOwner | null> {
    const existing = await this.getDomainOwner(id);
    if (!existing) return null;
    return this.client.update<DomainOwner>("owners", id, input);
  }

  async deleteDomainOwner(id: string): Promise<boolean> {
    const existing = await this.getDomainOwner(id);
    if (!existing) return false;
    await this.client.delete("owners", id);
    return true;
  }

  async listDomainsWithOwners(): Promise<DomainWithOwner[]> {
    const res = await this.http.get<{ domains?: DomainWithOwner[] }>(`/owners-portfolio`);
    return res.domains ?? [];
  }

  // ── history ──────────────────────────────────────────────────────────────

  async createHistoryEntry(input: CreateHistoryEntryInput): Promise<DomainHistory> {
    const { domain_id, ...body } = input;
    return this.http.post<DomainHistory>(`/domains/${enc(domain_id)}/history`, body);
  }

  async getHistoryEntry(id: string): Promise<DomainHistory | null> {
    return this.client.get<DomainHistory>("history", id);
  }

  async getHistoryByDomain(domainId: string, options?: { type?: DomainHistoryType; limit?: number }): Promise<DomainHistory[]> {
    const res = await this.http.get<{ history?: DomainHistory[] }>(`/domains/${enc(domainId)}/history`, {
      query: q({ type: options?.type, limit: options?.limit }),
    });
    return res.history ?? [];
  }

  async getLatestSnapshot(domainId: string, type: DomainHistoryType): Promise<DomainHistory | null> {
    const list = await this.getHistoryByDomain(domainId, { type, limit: 1 });
    return list[0] ?? null;
  }

  async getHistoryByDateRange(startDate: string, endDate: string, domainId?: string): Promise<DomainHistory[]> {
    const res = await this.http.get<{ history?: DomainHistory[] }>(`/history`, {
      query: q({ start: startDate, end: endDate, domain: domainId }),
    });
    return res.history ?? [];
  }

  async listDomainsWithHistoryChanges(): Promise<Array<{ domain_id: string; domain_name: string; latest_snapshot_type: string; latest_snapshot_at: string; snapshot_count: number }>> {
    const res = await this.http.get<{ domains?: Array<{ domain_id: string; domain_name: string; latest_snapshot_type: string; latest_snapshot_at: string; snapshot_count: number }> }>(`/history-changes`);
    return res.domains ?? [];
  }

  async deleteHistoryEntry(id: string): Promise<boolean> {
    const existing = await this.getHistoryEntry(id);
    if (!existing) return false;
    await this.client.delete("history", id);
    return true;
  }

  async deleteHistoryByDomain(domainId: string): Promise<boolean> {
    const res = await this.http.del<{ deleted?: boolean }>(`/domains/${enc(domainId)}/history`);
    return Boolean(res.deleted);
  }

  // ── reputation ─────────────────────────────────────────────────────────────

  async upsertDomainReputation(input: CreateReputationInput): Promise<DomainReputation> {
    const { domain_id, ...body } = input;
    return this.http.put<DomainReputation>(`/domains/${enc(domain_id)}/reputation`, body);
  }

  async getDomainReputation(domainId: string): Promise<DomainReputation | null> {
    return this.http.get<DomainReputation | null>(`/domains/${enc(domainId)}/reputation`).catch(() => null);
  }

  async getDomainReputationByName(domainName: string): Promise<DomainReputation | null> {
    const domain = await this.getDomainByName(domainName);
    if (!domain) return null;
    return this.getDomainReputation(domain.id);
  }

  async updateDomainReputation(id: string, input: Partial<CreateReputationInput>): Promise<DomainReputation | null> {
    return this.client.update<DomainReputation>("reputation", id, input);
  }

  async listBlacklistedDomains(): Promise<DomainReputation[]> {
    const res = await this.client.list<DomainReputation>("reputation", { query: { blacklisted: true } });
    const raw = res.raw as { reputation?: DomainReputation[] } | undefined;
    return raw?.reputation ?? res.items;
  }

  async listHighThreatDomains(threshold: number = 70): Promise<DomainReputation[]> {
    const res = await this.client.list<DomainReputation>("reputation", { query: { threshold } });
    const raw = res.raw as { reputation?: DomainReputation[] } | undefined;
    return raw?.reputation ?? res.items;
  }

  async deleteDomainReputation(id: string): Promise<boolean> {
    await this.client.delete("reputation", id);
    return true;
  }
}

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * Return an env in which `self_hosted` is implied when the API URL + key are
 * present but no explicit storage mode is set. Leaves an explicit mode
 * (including `local`) untouched, so the flip stays reversible. The fleet flip
 * writes only the two `HASNA_DOMAINS_API_URL` + `HASNA_DOMAINS_API_KEY` vars.
 */
export function domainsCloudEnv(env: Env = process.env): Env {
  const url = env.HASNA_DOMAINS_API_URL ?? env.DOMAINS_API_URL;
  const key = env.HASNA_DOMAINS_API_KEY ?? env.DOMAINS_API_KEY;
  const mode = env.HASNA_DOMAINS_STORAGE_MODE ?? env.HASNA_DOMAINS_MODE;
  if (url && key && !mode) {
    return { ...env, HASNA_DOMAINS_STORAGE_MODE: "self_hosted" };
  }
  return env;
}

/**
 * Resolve the active {@link DomainsStore} for the current environment. Returns an
 * {@link ApiStore} when the client-flip contract resolves to cloud-http
 * (self_hosted/cloud), else a {@link LocalStore}. Throws if cloud was requested
 * but is misconfigured (so callers can never silently read the wrong dataset).
 */
export function getStore(env: Env = process.env): DomainsStore {
  const resolved = resolveStorageClient(APP, domainsCloudEnv(env));
  return resolved.transport === "cloud-http" ? new ApiStore(resolved.client) : new LocalStore();
}

/** True when the resolved store is the cloud HTTP transport. */
export function isCloudStore(env: Env = process.env): boolean {
  return resolveStorageClient(APP, domainsCloudEnv(env)).transport === "cloud-http";
}
