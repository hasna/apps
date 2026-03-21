import { Database } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";

export function computeRelationshipSignals(
  contactId: string,
  db?: Database,
): {
  health: number;
  engagement_status: string;
  interaction_count_30d: number;
  interaction_count_90d: number;
} {
  const _db = db || getDatabase();
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const d90 = new Date(Date.now() - 90 * 86400000).toISOString();
  const count30 =
    (
      _db
        .query(`SELECT COUNT(*) c FROM activity_log WHERE contact_id=? AND created_at>=?`)
        .get(contactId, d30) as { c: number }
    ).c +
    (
      _db
        .query(
          `SELECT COUNT(*) c FROM events WHERE contact_ids LIKE ? AND event_date>=?`,
        )
        .get(`%${contactId}%`, d30) as { c: number }
    ).c;
  const count90 = (
    _db
      .query(`SELECT COUNT(*) c FROM activity_log WHERE contact_id=? AND created_at>=?`)
      .get(contactId, d90) as { c: number }
  ).c;
  const contact = _db
    .query(`SELECT last_contacted_at FROM contacts WHERE id=?`)
    .get(contactId) as { last_contacted_at: string | null } | null;
  let health = 50;
  if (contact?.last_contacted_at) {
    const days = Math.floor(
      (Date.now() - new Date(contact.last_contacted_at).getTime()) / 86400000,
    );
    health +=
      days < 7
        ? 30
        : days < 14
          ? 20
          : days < 30
            ? 10
            : days < 60
              ? 0
              : days < 90
                ? -10
                : -25;
  } else {
    health = 20;
  }
  health = Math.max(0, Math.min(100, health + Math.min(20, count30 * 5)));
  let engagement_status = "stable";
  if (!contact?.last_contacted_at) {
    engagement_status = "new";
  } else {
    const days = Math.floor(
      (Date.now() - new Date(contact.last_contacted_at).getTime()) / 86400000,
    );
    if (days > 90) engagement_status = "ghost";
    else if (days > 45) engagement_status = "cooling";
    else if (count30 > 2) engagement_status = "warming";
  }
  return {
    health,
    engagement_status,
    interaction_count_30d: count30,
    interaction_count_90d: count90,
  };
}

export function recomputeAllSignals(db?: Database): number {
  const _db = db || getDatabase();
  const contacts = _db.query(`SELECT id FROM contacts WHERE archived=0`).all() as { id: string }[];
  for (const c of contacts) {
    const signals = computeRelationshipSignals(c.id, _db);
    _db
      .query(
        `UPDATE contacts SET relationship_health=?, engagement_status=?, interaction_count_30d=?, interaction_count_90d=?, updated_at=? WHERE id=?`,
      )
      .run(
        signals.health,
        signals.engagement_status,
        signals.interaction_count_30d,
        signals.interaction_count_90d,
        now(),
        c.id,
      );
  }
  return contacts.length;
}
