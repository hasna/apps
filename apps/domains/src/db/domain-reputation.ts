/**
 * Domain Reputation — tracks blacklist status, threat scores, and
 * security reputation for domains.
 */

import { getDatabase } from "./database.js";
import { getDomainByIdentifier } from "./domain-records.js";

export interface DomainReputation {
  id: string;
  domain_id: string;
  is_blacklisted: boolean;
  blacklist_sources: string[];
  threat_score: number | null;
  spam_score: number | null;
  malware_detected: boolean;
  phishing_detected: boolean;
  reputation_sources: string[];
  last_checked_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface DomainReputationRow {
  id: string;
  domain_id: string;
  is_blacklisted: number;
  blacklist_sources: string;
  threat_score: number | null;
  spam_score: number | null;
  malware_detected: number;
  phishing_detected: number;
  reputation_sources: string;
  last_checked_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDomainReputation(row: DomainReputationRow): DomainReputation {
  return {
    ...row,
    is_blacklisted: row.is_blacklisted === 1,
    blacklist_sources: JSON.parse(row.blacklist_sources),
    malware_detected: row.malware_detected === 1,
    phishing_detected: row.phishing_detected === 1,
    reputation_sources: JSON.parse(row.reputation_sources),
  };
}

export interface CreateReputationInput {
  domain_id: string;
  is_blacklisted?: boolean;
  blacklist_sources?: string[];
  threat_score?: number;
  spam_score?: number;
  malware_detected?: boolean;
  phishing_detected?: boolean;
  reputation_sources?: string[];
  last_checked_at?: string;
  notes?: string;
}

/**
 * Create or update a reputation record for a domain.
 */
export function upsertDomainReputation(
  input: CreateReputationInput
): DomainReputation {
  const db = getDatabase();
  const existing = getDomainReputation(input.domain_id);

  if (existing) {
    return updateDomainReputation(existing.id, input)!;
  }

  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO domain_reputation (id, domain_id, is_blacklisted, blacklist_sources, threat_score, spam_score, malware_detected, phishing_detected, reputation_sources, last_checked_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.domain_id,
    input.is_blacklisted ? 1 : 0,
    JSON.stringify(input.blacklist_sources ?? []),
    input.threat_score ?? null,
    input.spam_score ?? null,
    input.malware_detected ? 1 : 0,
    input.phishing_detected ? 1 : 0,
    JSON.stringify(input.reputation_sources ?? []),
    input.last_checked_at ?? null,
    input.notes ?? null
  );

  return getDomainReputation(input.domain_id)!;
}

/**
 * Get reputation for a domain.
 */
export function getDomainReputation(
  domainId: string
): DomainReputation | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM domain_reputation WHERE domain_id = ?")
    .get(domainId) as DomainReputationRow | null;
  return row ? rowToDomainReputation(row) : null;
}

/**
 * Get reputation by domain name.
 */
export function getDomainReputationByName(
  domainName: string
): DomainReputation | null {
  const domain = getDomainByIdentifier(domainName);
  if (!domain) return null;
  return getDomainReputation(domain.id);
}

/**
 * Update reputation record.
 */
export function updateDomainReputation(
  id: string,
  input: Partial<CreateReputationInput>
): DomainReputation | null {
  const db = getDatabase();
  const existingRow = db
    .prepare("SELECT * FROM domain_reputation WHERE id = ?")
    .get(id) as DomainReputationRow | null;
  if (!existingRow) return null;

  const sets: string[] = [];
  const params: (string | number)[] = [];

  if (input.is_blacklisted !== undefined) {
    sets.push("is_blacklisted = ?");
    params.push(input.is_blacklisted ? 1 : 0);
  }
  if (input.blacklist_sources !== undefined) {
    sets.push("blacklist_sources = ?");
    params.push(JSON.stringify(input.blacklist_sources));
  }
  if (input.threat_score !== undefined) {
    sets.push("threat_score = ?");
    params.push(input.threat_score);
  }
  if (input.spam_score !== undefined) {
    sets.push("spam_score = ?");
    params.push(input.spam_score);
  }
  if (input.malware_detected !== undefined) {
    sets.push("malware_detected = ?");
    params.push(input.malware_detected ? 1 : 0);
  }
  if (input.phishing_detected !== undefined) {
    sets.push("phishing_detected = ?");
    params.push(input.phishing_detected ? 1 : 0);
  }
  if (input.reputation_sources !== undefined) {
    sets.push("reputation_sources = ?");
    params.push(JSON.stringify(input.reputation_sources));
  }
  if (input.last_checked_at !== undefined) {
    sets.push("last_checked_at = ?");
    params.push(input.last_checked_at);
  }
  if (input.notes !== undefined) {
    sets.push("notes = ?");
    params.push(input.notes);
  }

  if (sets.length === 0) return rowToDomainReputation(existingRow);

  sets.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(
    `UPDATE domain_reputation SET ${sets.join(", ")} WHERE id = ?`
  ).run(...params);
  return getDomainReputation(existingRow.domain_id);
}

/**
 * List all blacklisted domains.
 */
export function listBlacklistedDomains(): DomainReputation[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      "SELECT * FROM domain_reputation WHERE is_blacklisted = 1 ORDER BY updated_at DESC"
    )
    .all() as DomainReputationRow[];
  return rows.map(rowToDomainReputation);
}

/**
 * List domains with threat score above a threshold.
 */
export function listHighThreatDomains(threshold: number = 70): DomainReputation[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      "SELECT * FROM domain_reputation WHERE threat_score >= ? ORDER BY threat_score DESC"
    )
    .all(threshold) as DomainReputationRow[];
  return rows.map(rowToDomainReputation);
}

/**
 * Check domain against common DNS-based blacklists (DNSBL zones).
 * Returns a list of zones where the domain is listed.
 */
export function checkDnsBlacklist(
  domainName: string
): { listed: boolean; zones: string[]; details: string[] } {
  const result = { listed: false, zones: [] as string[], details: [] as string[] };

  // Common DNSBL zones to check
  const zones = [
    "zen.spamhaus.org",
    "bl.spamcop.net",
    "dnsbl.sorbs.net",
    "b.barracudacentral.org",
  ];

  // In production, we'd resolve domain IP then check IP.zone via DNS.
  // For now, return empty — actual checks require DNS resolution.
  return result;
}

/**
 * Delete reputation record.
 */
export function deleteDomainReputation(id: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare("DELETE FROM domain_reputation WHERE id = ?")
    .run(id);
  return result.changes > 0;
}
