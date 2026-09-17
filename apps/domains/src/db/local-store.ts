/**
 * LocalStore — the sqlite-backed {@link DomainsStore} implementation.
 *
 * FAIL-CLOSED BOUNDARY (hasna/apps fleet-alignment, ruling (d)). `getStore()`
 * never selects this class: `domains` has no local client mode by design and
 * the legacy local-path variables are REFUSED by
 * `lib/client-storage-policy.ts`. LocalStore exists only for explicit sqlite
 * migration/unit fixtures (`src/test/local-store-fixture.test-support.ts`).
 *
 * It lives in its own module, deliberately NOT in `db/store.ts`, so that
 * `bun:sqlite` is unreachable from the CLI, MCP and SDK entrypoints even when
 * a caller pulls the store module through a dynamic `import()` (which defeats
 * per-export tree-shaking by materialising the whole module namespace — that
 * is exactly how `db/database.ts` used to land in `dist/cli/index.js`). Import
 * this module only from tests/fixtures or server-side tooling; importing it
 * from anything reachable by `src/cli/index.ts` or `src/mcp/index.ts` will
 * fail the `no-sqlite-in-client-bundles` ratchet test.
 */

import type { DomainsStore } from "./store.js";

import * as records from "./domain-records.js";
import * as dns from "./dns-records.js";
import * as alertsDb from "./alerts.js";
import * as owners from "./domain-owners.js";
import * as history from "./domain-history.js";
import * as reputation from "./domain-reputation.js";

import type {
  CreateDomainInput,
  DomainStatus,
  ListDomainsOptions,
  RecordDomainPurchaseInput,
  UpdateDomainInput,
  CreateDomainOfferInput,
  CreateDomainEmailLinkInput,
} from "./domain-records.js";
import type {
  DnsRecord,
  CreateDnsRecordInput,
  UpdateDnsRecordInput,
} from "./dns-records.js";
import type { CreateAlertInput } from "./alerts.js";
import type {
  CreateDomainOwnerInput,
  DomainOwnerSource,
} from "./domain-owners.js";
import type {
  CreateHistoryEntryInput,
  DomainHistoryType,
} from "./domain-history.js";
import type { CreateReputationInput } from "./domain-reputation.js";

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
