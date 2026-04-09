import type { ContactsDatabase } from "./database.js";
import { getDatabase } from "./database.js";

export interface RelationshipSignal {
  contact_id: string;
  display_name: string;
  signal_type: "warming" | "cooling" | "ghost" | "healthy";
  days_since_contact: number | null;
  interaction_count_30d: number;
  engagement_status: string | null;
  relationship_health: number | null;
  reason: string;
}

export function getRelationshipSignals(contactId: string, db?: ContactsDatabase): RelationshipSignal[] {
  const _db = db || getDatabase();
  const row = _db
    .query(
      `SELECT id as contact_id, display_name, last_contacted_at, interaction_count_30d, engagement_status, relationship_health FROM contacts WHERE id=?`,
    )
    .get(contactId) as {
    contact_id: string;
    display_name: string;
    last_contacted_at: string | null;
    interaction_count_30d: number;
    engagement_status: string | null;
    relationship_health: number | null;
  } | null;
  if (!row) return [];
  const daysSince = row.last_contacted_at
    ? Math.floor((Date.now() - new Date(row.last_contacted_at).getTime()) / 86400000)
    : null;
  const signals: RelationshipSignal[] = [];
  const cnt = row.interaction_count_30d || 0;
  const health = row.relationship_health ?? 50;
  if (daysSince === null || daysSince > 180) {
    signals.push({ ...row, signal_type: "ghost", days_since_contact: daysSince, reason: "No contact in 180+ days or never contacted" });
  } else if (daysSince > 60 && cnt === 0) {
    signals.push({ ...row, signal_type: "cooling", days_since_contact: daysSince, reason: `No contact in ${daysSince} days, no recent interactions` });
  } else if (cnt > 3 && health > 70) {
    signals.push({ ...row, signal_type: "warming", days_since_contact: daysSince, reason: `${cnt} interactions in last 30 days, health score ${health}` });
  } else {
    signals.push({ ...row, signal_type: "healthy", days_since_contact: daysSince, reason: `Last contact ${daysSince}d ago, ${cnt} interactions in 30d` });
  }
  return signals;
}

export function getGhostContacts(db?: ContactsDatabase): RelationshipSignal[] {
  const _db = db || getDatabase();
  const rows = _db
    .query(
      `SELECT id as contact_id, display_name, last_contacted_at, interaction_count_30d, engagement_status, relationship_health FROM contacts WHERE (last_contacted_at IS NULL OR julianday('now') - julianday(last_contacted_at) > 180) AND archived=0 ORDER BY last_contacted_at ASC LIMIT 50`,
    )
    .all() as Array<{
    contact_id: string;
    display_name: string;
    last_contacted_at: string | null;
    interaction_count_30d: number;
    engagement_status: string | null;
    relationship_health: number | null;
  }>;
  return rows.map(r => ({
    ...r,
    signal_type: "ghost" as const,
    days_since_contact: r.last_contacted_at ? Math.floor((Date.now() - new Date(r.last_contacted_at).getTime()) / 86400000) : null,
    reason: "No contact in 180+ days or never contacted",
  }));
}

export function getWarmingContacts(db?: ContactsDatabase): RelationshipSignal[] {
  const _db = db || getDatabase();
  const rows = _db
    .query(
      `SELECT id as contact_id, display_name, last_contacted_at, interaction_count_30d, engagement_status, relationship_health FROM contacts WHERE interaction_count_30d > 2 AND relationship_health > 60 AND archived=0 ORDER BY relationship_health DESC LIMIT 50`,
    )
    .all() as Array<{
    contact_id: string;
    display_name: string;
    last_contacted_at: string | null;
    interaction_count_30d: number;
    engagement_status: string | null;
    relationship_health: number | null;
  }>;
  return rows.map(r => ({
    ...r,
    signal_type: "warming" as const,
    days_since_contact: r.last_contacted_at ? Math.floor((Date.now() - new Date(r.last_contacted_at).getTime()) / 86400000) : null,
    reason: `${r.interaction_count_30d} interactions in last 30 days`,
  }));
}

export function recomputeAllSignals(db?: ContactsDatabase): { updated: number } {
  const _db = db || getDatabase();
  // Recompute engagement_status based on interaction counts and last_contacted_at
  _db.query(`
    UPDATE contacts SET
      engagement_status = CASE
        WHEN interaction_count_30d > 3 THEN 'warming'
        WHEN last_contacted_at IS NULL OR julianday('now') - julianday(last_contacted_at) > 180 THEN 'ghost'
        WHEN julianday('now') - julianday(last_contacted_at) > 60 THEN 'cooling'
        ELSE 'stable'
      END,
      updated_at = datetime('now')
    WHERE archived = 0
  `).run();
  const result = _db.query(`SELECT changes() as n`).get() as { n: number } | null;
  return { updated: result?.n ?? 0 };
}
