import type { ContactsDatabase } from "./database.js";
import { getDatabase } from "./database.js";

export interface PathNode {
  contact_id: string;
  display_name: string;
  strength: number;
  via_relationship?: string;
}

export function computeRelationshipStrength(contactId: string, db?: ContactsDatabase): number {
  const _db = db || getDatabase();
  const contact = _db
    .query(
      `SELECT last_contacted_at, interaction_count_30d, interaction_count_90d FROM contacts WHERE id=?`,
    )
    .get(contactId) as {
    last_contacted_at: string | null;
    interaction_count_30d: number;
    interaction_count_90d: number;
  } | null;
  if (!contact) return 0;
  let score = 50;
  if (contact.last_contacted_at) {
    const days = Math.floor(
      (Date.now() - new Date(contact.last_contacted_at).getTime()) / 86400000,
    );
    score += days < 7 ? 30 : days < 30 ? 20 : days < 90 ? 5 : -20;
  } else {
    score -= 20;
  }
  score += Math.min(20, (contact.interaction_count_30d || 0) * 4);
  return Math.max(0, Math.min(100, score));
}

export function findWarmPath(
  fromContactId: string,
  toContactId: string,
  db?: ContactsDatabase,
): PathNode[] {
  const _db = db || getDatabase();
  // BFS through contact_relationships
  const visited = new Set<string>([fromContactId]);
  const queue: Array<{ id: string; path: PathNode[] }> = [{ id: fromContactId, path: [] }];
  while (queue.length) {
    const item = queue.shift()!;
    const { id, path } = item;
    if (id === toContactId) return path;
    if (path.length >= 4) continue; // max 4 hops
    const neighbors = _db
      .query(
        `SELECT cr.*, c.display_name FROM contact_relationships cr JOIN contacts c ON (CASE WHEN cr.contact_a_id=? THEN cr.contact_b_id ELSE cr.contact_a_id END)=c.id WHERE (cr.contact_a_id=? OR cr.contact_b_id=?) LIMIT 20`,
      )
      .all(id, id, id) as Array<{
      contact_a_id: string;
      contact_b_id: string;
      display_name: string;
      strength_score?: number;
    }>;
    for (const n of neighbors) {
      const nextId = n.contact_a_id === id ? n.contact_b_id : n.contact_a_id;
      if (visited.has(nextId)) continue;
      visited.add(nextId);
      queue.push({
        id: nextId,
        path: [
          ...path,
          { contact_id: nextId, display_name: n.display_name, strength: n.strength_score || 50 },
        ],
      });
    }
  }
  return []; // no path found
}

export function findConnectionsAtCompany(
  companyId: string,
  db?: ContactsDatabase,
): Array<{ contact_id: string; display_name: string; job_title?: string; strength: number }> {
  const _db = db || getDatabase();
  return _db
    .query(
      `SELECT c.id as contact_id, c.display_name, c.job_title, c.relationship_health as strength FROM contacts c WHERE c.company_id=? AND c.archived=0 ORDER BY c.relationship_health DESC`,
    )
    .all(companyId) as Array<{
    contact_id: string;
    display_name: string;
    job_title?: string;
    strength: number;
  }>;
}

export function detectCoolingRelationships(
  db?: ContactsDatabase,
): Array<{ contact_id: string; display_name: string; days_since: number }> {
  const _db = db || getDatabase();
  const cutoff = new Date(Date.now() - 45 * 86400000).toISOString();
  return _db
    .query(
      `SELECT id as contact_id, display_name, CAST((julianday('now') - julianday(last_contacted_at)) AS INTEGER) as days_since FROM contacts WHERE last_contacted_at IS NOT NULL AND last_contacted_at < ? AND engagement_status != 'ghost' AND archived=0 ORDER BY last_contacted_at ASC LIMIT 50`,
    )
    .all(cutoff) as Array<{ contact_id: string; display_name: string; days_since: number }>;
}
