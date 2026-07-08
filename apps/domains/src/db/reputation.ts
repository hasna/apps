/**
 * Routed domain-reputation facade. All reads/writes go through the resolved
 * {@link DomainsStore}; the sqlite-backed `domain-reputation` module is only
 * reached via LocalStore. Blacklist probing (`checkDnsBlacklist`) is a pure
 * operation re-exported from the backing module.
 */

import { getStore } from "./store.js";
import { checkDnsBlacklist } from "./domain-reputation.js";

export type { DomainReputation, CreateReputationInput } from "./domain-reputation.js";
export { checkDnsBlacklist } from "./domain-reputation.js";

import type { DomainReputation, CreateReputationInput } from "./domain-reputation.js";

export function upsertDomainReputation(input: CreateReputationInput): Promise<DomainReputation> {
  return getStore().upsertDomainReputation(input);
}
export function getDomainReputation(domainId: string): Promise<DomainReputation | null> {
  return getStore().getDomainReputation(domainId);
}
export function getDomainReputationByName(domainName: string): Promise<DomainReputation | null> {
  return getStore().getDomainReputationByName(domainName);
}
export function updateDomainReputation(id: string, input: Partial<CreateReputationInput>): Promise<DomainReputation | null> {
  return getStore().updateDomainReputation(id, input);
}
export function listBlacklistedDomains(): Promise<DomainReputation[]> {
  return getStore().listBlacklistedDomains();
}
export function listHighThreatDomains(threshold?: number): Promise<DomainReputation[]> {
  return getStore().listHighThreatDomains(threshold);
}
export function deleteDomainReputation(id: string): Promise<boolean> {
  return getStore().deleteDomainReputation(id);
}

/**
 * Run a full reputation check on a domain and save the results, routing every
 * read/write through the resolved store.
 */
export async function checkDomainReputation(domainName: string): Promise<{
  reputation: DomainReputation | null;
  dnsBlacklist: { listed: boolean; zones: string[] };
}> {
  const store = getStore();
  const domain = await store.getDomainByIdentifier(domainName);
  if (!domain) throw new Error(`Domain '${domainName}' not found in database`);

  const dnsBlacklist = checkDnsBlacklist(domainName);

  const existing = await store.getDomainReputation(domain.id);
  if (existing) {
    await store.updateDomainReputation(existing.id, { last_checked_at: new Date().toISOString() });
  }

  await store.createHistoryEntry({
    domain_id: domain.id,
    snapshot_type: "reputation",
    raw_data: { dns_blacklist: dnsBlacklist },
    notes: dnsBlacklist.listed
      ? `Listed in: ${dnsBlacklist.zones.join(", ")}`
      : "Clean — no blacklist hits",
  });

  return { reputation: existing, dnsBlacklist };
}
