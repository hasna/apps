import { Database } from "bun:sqlite";
import { getDatabase, now } from "./database.js";

export interface FieldFreshness {
  field_name: string;
  value: string | null;
  last_verified_at: string | null;
  source: string | null;
  confidence: "verified" | "inferred" | "imported" | "stale" | "unknown";
  days_old: number | null;
}

export interface FreshnessScore {
  contact_id: string;
  overall_score: number;
  fields: FieldFreshness[];
  stale_fields: string[];
  verified_fields: string[];
}

const SCORED_FIELDS = ["display_name", "job_title", "company_id", "emails", "phones", "last_contacted_at"] as const;

export function getFreshnessScore(contactId: string, db?: Database): FreshnessScore {
  const _db = db || getDatabase();
  const contact = _db
    .query(`SELECT * FROM contacts WHERE id=?`)
    .get(contactId) as Record<string, unknown> | null;
  if (!contact) throw new Error(`Contact not found: ${contactId}`);

  // Try to get field history for per-field confidence
  let historyRows: Array<{ field_name: string; new_value: string | null; source: string | null; created_at: string }> = [];
  try {
    historyRows = _db
      .query(
        `SELECT field_name, new_value, source, created_at FROM contact_field_history WHERE contact_id=? ORDER BY created_at DESC`,
      )
      .all(contactId) as typeof historyRows;
  } catch { /* table may not exist yet */ }

  // Get field verification records
  let verifiedRows: Array<{ field_name: string; verified_at: string; source: string | null }> = [];
  try {
    verifiedRows = _db
      .query(`SELECT field_name, verified_at, source FROM field_verifications WHERE contact_id=?`)
      .all(contactId) as typeof verifiedRows;
  } catch { /* table may not exist yet */ }

  const verifiedMap = new Map(verifiedRows.map(r => [r.field_name, r]));
  const historyMap = new Map<string, (typeof historyRows)[0]>();
  for (const r of historyRows) {
    if (!historyMap.has(r.field_name)) historyMap.set(r.field_name, r);
  }

  const fields: FieldFreshness[] = SCORED_FIELDS.map(field => {
    let value: string | null = null;
    if (field === "emails") {
      const emailRow = _db.query(`SELECT address FROM emails WHERE contact_id=? LIMIT 1`).get(contactId) as { address: string } | null;
      value = emailRow?.address ?? null;
    } else if (field === "phones") {
      const phoneRow = _db.query(`SELECT number FROM phones WHERE contact_id=? LIMIT 1`).get(contactId) as { number: string } | null;
      value = phoneRow?.number ?? null;
    } else {
      value = contact[field] != null ? String(contact[field]) : null;
    }

    const verified = verifiedMap.get(field);
    const history = historyMap.get(field);
    let confidence: FieldFreshness["confidence"] = "unknown";
    let days_old: number | null = null;
    let last_verified_at: string | null = null;
    let source: string | null = null;

    if (verified) {
      confidence = "verified";
      last_verified_at = verified.verified_at;
      source = verified.source;
      days_old = Math.floor((Date.now() - new Date(verified.verified_at).getTime()) / 86400000);
    } else if (history) {
      confidence = (history.source === "import" ? "imported" : "inferred") as FieldFreshness["confidence"];
      last_verified_at = history.created_at;
      source = history.source;
      days_old = Math.floor((Date.now() - new Date(history.created_at).getTime()) / 86400000);
      if (days_old > 365) confidence = "stale";
    } else if (value) {
      confidence = "inferred";
    }

    return { field_name: field, value, last_verified_at, source, confidence, days_old };
  });

  // Score: verified=20, imported/inferred=10, stale/unknown=0 per field
  const fieldScore = fields.reduce((acc, f) => {
    if (!f.value) return acc;
    if (f.confidence === "verified") return acc + 20;
    if (f.confidence === "imported" || f.confidence === "inferred") return acc + 10;
    return acc + 5;
  }, 0);
  const overall_score = Math.min(100, fieldScore);

  return {
    contact_id: contactId,
    overall_score,
    fields,
    stale_fields: fields.filter(f => f.confidence === "stale" || (!f.value && f.field_name !== "phones")).map(f => f.field_name),
    verified_fields: fields.filter(f => f.confidence === "verified").map(f => f.field_name),
  };
}

export function getStaleContacts(threshold = 40, db?: Database): Array<{ contact_id: string; display_name: string; score: number }> {
  const _db = db || getDatabase();
  // Simple heuristic: contacts with missing key fields
  const rows = _db
    .query(
      `SELECT * FROM (
        SELECT c.id as contact_id, c.display_name,
          (CASE WHEN c.job_title IS NOT NULL THEN 15 ELSE 0 END +
           CASE WHEN c.company_id IS NOT NULL THEN 15 ELSE 0 END +
           CASE WHEN c.last_contacted_at IS NOT NULL THEN 20 ELSE 0 END +
           CASE WHEN EXISTS(SELECT 1 FROM emails WHERE contact_id=c.id) THEN 20 ELSE 0 END +
           CASE WHEN EXISTS(SELECT 1 FROM phones WHERE contact_id=c.id) THEN 15 ELSE 0 END +
           CASE WHEN c.notes IS NOT NULL THEN 10 ELSE 0 END +
           CASE WHEN EXISTS(SELECT 1 FROM contact_tags WHERE contact_id=c.id) THEN 5 ELSE 0 END
          ) as score
        FROM contacts c WHERE c.archived=0
      ) WHERE score < ? ORDER BY score ASC LIMIT 100`,
    )
    .all(threshold) as Array<{ contact_id: string; display_name: string; score: number }>;
  return rows;
}

export function markFieldVerified(contactId: string, fieldName: string, source?: string, db?: Database): void {
  const _db = db || getDatabase();
  try {
    _db
      .query(
        `INSERT OR REPLACE INTO field_verifications(contact_id,field_name,verified_at,source) VALUES(?,?,?,?)`,
      )
      .run(contactId, fieldName, now(), source || null);
  } catch {
    // Table may not exist yet — just log activity instead
    _db
      .query(
        `INSERT INTO activity_log(id,contact_id,action,details,created_at) VALUES(?,?,?,?,?)`,
      )
      .run(
        crypto.randomUUID(),
        contactId,
        "field.verified",
        JSON.stringify({ field_name: fieldName, source }),
        now(),
      );
  }
}
