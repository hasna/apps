/**
 * Routed domain-history facade. All reads/writes go through the resolved
 * {@link DomainsStore} (always ApiStore for clients); the sqlite-backed
 * `domain-history` module is only reached from the LocalStore fixture.
 *
 * `HISTORY_TYPES` is imported STATICALLY so the bundler can tree-shake the
 * sqlite functions out of the client bundles; a dynamic
 * `import("./domain-history.js")` materialises the namespace and drags
 * `bun:sqlite` into dist/cli.
 */

import { getStore } from "./store.js";
import { HISTORY_TYPES } from "./domain-history.js";

export type {
  DomainHistory,
  DomainHistoryType,
  CreateHistoryEntryInput,
} from "./domain-history.js";
export { HISTORY_TYPES } from "./domain-history.js";

import type {
  DomainHistory,
  DomainHistoryType,
  CreateHistoryEntryInput,
} from "./domain-history.js";

export function createHistoryEntry(input: CreateHistoryEntryInput): Promise<DomainHistory> {
  return getStore().createHistoryEntry(input);
}
export function getHistoryEntry(id: string): Promise<DomainHistory | null> {
  return getStore().getHistoryEntry(id);
}
export function getHistoryByDomain(domainId: string, options?: { type?: DomainHistoryType; limit?: number }): Promise<DomainHistory[]> {
  return getStore().getHistoryByDomain(domainId, options);
}
export function getLatestSnapshot(domainId: string, type: DomainHistoryType): Promise<DomainHistory | null> {
  return getStore().getLatestSnapshot(domainId, type);
}
export function getHistoryByDateRange(startDate: string, endDate: string, domainId?: string): Promise<DomainHistory[]> {
  return getStore().getHistoryByDateRange(startDate, endDate, domainId);
}
export function listDomainsWithHistoryChanges(): Promise<Array<{ domain_id: string; domain_name: string; latest_snapshot_type: string; latest_snapshot_at: string; snapshot_count: number }>> {
  return getStore().listDomainsWithHistoryChanges();
}
export async function getLatestByDomainName(domainName: string, type?: DomainHistoryType): Promise<DomainHistory | null> {
  const store = getStore();
  const domain = await store.getDomainByIdentifier(domainName);
  if (!domain) return null;
  return store.getLatestSnapshot(domain.id, type ?? (HISTORY_TYPES[0] as DomainHistoryType));
}
export function deleteHistoryEntry(id: string): Promise<boolean> {
  return getStore().deleteHistoryEntry(id);
}
export function deleteHistoryByDomain(domainId: string): Promise<boolean> {
  return getStore().deleteHistoryByDomain(domainId);
}
