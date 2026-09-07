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
//   • ApiStore   — the hosted HTTP API at `<origin>/v1` with a bearer key.
//     Delegates to the @hasna/contracts storage client and its transport
//     escape hatch for nested resources.
//
// `getStore()` resolves which transport to use through the ONE shared client
// resolver in @hasna/contracts (`../lib/domains-resolver.ts`) — the same five
// tiers the CLI and the SDK use, resolved FRESH on every call — plus the
// explicit local opt-in in `../lib/local-opt-in.ts`:
//
//   • explicit local path opt-in set AND the environment configures no
//     authority and no credential -> LocalStore (local mode is announced on
//     stderr, once per process);
//   • a local path set NEXT TO a configured authority/credential -> CONFLICT,
//     fail loud — configuring both a sqlite path and a hosted credential asks
//     for two different datasets and nothing here can tell which the operator
//     meant;
//   • otherwise -> the resolver decides. URL + key (env, Keychain, disk) ->
//     hosted ApiStore; a key alone defaults to the fleet gateway; and NO
//     credential at all FAILS CLOSED with an error naming the canonical env
//     pair — the default local database (~/.hasna/domains/domains.db) is never
//     opened implicitly, and no `*_MODE` / `*_STORAGE_MODE` variable selects
//     anything (those switches are stripped from the package entirely).
//
// Callers NEVER branch on a mode themselves and NEVER touch sqlite or fetch
// directly — that split-brain bug is exactly what this module eliminates.
//
// SAFETY: the API key never leaves the transport; it is never logged, returned,
// or embedded in any value produced here. Only the HTTP transport ever holds it.
// A raw DB DSN/DATABASE_URL is NEVER used on the client side.

import { resolveDomainsHttpClient, resolveDomainsTransport } from "../lib/domains-resolver.js";
import type { CredentialChainOptions, CredentialTier, HasnaStorageClient } from "../lib/client-types.js";
import { announceLocal, explicitLocalPathVar, selectsLocalStore, LOCAL_PATH_VARS } from "../lib/local-opt-in.js";

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

/**
 * The server's per-response row cap for `/v1/domains` (server/repo.ts clamps
 * `limit` to `[1, 1000]`). ApiStore paginates in units of this size so cloud
 * reads return the full result set instead of the server's default LIMIT 100.
 */
const DOMAINS_PAGE_SIZE = 1000;

// ── The single data interface ────────────────────────────────────────────────

export interface DomainsStore {
  /** Which transport backs this store (for banners/diagnostics only). */
  readonly transport: "local" | "http";

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
  /**
   * Two-sided by default: already-lapsed names PLUS those due within `days`.
   * Pass `includeLapsed: false` for the forward-only window.
   */
  listExpiring(days: number, options?: { includeLapsed?: boolean }): Promise<Domain[]>;
  listSslExpiring(days: number, options?: { includeLapsed?: boolean }): Promise<Domain[]>;
  /** Past recorded expiry while still status=active. */
  listPastExpiry(): Promise<Domain[]>;
  listSslPastExpiry(): Promise<Domain[]>;
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

// ── Compile-time regression: removed-modes transport union ────────────────────
//
// The deployment-mode vocabulary is REMOVED (owner directive 2026-07-29), and
// @hasna/contracts resolves client transports as "sqlite" | "http" — there is
// no 'cloud-http' token in the system. These assertions run in the member
// build's tsc step (hasna/apps row 0fdd8998: TS2367/TS2339 at store.ts:920/:926
// were the modes-residue failure): reintroducing 'cloud-http' into the union
// below, or widening the union with any other member, fails compilation here.

type _IsNever<T> = [T] extends [never] ? true : false;
type _RemovedModeToken = Extract<DomainsStore["transport"], "cloud-http">;
const _removedModeTokenAbsent: _IsNever<_RemovedModeToken> extends true ? true : never = true;
const _transportUnionExactlyLocalOrHttp: "local" | "http" extends DomainsStore["transport"]
  ? DomainsStore["transport"] extends "local" | "http"
    ? true
    : never
  : never = true;

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
  async listExpiring(days: number, options?: { includeLapsed?: boolean }) { return records.listExpiring(days, options); }
  async listSslExpiring(days: number, options?: { includeLapsed?: boolean }) { return records.listSslExpiring(days, options); }
  async listPastExpiry() { return records.listPastExpiry(); }
  async listSslPastExpiry() { return records.listSslPastExpiry(); }
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
  readonly transport = "http" as const;
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

  async listExpiring(days: number, options: { includeLapsed?: boolean } = {}): Promise<Domain[]> {
    // The lower bound is the whole defect: floored at `now`, this filter could
    // never return a name already over the line.
    const includeLapsed = options.includeLapsed ?? true;
    const now = Date.now();
    const horizon = now + days * 24 * 60 * 60 * 1000;
    const domains = await this.listDomains({ status: "active" });
    return domains
      .filter((d) => {
        if (!d.expires_at) return false;
        const exp = Date.parse(d.expires_at);
        if (!Number.isFinite(exp)) return false;
        if (exp > horizon) return false;
        return includeLapsed ? true : exp >= now;
      })
      .sort((a, b) => Date.parse(a.expires_at ?? "") - Date.parse(b.expires_at ?? ""));
  }

  async listSslExpiring(days: number, options: { includeLapsed?: boolean } = {}): Promise<Domain[]> {
    const includeLapsed = options.includeLapsed ?? true;
    const now = Date.now();
    const horizon = now + days * 24 * 60 * 60 * 1000;
    const domains = await this.listDomains({});
    return domains
      .filter((d) => {
        if (!d.ssl_expires_at) return false;
        const exp = Date.parse(d.ssl_expires_at);
        if (!Number.isFinite(exp)) return false;
        if (exp > horizon) return false;
        return includeLapsed ? true : exp >= now;
      })
      .sort((a, b) => Date.parse(a.ssl_expires_at ?? "") - Date.parse(b.ssl_expires_at ?? ""));
  }

  async listPastExpiry(): Promise<Domain[]> {
    const now = Date.now();
    const domains = await this.listDomains({ status: "active" });
    return domains
      .filter((d) => {
        if (!d.expires_at) return false;
        const exp = Date.parse(d.expires_at);
        return Number.isFinite(exp) && exp < now;
      })
      .sort((a, b) => Date.parse(a.expires_at ?? "") - Date.parse(b.expires_at ?? ""));
  }

  async listSslPastExpiry(): Promise<Domain[]> {
    const now = Date.now();
    const domains = await this.listDomains({});
    return domains
      .filter((d) => {
        if (!d.ssl_expires_at) return false;
        const exp = Date.parse(d.ssl_expires_at);
        return Number.isFinite(exp) && exp < now;
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

export { LOCAL_PATH_VARS, explicitLocalPathVar } from "../lib/local-opt-in.js";

/**
 * A resolved store, with the sources that decided it — never a key value, and
 * never a URL for the local transport.
 */
export interface DomainsStoreResolution {
  /** Which transport backs the store. */
  transport: "local" | "http";
  /** The local-path var that opted into LocalStore, or null for http. */
  localPathVar: string | null;
  /** For http: the `<origin>/v1` base URL the resolver produced. */
  baseUrl: string | null;
  /** WHERE the API URL came from: env key NAME, Keychain reference, file PATH, or `"default"`. */
  apiUrlSource: string | null;
  /** WHERE the API key came from: env key NAME, Keychain reference, or file PATH. Never a value. */
  apiKeySource: string | null;
  /** Which tier of the credential chain supplied the key, or null for local. */
  apiKeyTier: CredentialTier | null;
}

/** Options forwarded to the shared resolver (credential tier-1 inputs, Keychain seam). */
export interface StoreResolutionOptions {
  credentials?: CredentialChainOptions;
  /** Where the one-line local-mode notice goes. Defaults to `process.stderr`. */
  notice?: (line: string) => void;
}

/**
 * FAIL CLOSED on a contradictory store configuration.
 *
 * `HASNA_DOMAINS_DB_PATH` (and its siblings) name a SQLITE FILE. Only the
 * local transport has one. So setting such a variable while the environment
 * also configures a hosted authority or credential is not a preference to be
 * ranked — it is two mutually exclusive requests, and nothing in the
 * configuration says which the operator meant. Writing to the wrong one is
 * silent, so this is a hard boot error, never a precedence rule.
 *
 * The local opt-in applies ONLY when the environment configures nothing (see
 * `selectsLocalStore`); this error is the loud answer to every other
 * combination.
 */
function assertNoStoreConflict(env: Record<string, string | undefined>): void {
  const pathVar = explicitLocalPathVar(env);
  if (!pathVar) return;
  throw new Error(
    `Refusing to resolve the hosted domains store while ${pathVar} is set: that variable ` +
      `names a local sqlite file, so the configuration asks for BOTH stores at once and ` +
      `nothing here can tell which you meant. Local mode is an explicit opt-in that applies ` +
      `only when the environment configures no authority and no credential. Pick one: unset ` +
      `${pathVar} (and every other of ${LOCAL_PATH_VARS.join(" / ")}) to use the hosted store, or ` +
      `keep ${pathVar} and unset every authority/credential variable (HASNA_DOMAINS_API_URL, ` +
      `HASNA_DOMAINS_API_KEY, HASNA_DOMAINS_API_KEY_OVERRIDE, HASNA_DOMAINS_API_KEY_REF, ` +
      `HASNA_PROFILE — plus the Keychain item and ~/.hasna/domains/config/credentials) to use ` +
      `the local store.`,
  );
}

/**
 * Resolve the active {@link DomainsStore} for the current environment.
 *
 * FAIL CLOSED. An {@link ApiStore} resolves through the shared @hasna/contracts
 * resolver (URL + key from env, Keychain, or disk; a key alone defaults to the
 * fleet gateway). A {@link LocalStore} resolves ONLY on the explicit local
 * opt-in (one of the {@link LOCAL_PATH_VARS}) when the environment configures
 * no authority and no credential — and every local run announces itself on
 * stderr. With neither, this THROWS (the resolver's fail-closed error naming
 * the canonical env pair) — a CLI run without its fleet credential must never
 * silently serve the default local database. A local path set NEXT TO a
 * configured authority/credential is a hard conflict error. The resolver is
 * called fresh on every request (see `resolveDomainsHttpClient`), so a key
 * rotation heals a long-lived process without a rebuild.
 */
export function getStore(
  env: Record<string, string | undefined> = process.env,
  options: StoreResolutionOptions = {},
): DomainsStore {
  if (selectsLocalStore(env)) {
    announceLocal(env, options.notice);
    return new LocalStore();
  }
  assertNoStoreConflict(env);
  const wired = resolveDomainsHttpClient(env, {
    ...(options.credentials ? { credentials: options.credentials } : {}),
  });
  return new ApiStore(wired.client);
}

/**
 * Resolve the store WITHOUT constructing it — the same decision {@link
 * getStore} makes, returned as a report a diagnostic (`domains doctor`) or a
 * caller can show. Mirrors {@link getStore} exactly: an env that would make
 * {@link getStore} throw throws here too.
 */
export function getStoreResolution(
  env: Record<string, string | undefined> = process.env,
  options: StoreResolutionOptions = {},
): DomainsStoreResolution {
  if (selectsLocalStore(env)) {
    return {
      transport: "local",
      localPathVar: explicitLocalPathVar(env) ?? null,
      baseUrl: null,
      apiUrlSource: null,
      apiKeySource: null,
      apiKeyTier: null,
    };
  }
  assertNoStoreConflict(env);
  const { report } = resolveDomainsTransport(env, {
    ...(options.credentials ? { credentials: options.credentials } : {}),
  });
  return {
    transport: "http",
    localPathVar: null,
    baseUrl: report.baseUrl,
    apiUrlSource: report.apiUrlSource,
    apiKeySource: report.apiKeySource,
    apiKeyTier: report.apiKeyTier,
  };
}

/**
 * True when the resolved store is the hosted HTTP transport. Mirrors
 * {@link getStore} exactly: an env that would make {@link getStore} throw
 * (no resolvable credential AND no explicit local opt-in) throws here too — a
 * bare `false` must never be read as a licence to open the default local
 * database.
 */
export function isCloudStore(
  env: Record<string, string | undefined> = process.env,
  options: StoreResolutionOptions = {},
): boolean {
  return getStoreResolution(env, options).transport === "http";
}
