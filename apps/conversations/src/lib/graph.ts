import { getDb } from "./db.js";

export interface GraphEdge {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  weight: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface RelatedEntity {
  type: string;
  id: string;
  relation: string;
  weight: number;
}

export interface AgentNetwork {
  agent: string;
  communicates_with: { agent: string; message_count: number; last_at: string }[];
  channels: { channel: string; message_count: number }[];
  projects: string[];
}

/**
 * Ensure graph_edges table exists.
 */
function ensureGraphTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      from_type TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_type TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      UNIQUE(from_type, from_id, to_type, to_id, relation)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_graph_from ON graph_edges(from_type, from_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_graph_to ON graph_edges(to_type, to_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_graph_relation ON graph_edges(relation)");
}

/**
 * Build the knowledge graph from messages, channels, and projects.
 * Scans all messages to create edges:
 *   agent → communicates_with → agent (DM frequency)
 *   agent → member_of → channel (channel membership)
 *   agent → posts_in → channel (message activity)
 *   channel → belongs_to → project (channel-project link)
 *   message → replies_to → message (threading)
 */
export function buildGraph(): { edges_created: number; edges_updated: number } {
  const db = getDb();
  ensureGraphTable();

  let created = 0;
  let updated = 0;

  const upsert = db.prepare(`
    INSERT INTO graph_edges (from_type, from_id, to_type, to_id, relation, weight, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))
    ON CONFLICT(from_type, from_id, to_type, to_id, relation) DO UPDATE SET
      weight = excluded.weight,
      updated_at = excluded.updated_at
  `);

  db.transaction(() => {
    // Agent-to-agent communication (DMs)
    const dmPairs = db.prepare(`
      SELECT from_agent, to_agent, COUNT(*) as cnt, MAX(created_at) as last_at
      FROM messages WHERE channel IS NULL AND from_agent != to_agent
      GROUP BY from_agent, to_agent
    `).all() as { from_agent: string; to_agent: string; cnt: number; last_at: string }[];

    for (const pair of dmPairs) {
      const existing = db.prepare(
        "SELECT 1 FROM graph_edges WHERE from_type='agent' AND from_id=? AND to_type='agent' AND to_id=? AND relation='communicates_with'"
      ).get(pair.from_agent, pair.to_agent);
      upsert.run("agent", pair.from_agent, "agent", pair.to_agent, "communicates_with", pair.cnt);
      if (existing) updated++; else created++;
    }

    // Agent posts in channel
    const channelPosts = db.prepare(`
      SELECT from_agent, channel, COUNT(*) as cnt
      FROM messages WHERE channel IS NOT NULL
      GROUP BY from_agent, channel
    `).all() as { from_agent: string; channel: string; cnt: number }[];

    for (const sp of channelPosts) {
      const existing = db.prepare(
        "SELECT 1 FROM graph_edges WHERE from_type='agent' AND from_id=? AND to_type='channel' AND to_id=? AND relation='posts_in'"
      ).get(sp.from_agent, sp.channel);
      upsert.run("agent", sp.from_agent, "channel", sp.channel, "posts_in", sp.cnt);
      if (existing) updated++; else created++;
    }

    // Channel membership
    const members = db.prepare("SELECT agent, channel FROM channel_members").all() as { agent: string; channel: string }[];
    for (const m of members) {
      const existing = db.prepare(
        "SELECT 1 FROM graph_edges WHERE from_type='agent' AND from_id=? AND to_type='channel' AND to_id=? AND relation='member_of'"
      ).get(m.agent, m.channel);
      upsert.run("agent", m.agent, "channel", m.channel, "member_of", 1);
      if (existing) updated++; else created++;
    }

    // Channel belongs to project
    const channelProjects = db.prepare(
      "SELECT name, project_id FROM channels WHERE project_id IS NOT NULL"
    ).all() as { name: string; project_id: string }[];

    for (const sp of channelProjects) {
      const existing = db.prepare(
        "SELECT 1 FROM graph_edges WHERE from_type='channel' AND from_id=? AND to_type='project' AND to_id=? AND relation='belongs_to'"
      ).get(sp.name, sp.project_id);
      upsert.run("channel", sp.name, "project", sp.project_id, "belongs_to", 1);
      if (existing) updated++; else created++;
    }
  });

  return { edges_created: created, edges_updated: updated };
}

/**
 * Get all entities related to a given entity.
 */
export function getRelated(entityType: string, entityId: string): RelatedEntity[] {
  const db = getDb();
  ensureGraphTable();

  const outgoing = db.prepare(`
    SELECT to_type as type, to_id as id, relation, weight FROM graph_edges
    WHERE from_type = ? AND from_id = ? ORDER BY weight DESC
  `).all(entityType, entityId) as RelatedEntity[];

  const incoming = db.prepare(`
    SELECT from_type as type, from_id as id, relation, weight FROM graph_edges
    WHERE to_type = ? AND to_id = ? ORDER BY weight DESC
  `).all(entityType, entityId) as RelatedEntity[];

  return [...outgoing, ...incoming];
}

/**
 * Get an agent's communication network.
 */
export function getAgentNetwork(agent: string): AgentNetwork {
  const db = getDb();
  ensureGraphTable();

  // Who does this agent talk to most?
  const comms = db.prepare(`
    SELECT to_id as agent, weight as message_count,
      (SELECT MAX(created_at) FROM messages WHERE from_agent = ? AND to_agent = ge.to_id AND channel IS NULL) as last_at
    FROM graph_edges ge
    WHERE from_type = 'agent' AND from_id = ? AND relation = 'communicates_with'
    ORDER BY weight DESC LIMIT 20
  `).all(agent, agent) as { agent: string; message_count: number; last_at: string }[];

  // What channels does this agent post in?
  const channels = db.prepare(`
    SELECT to_id as channel, weight as message_count FROM graph_edges
    WHERE from_type = 'agent' AND from_id = ? AND relation = 'posts_in'
    ORDER BY weight DESC LIMIT 20
  `).all(agent) as { channel: string; message_count: number }[];

  // What projects is this agent associated with? (through channels)
  const projects = db.prepare(`
    SELECT DISTINCT g2.to_id FROM graph_edges g1
    JOIN graph_edges g2 ON g1.to_type = 'channel' AND g1.to_id = g2.from_id AND g2.relation = 'belongs_to'
    WHERE g1.from_type = 'agent' AND g1.from_id = ? AND g1.relation IN ('member_of', 'posts_in')
  `).all(agent) as { to_id: string }[];

  return {
    agent,
    communicates_with: comms,
    channels,
    projects: projects.map((p) => p.to_id),
  };
}

/**
 * Get graph statistics.
 */
export function getGraphStats(): { total_edges: number; by_relation: Record<string, number> } {
  const db = getDb();
  ensureGraphTable();

  const total = (db.prepare("SELECT COUNT(*) as c FROM graph_edges").get() as { c: number }).c;
  const byRelation = db.prepare(
    "SELECT relation, COUNT(*) as c FROM graph_edges GROUP BY relation ORDER BY c DESC"
  ).all() as { relation: string; c: number }[];

  const map: Record<string, number> = {};
  for (const r of byRelation) map[r.relation] = r.c;

  return { total_edges: total, by_relation: map };
}
