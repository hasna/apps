/**
 * Routed data facade for @hasna/domains.
 *
 * Every data operation below routes through the single {@link DomainsStore}
 * resolved by {@link getStore}. Resolution FAILS CLOSED when no credential
 * resolves through the shared @hasna/contracts chain (HASNA_DOMAINS_API_KEY,
 * the Keychain, or ~/.hasna/domains/config/credentials; a key alone selects
 * the fleet gateway) and no explicit local opt-in (one of the local path
 * variables) is present — there is no silent default to the on-box sqlite.
 * ApiStore (HTTPS `/v1` + bearer key) backs the hosted transport; LocalStore
 * backs an explicitly opted-in local store. There is NO per-command local
 * fallback and NO direct sqlite access here — the transport is chosen once,
 * centrally, by the resolver, fresh per request. This is the module CLI
 * commands, MCP tools, and the SDK import; none of them touch sqlite or fetch
 * directly.
 *
 * Types and enum constants are re-exported from the underlying record modules
 * (they carry no storage behaviour). The sqlite-backed record modules
 * (domain-records, dns-records, alerts, ...) are the LocalStore backing and are
 * reached ONLY through the store, never imported directly by callers.
 */

import { getStore } from "./store.js";

// ── type + constant re-exports (no behaviour) ────────────────────────────────

export type {
  Domain,
  DomainStatus,
  CreateDomainInput,
  UpdateDomainInput,
  ListDomainsOptions,
  DomainStats,
  DomainOffer,
  CreateDomainOfferInput,
  DomainOfferStatus,
  DomainEmailLink,
  CreateDomainEmailLinkInput,
  DomainEmailType,
  DomainDetails,
  RecordDomainPurchaseInput,
} from "./domain-records.js";
export {
  DOMAIN_STATUSES,
  DOMAIN_OFFER_STATUSES,
  DOMAIN_EMAIL_TYPES,
  rowToDomain,
  rowToDomainOffer,
  rowToDomainEmailLink,
} from "./domain-records.js";

export type { DnsRecord, CreateDnsRecordInput, UpdateDnsRecordInput } from "./dns-records.js";
export { rowToDnsRecord } from "./dns-records.js";

export type { Alert, CreateAlertInput } from "./alerts.js";

export type {
  WhoisResult,
  DnsPropagationResult,
  SslCheckResult,
  ZoneImportResult,
  SubdomainResult,
  DnsValidationIssue,
  DnsValidationResult,
} from "./dns-tools.js";
export {
  whoisLookup,
  checkDnsPropagation,
  checkSsl,
  exportZoneFile,
  importZoneFile,
  discoverSubdomains,
  validateDns,
} from "./dns-tools.js";

export type { BulkCheckResult } from "./monitoring.js";
export { exportPortfolio, checkAllDomains } from "./monitoring.js";

import type {
  Domain,
  CreateDomainInput,
  UpdateDomainInput,
  ListDomainsOptions,
  DomainStats,
  DomainOffer,
  CreateDomainOfferInput,
  DomainEmailLink,
  CreateDomainEmailLinkInput,
  DomainDetails,
  RecordDomainPurchaseInput,
  DomainStatus,
} from "./domain-records.js";
import type { DnsRecord, CreateDnsRecordInput, UpdateDnsRecordInput } from "./dns-records.js";
import type { Alert, CreateAlertInput } from "./alerts.js";

// ── domains ──────────────────────────────────────────────────────────────────

export function createDomain(input: CreateDomainInput): Promise<Domain> {
  return getStore().createDomain(input);
}
export function getDomain(id: string): Promise<Domain | null> {
  return getStore().getDomain(id);
}
export function getDomainByName(name: string): Promise<Domain | null> {
  return getStore().getDomainByName(name);
}
export function getDomainByIdentifier(identifier: string): Promise<Domain | null> {
  return getStore().getDomainByIdentifier(identifier);
}
export function getDomainDetails(identifier: string): Promise<DomainDetails | null> {
  return getStore().getDomainDetails(identifier);
}
export function listDomains(options: ListDomainsOptions = {}): Promise<Domain[]> {
  return getStore().listDomains(options);
}
export function updateDomain(id: string, input: UpdateDomainInput): Promise<Domain | null> {
  return getStore().updateDomain(id, input);
}
export function deleteDomain(id: string): Promise<boolean> {
  return getStore().deleteDomain(id);
}
export function countDomains(): Promise<number> {
  return getStore().countDomains();
}
export function searchDomains(query: string): Promise<Domain[]> {
  return getStore().searchDomains(query);
}
export function getByRegistrar(registrar: string): Promise<Domain[]> {
  return getStore().getByRegistrar(registrar);
}
export function listExpiring(days: number, options?: { includeLapsed?: boolean }): Promise<Domain[]> {
  return getStore().listExpiring(days, options);
}
export function listSslExpiring(days: number, options?: { includeLapsed?: boolean }): Promise<Domain[]> {
  return getStore().listSslExpiring(days, options);
}
export function listPastExpiry(): Promise<Domain[]> {
  return getStore().listPastExpiry();
}
export function listSslPastExpiry(): Promise<Domain[]> {
  return getStore().listSslPastExpiry();
}
export function getDomainStats(): Promise<DomainStats> {
  return getStore().getDomainStats();
}
export function markDomainPremium(identifier: string, premiumPrice: number, standardPrice?: number): Promise<Domain | null> {
  return getStore().markDomainPremium(identifier, premiumPrice, standardPrice);
}
export function updateDomainLifecycleStatus(identifier: string, status: DomainStatus, notes?: string): Promise<Domain | null> {
  return getStore().updateDomainLifecycleStatus(identifier, status, notes);
}
export function recordDomainPurchase(identifier: string, input: RecordDomainPurchaseInput): Promise<Domain | null> {
  return getStore().recordDomainPurchase(identifier, input);
}

// ── offers ─────────────────────────────────────────────────────────────────

export function createDomainOffer(input: CreateDomainOfferInput): Promise<DomainOffer> {
  return getStore().createDomainOffer(input);
}
export function getDomainOffer(id: string): Promise<DomainOffer | null> {
  return getStore().getDomainOffer(id);
}
export function listDomainOffers(domainId: string): Promise<DomainOffer[]> {
  return getStore().listDomainOffers(domainId);
}

// ── email links ──────────────────────────────────────────────────────────────

export function linkDomainEmail(input: CreateDomainEmailLinkInput): Promise<DomainEmailLink> {
  return getStore().linkDomainEmail(input);
}
export function getDomainEmailLink(id: string): Promise<DomainEmailLink | null> {
  return getStore().getDomainEmailLink(id);
}
export function listDomainEmailLinks(domainId: string): Promise<DomainEmailLink[]> {
  return getStore().listDomainEmailLinks(domainId);
}

// ── dns records ──────────────────────────────────────────────────────────────

export function createDnsRecord(input: CreateDnsRecordInput): Promise<DnsRecord> {
  return getStore().createDnsRecord(input);
}
export function getDnsRecord(id: string): Promise<DnsRecord | null> {
  return getStore().getDnsRecord(id);
}
export function listDnsRecords(domainId: string, type?: DnsRecord["type"]): Promise<DnsRecord[]> {
  return getStore().listDnsRecords(domainId, type);
}
export function updateDnsRecord(id: string, input: UpdateDnsRecordInput): Promise<DnsRecord | null> {
  return getStore().updateDnsRecord(id, input);
}
export function deleteDnsRecord(id: string): Promise<boolean> {
  return getStore().deleteDnsRecord(id);
}

// ── alerts ─────────────────────────────────────────────────────────────────

export function createAlert(input: CreateAlertInput): Promise<Alert> {
  return getStore().createAlert(input);
}
export function getAlert(id: string): Promise<Alert | null> {
  return getStore().getAlert(id);
}
export function listAlerts(domainId: string): Promise<Alert[]> {
  return getStore().listAlerts(domainId);
}
export function deleteAlert(id: string): Promise<boolean> {
  return getStore().deleteAlert(id);
}
