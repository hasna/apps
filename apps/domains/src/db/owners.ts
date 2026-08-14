/**
 * Routed domain-owner facade. Every operation goes through the single
 * {@link DomainsStore} resolved by {@link getStore} (LocalStore or ApiStore),
 * so owner reads/writes hit the same dataset the rest of the app uses. No direct
 * sqlite access here; the sqlite-backed `domain-owners` module is only reached
 * via the store's LocalStore transport.
 */

import { getStore } from "./store.js";
import { parseWhoisOwner } from "./domain-owners.js";

export type {
  DomainOwner,
  DomainOwnerSource,
  CreateDomainOwnerInput,
  DomainWithOwner,
} from "./domain-owners.js";
export { DOMAIN_OWNER_SOURCES } from "./domain-owners.js";

import type {
  DomainOwner,
  DomainOwnerSource,
  CreateDomainOwnerInput,
  DomainWithOwner,
} from "./domain-owners.js";

export function createDomainOwner(input: CreateDomainOwnerInput): Promise<DomainOwner> {
  return getStore().createDomainOwner(input);
}
export function getDomainOwner(id: string): Promise<DomainOwner | null> {
  return getStore().getDomainOwner(id);
}
export function getDomainOwnerByDomain(domainId: string): Promise<DomainOwner | null> {
  return getStore().getDomainOwnerByDomain(domainId);
}
export function getDomainOwnerByDomainName(domainName: string): Promise<DomainOwner | null> {
  return getStore().getDomainOwnerByDomainName(domainName);
}
export function listDomainOwners(options: { search?: string; source?: DomainOwnerSource; verified?: boolean } = {}): Promise<DomainOwner[]> {
  return getStore().listDomainOwners(options);
}
export function updateDomainOwner(id: string, input: Partial<CreateDomainOwnerInput>): Promise<DomainOwner | null> {
  return getStore().updateDomainOwner(id, input);
}
export function deleteDomainOwner(id: string): Promise<boolean> {
  return getStore().deleteDomainOwner(id);
}
export function listDomainsWithOwners(): Promise<DomainWithOwner[]> {
  return getStore().listDomainsWithOwners();
}

/**
 * Extract owner info from WHOIS/RDAP data and create/update the domain's owner
 * record through the resolved store.
 */
export async function extractOwnerFromWhois(domainName: string, whoisData: string): Promise<DomainOwner | null> {
  const store = getStore();
  const domain = await store.getDomainByIdentifier(domainName);
  if (!domain) return null;
  const parsed = parseWhoisOwner(whoisData);
  if (!parsed) return null;

  const existing = await store.getDomainOwnerByDomain(domain.id);
  if (existing) {
    return store.updateDomainOwner(existing.id, {
      owner_name: parsed.name ?? existing.owner_name ?? undefined,
      owner_email: parsed.email ?? existing.owner_email ?? undefined,
      owner_phone: parsed.phone ?? existing.owner_phone ?? undefined,
      owner_organization: parsed.organization ?? existing.owner_organization ?? undefined,
      source: "whois",
    });
  }
  return store.createDomainOwner({
    domain_id: domain.id,
    owner_name: parsed.name ?? undefined,
    owner_email: parsed.email ?? undefined,
    owner_phone: parsed.phone ?? undefined,
    owner_organization: parsed.organization ?? undefined,
    source: "whois",
  });
}

/**
 * Create a contact in open-contacts for a domain owner and link them, routing
 * owner reads/writes through the store.
 */
export async function linkOwnerToContacts(
  domainId: string,
  contactsDbFns: {
    createContact: (input: { first_name: string; last_name?: string; email?: string; phone?: string; job_title?: string; source: string; notes?: string }) => { id: string };
    getContactByEmail: (email: string) => { id: string } | null;
  },
): Promise<string | null> {
  const store = getStore();
  const owner = await store.getDomainOwnerByDomain(domainId);
  if (!owner || !owner.owner_email) return null;

  const existing = contactsDbFns.getContactByEmail(owner.owner_email);
  if (existing) {
    await store.updateDomainOwner(owner.id, { contact_id: existing.id });
    return existing.id;
  }

  const parts = (owner.owner_name || owner.owner_email.split("@")[0] || "Unknown").split(" ");
  const first_name = parts[0] ?? "Unknown";
  const last_name = parts.length > 1 ? parts.slice(1).join(" ") : undefined;
  const notes = owner.owner_organization
    ? `Owner of domain via ${owner.owner_organization}`
    : `Domain owner (linked from open-domains)`;

  const contact = contactsDbFns.createContact({
    first_name,
    last_name,
    email: owner.owner_email,
    phone: owner.owner_phone ?? undefined,
    source: "manual",
    notes,
  });

  await store.updateDomainOwner(owner.id, { contact_id: contact.id });
  return contact.id;
}
