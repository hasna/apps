import { getDatabase, uuid, now } from "./database.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface WebhookRow {
  id: string;
  url: string;
  events: string; // JSON array
  project_id: string | null;
  secret: string | null;
  active: number;
  created_at: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  projectId: string | null;
  secret: string | null;
  active: boolean;
  createdAt: string;
}

function fromRow(row: WebhookRow): Webhook {
  return {
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events),
    projectId: row.project_id,
    secret: row.secret,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function createWebhook(input: {
  url: string;
  events?: string[];
  projectId?: string;
  secret?: string;
}): Webhook {
  const db = getDatabase();
  const id = uuid();
  const events = input.events ?? ["failed"];
  const secret = input.secret ?? crypto.randomUUID().replace(/-/g, "");

  db.query(`
    INSERT INTO webhooks (id, url, events, project_id, secret, active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(id, input.url, JSON.stringify(events), input.projectId ?? null, secret, now());

  return getWebhook(id)!;
}

export function getWebhook(id: string): Webhook | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM webhooks WHERE id = ?").get(id) as WebhookRow | null;
  if (!row) {
    // Try partial ID
    const rows = db.query("SELECT * FROM webhooks WHERE id LIKE ? || '%'").all(id) as WebhookRow[];
    if (rows.length === 1) return fromRow(rows[0]!);
    return null;
  }
  return fromRow(row);
}

export function listWebhooks(projectId?: string): Webhook[] {
  const db = getDatabase();
  let query = "SELECT * FROM webhooks WHERE active = 1";
  const params: string[] = [];
  if (projectId) {
    query += " AND (project_id = ? OR project_id IS NULL)";
    params.push(projectId);
  }
  query += " ORDER BY created_at DESC";
  const rows = db.query(query).all(...params) as WebhookRow[];
  return rows.map(fromRow);
}

export function deleteWebhook(id: string): boolean {
  const db = getDatabase();
  const webhook = getWebhook(id);
  if (!webhook) return false;
  db.query("DELETE FROM webhooks WHERE id = ?").run(webhook.id);
  return true;
}
