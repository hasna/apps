import { Database } from "bun:sqlite";
import { getDatabase, uuid, now } from "../db/database.js";

export interface FreshnessResult {
  contact_id: string;
  score: number;
  breakdown: Record<string, { confidence: string; last_verified?: string; days_ago?: number }>;
  needs_enrichment: boolean;
}

export function getFreshnessScore(contactId: string, db?: Database): FreshnessResult {
  const _db = db || getDatabase();
  const contact = _db.query(`SELECT * FROM contacts WHERE id=?`).get(contactId) as Record<
    string,
    unknown
  > | null;
  const emails = _db
    .query(`SELECT COUNT(*) c FROM emails WHERE contact_id=?`)
    .get(contactId) as { c: number };
  const phones = _db
    .query(`SELECT COUNT(*) c FROM phones WHERE contact_id=?`)
    .get(contactId) as { c: number };
  const confs = _db
    .query(`SELECT * FROM contact_field_confidence WHERE contact_id=?`)
    .all(contactId) as Array<{
    field_name: string;
    confidence: string;
    last_verified_at: string;
  }>;
  const confMap = Object.fromEntries(confs.map((c) => [c.field_name, c]));
  let score = 0;
  const breakdown: FreshnessResult["breakdown"] = {};
  if (emails.c > 0) {
    score += 30;
    breakdown["email"] = {
      confidence: confMap["email"]?.confidence || "imported",
      last_verified: confMap["email"]?.last_verified_at,
    };
  }
  if (phones.c > 0) {
    score += 20;
    breakdown["phone"] = { confidence: confMap["phone"]?.confidence || "imported" };
  }
  if (contact?.["company_id"]) {
    score += 20;
    breakdown["company"] = { confidence: confMap["company_id"]?.confidence || "imported" };
  }
  if (contact?.["last_contacted_at"]) {
    const days = Math.floor(
      (Date.now() - new Date(contact["last_contacted_at"] as string).getTime()) / 86400000,
    );
    score += days < 30 ? 15 : days < 90 ? 8 : 0;
    breakdown["last_contacted"] = {
      confidence: days < 90 ? "verified" : "stale",
      days_ago: days,
    };
  }
  if (contact?.["job_title"]) {
    score += 15;
    breakdown["job_title"] = { confidence: confMap["job_title"]?.confidence || "imported" };
  }
  return { contact_id: contactId, score, breakdown, needs_enrichment: score < 40 };
}

export function getStaleContacts(
  _threshold = 40,
  db?: Database,
): Array<{ id: string; display_name: string; score: number }> {
  const _db = db || getDatabase();
  // Rough stale check: no email OR no last_contacted_at OR last contacted >90 days
  const d90 = new Date(Date.now() - 90 * 86400000).toISOString();
  return (
    _db
      .query(
        `SELECT c.id, c.display_name FROM contacts c LEFT JOIN emails e ON c.id=e.contact_id WHERE c.archived=0 AND (e.id IS NULL OR c.last_contacted_at IS NULL OR c.last_contacted_at < ?) GROUP BY c.id ORDER BY c.last_contacted_at ASC LIMIT 50`,
      )
      .all(d90) as Array<{ id: string; display_name: string }>
  ).map((r) => ({ ...r, score: 30 }));
}

export function markFieldVerified(
  contactId: string,
  fieldName: string,
  source: string,
  db?: Database,
): void {
  const _db = db || getDatabase();
  _db
    .query(
      `INSERT OR REPLACE INTO contact_field_confidence(id,contact_id,field_name,confidence,source,last_verified_at) VALUES(?,?,?,'verified',?,?)`,
    )
    .run(uuid(), contactId, fieldName, source, now());
}
