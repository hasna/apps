import type { ContactsDatabase } from "./database.js";
import { getDatabase, uuid, now } from "./database.js";

export interface ContactIdentity {
  id: string;
  contact_id: string;
  system: string;
  external_id: string;
  external_url?: string | null;
  confidence: "verified" | "inferred";
  created_at: string;
}

export interface IdentityMatch {
  contact: { id: string; display_name: string; job_title?: string };
  confidence_score: number;
  match_reasons: string[];
}

export function addIdentity(
  contactId: string,
  system: string,
  externalId: string,
  externalUrl?: string,
  confidence: "verified" | "inferred" = "inferred",
  db?: ContactsDatabase,
): ContactIdentity {
  const _db = db || getDatabase();
  const id = uuid();
  _db
    .query(
      `INSERT OR REPLACE INTO contact_identities(id,contact_id,system,external_id,external_url,confidence,created_at) VALUES(?,?,?,?,?,?,?)`,
    )
    .run(id, contactId, system, externalId, externalUrl || null, confidence, now());
  return _db.query(`SELECT * FROM contact_identities WHERE id=?`).get(id) as ContactIdentity;
}

export function resolveIdentity(
  system: string,
  externalId: string,
  db?: ContactsDatabase,
): { id: string; display_name: string } | null {
  const _db = db || getDatabase();
  const row = _db
    .query(
      `SELECT c.id, c.display_name FROM contacts c JOIN contact_identities ci ON c.id=ci.contact_id WHERE ci.system=? AND ci.external_id=?`,
    )
    .get(system, externalId) as { id: string; display_name: string } | null;
  return row || null;
}

export function resolveByPartial(
  partial: { name?: string; email?: string; phone?: string; linkedin_url?: string },
  db?: ContactsDatabase,
): IdentityMatch[] {
  const _db = db || getDatabase();
  const matches: Map<string, IdentityMatch> = new Map();
  const addMatch = (
    id: string,
    name: string,
    title: string | undefined,
    score: number,
    reason: string,
  ) => {
    const existing = matches.get(id);
    if (existing) {
      existing.confidence_score = Math.min(100, existing.confidence_score + score);
      existing.match_reasons.push(reason);
    } else {
      matches.set(id, {
        contact: { id, display_name: name, job_title: title },
        confidence_score: score,
        match_reasons: [reason],
      });
    }
  };
  if (partial.email) {
    const rows = _db
      .query(
        `SELECT c.id, c.display_name, c.job_title FROM contacts c JOIN emails e ON c.id=e.contact_id WHERE LOWER(e.address)=LOWER(?)`,
      )
      .all(partial.email) as Array<{ id: string; display_name: string; job_title?: string }>;
    rows.forEach((r) => addMatch(r.id, r.display_name, r.job_title, 90, `email match: ${partial.email}`));
  }
  if (partial.linkedin_url) {
    const rows = _db
      .query(
        `SELECT c.id, c.display_name, c.job_title FROM contacts c JOIN social_profiles sp ON c.id=sp.contact_id WHERE sp.platform='linkedin' AND sp.url LIKE ?`,
      )
      .all(`%${partial.linkedin_url.split("/").pop()}%`) as Array<{
      id: string;
      display_name: string;
      job_title?: string;
    }>;
    rows.forEach((r) => addMatch(r.id, r.display_name, r.job_title, 85, `linkedin match`));
  }
  if (partial.name) {
    const rows = _db
      .query(
        `SELECT id, display_name, job_title FROM contacts WHERE display_name LIKE ? AND archived=0 LIMIT 10`,
      )
      .all(`%${partial.name}%`) as Array<{
      id: string;
      display_name: string;
      job_title?: string;
    }>;
    rows.forEach((r) => addMatch(r.id, r.display_name, r.job_title, 40, `name match: ${partial.name}`));
  }
  return Array.from(matches.values()).sort((a, b) => b.confidence_score - a.confidence_score);
}

export function getIdentities(contactId: string, db?: ContactsDatabase): ContactIdentity[] {
  const _db = db || getDatabase();
  return _db
    .query(`SELECT * FROM contact_identities WHERE contact_id=? ORDER BY created_at DESC`)
    .all(contactId) as ContactIdentity[];
}
