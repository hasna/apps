/**
 * Domain owner tracking — links premium/unavailable domains to their owners
 * via open-contacts integration or local owner records.
 */

import { getDatabase } from "./database.js";

export interface DomainOwner {
  id: string;
  domain_id: string;
  contact_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  owner_organization: string | null;
  source: DomainOwnerSource;
  verified: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type DomainOwnerSource = (typeof DOMAIN_OWNER_SOURCES)[number];

export const DOMAIN_OWNER_SOURCES = ["whois", "manual", "brandsight", "import"] as const;

interface DomainOwnerRow {
  id: string;
  domain_id: string;
  contact_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  owner_organization: string | null;
  source: string;
  verified: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDomainOwner(row: DomainOwnerRow): DomainOwner {
  return {
    ...row,
    source: row.source as DomainOwnerSource,
    verified: row.verified === 1,
  };
}

export interface CreateDomainOwnerInput {
  domain_id: string;
  contact_id?: string;
  owner_name?: string;
  owner_email?: string;
  owner_phone?: string;
  owner_organization?: string;
  source?: DomainOwnerSource;
  verified?: boolean;
  notes?: string;
}

export function createDomainOwner(input: CreateDomainOwnerInput): DomainOwner {
  const db = getDatabase();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO domain_owners (id, domain_id, contact_id, owner_name, owner_email, owner_phone, owner_organization, source, verified, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.domain_id,
    input.contact_id ?? null,
    input.owner_name ?? null,
    input.owner_email ?? null,
    input.owner_phone ?? null,
    input.owner_organization ?? null,
    input.source ?? "manual",
    input.verified ? 1 : 0,
    input.notes ?? null
  );

  return getDomainOwner(id)!;
}

export function getDomainOwner(id: string): DomainOwner | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM domain_owners WHERE id = ?").get(id) as DomainOwnerRow | null;
  return row ? rowToDomainOwner(row) : null;
}

export function getDomainOwnerByDomain(domainId: string): DomainOwner | null {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM domain_owners WHERE domain_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(domainId) as DomainOwnerRow | null;
  return row ? rowToDomainOwner(row) : null;
}

export function getDomainOwnerByDomainName(domainName: string): DomainOwner | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT o.* FROM domain_owners o
    JOIN domains d ON d.id = o.domain_id
    WHERE d.name = ?
    ORDER BY o.created_at DESC LIMIT 1
  `).get(domainName) as DomainOwnerRow | null;
  return row ? rowToDomainOwner(row) : null;
}

export function listDomainOwners(options: { search?: string; source?: DomainOwnerSource; verified?: boolean } = {}): DomainOwner[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.search) {
    conditions.push("(owner_name LIKE ? OR owner_email LIKE ? OR owner_organization LIKE ? OR notes LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q, q);
  }
  if (options.source) {
    conditions.push("source = ?");
    params.push(options.source);
  }
  if (options.verified !== undefined) {
    conditions.push("verified = ?");
    params.push(options.verified ? 1 : 0);
  }

  let sql = "SELECT * FROM domain_owners";
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY created_at DESC";

  const rows = db.prepare(sql).all(...params) as DomainOwnerRow[];
  return rows.map(rowToDomainOwner);
}

export function updateDomainOwner(id: string, input: Partial<CreateDomainOwnerInput>): DomainOwner | null {
  const db = getDatabase();
  const existing = getDomainOwner(id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: (string | number)[] = [];

  if (input.contact_id !== undefined) { sets.push("contact_id = ?"); params.push(input.contact_id); }
  if (input.owner_name !== undefined) { sets.push("owner_name = ?"); params.push(input.owner_name); }
  if (input.owner_email !== undefined) { sets.push("owner_email = ?"); params.push(input.owner_email); }
  if (input.owner_phone !== undefined) { sets.push("owner_phone = ?"); params.push(input.owner_phone); }
  if (input.owner_organization !== undefined) { sets.push("owner_organization = ?"); params.push(input.owner_organization); }
  if (input.verified !== undefined) { sets.push("verified = ?"); params.push(input.verified ? 1 : 0); }
  if (input.notes !== undefined) { sets.push("notes = ?"); params.push(input.notes); }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE domain_owners SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getDomainOwner(id);
}

export function deleteDomainOwner(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM domain_owners WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Extract owner info from WHOIS data (RDAP JSON or CLI raw text) and create/update a domain owner record.
 */
export function parseWhoisOwner(whoisData: string): {
  name: string | null;
  email: string | null;
  phone: string | null;
  organization: string | null;
} | null {
  let name: string | null = null;
  let email: string | null = null;
  let phone: string | null = null;
  let org: string | null = null;

  // Try parsing as RDAP JSON first
  if (whoisData.trim().startsWith("{")) {
    try {
      const rdap = JSON.parse(whoisData) as Record<string, unknown>;
      const registrant = extractRegistrantFromRdapEntities(rdap);
      name = registrant.name;
      email = registrant.email;
      phone = registrant.phone;
      org = registrant.organization;
    } catch {
      // Not valid JSON, fall through to CLI parsing
    }
  }

  // Fall back to CLI WHOIS regex parsing
  if (!name && !email && !org) {
    const nameMatch = whoisData.match(/Registrant Name:\s*(.+)/i);
    const emailMatch = whoisData.match(/Registrant Email:\s*(.+)/i);
    const phoneMatch = whoisData.match(/Registrant Phone:\s*(.+)/i);
    const orgMatch = whoisData.match(/Registrant Organization:\s*(.+)/i);

    name = nameMatch?.[1]?.trim() ?? null;
    email = emailMatch?.[1]?.trim() ?? null;
    phone = phoneMatch?.[1]?.trim() ?? null;
    org = orgMatch?.[1]?.trim() ?? null;
  }

  if (!name && !email && !org) return null;
  return { name, email, phone, organization: org };
}

/**
 * Extract registrant info from RDAP entities.
 * Mirrors the logic in dns-tools.ts but works on parsed JSON strings.
 */
function extractRegistrantFromRdapEntities(rdap: Record<string, unknown>): {
  name: string | null;
  email: string | null;
  phone: string | null;
  organization: string | null;
} {
  const result = { name: null as string | null, email: null as string | null, phone: null as string | null, organization: null as string | null };

  const entities = rdap.entities as RdapEntity[] | undefined;
  if (!entities) return result;

  const findRegistrant = (ents: RdapEntity[]): RdapEntity | null => {
    for (const entity of ents) {
      if (entity.roles?.some((r) => r === "registrant")) return entity;
      if (entity.entities) {
        const found = findRegistrant(entity.entities);
        if (found) return found;
      }
    }
    return null;
  };

  const registrant = findRegistrant(entities);
  if (!registrant?.vcardArray) return result;

  const vcard = registrant.vcardArray[1] as unknown[] | undefined;
  if (!vcard || !Array.isArray(vcard)) return result;

  for (const entry of vcard) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const [prop, _params, type] = entry;

    if (prop === "fn") result.name = type ?? null;
    else if (prop === "email") result.email = type ?? null;
    else if (prop === "tel") result.phone = type ?? null;
    else if (prop === "org") {
      result.organization = Array.isArray(type) ? type[0] ?? null : type ?? null;
    }
    else if (prop === "n" && !result.name) {
      const parts = Array.isArray(type) ? type.filter(Boolean) : [type];
      result.name = parts.reverse().join(" ").trim() || null;
    }
  }

  if (!result.name && registrant.handle) {
    result.name = registrant.handle;
  }

  return result;
}

interface RdapEntity {
  handle?: string;
  vcardArray?: [string, unknown[]];
  roles?: string[];
  entities?: RdapEntity[];
}

export interface DomainWithOwner {
  domain_name: string;
  domain_status: string;
  is_premium: boolean;
  premium_price: number | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_organization: string | null;
  contact_id: string | null;
  source: DomainOwnerSource | null;
  verified: boolean;
}

export function listDomainsWithOwners(): DomainWithOwner[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT d.name as domain_name, d.status as domain_status, d.is_premium,
           d.premium_price,
           o.owner_name, o.owner_email, o.owner_organization, o.contact_id,
           o.source, o.verified
    FROM domains d
    LEFT JOIN domain_owners o ON d.id = o.domain_id
    WHERE o.id IS NOT NULL
       OR d.is_premium = 1
       OR d.status IN ('premium_only', 'not_available', 'negotiating', 'offered', 'researching')
    ORDER BY d.name
  `).all() as (DomainWithOwner & { source: string | null })[];

  return rows.map((r) => ({
    ...r,
    source: r.source as DomainOwnerSource | null,
  }));
}
