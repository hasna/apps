import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.ts";
import type { Webhook, WebhookEvent } from "../types/index.ts";
import { NotFoundError, ValidationError } from "../types/index.ts";

interface RawWebhook {
  id: string; workspace_id: string | null; project_id: string | null;
  url: string; secret: string; events: string; is_active: number;
  last_triggered_at: string | null; failure_count: number; created_at: string;
}

function rowToWebhook(r: RawWebhook): Webhook {
  return {
    id: r.id, workspace_id: r.workspace_id, project_id: r.project_id,
    url: r.url, secret: r.secret,
    events: JSON.parse(r.events) as string[],
    is_active: r.is_active === 1,
    last_triggered_at: r.last_triggered_at,
    failure_count: r.failure_count, created_at: r.created_at,
  };
}

export function createWebhook(
  url: string, events: WebhookEvent[], options: { workspace_id?: string; project_id?: string; secret?: string } = {},
  db?: Database
): Webhook {
  const database = db ?? getDatabase();
  if (!url.startsWith("http")) throw new ValidationError("Webhook URL must start with http/https");
  if (events.length === 0) throw new ValidationError("At least one event is required");
  const id = uuid();
  const secret = options.secret ?? generateWebhookSecret();
  const n = now();
  database.run(
    `INSERT INTO webhooks (id, workspace_id, project_id, url, secret, events, is_active, failure_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)`,
    [id, options.workspace_id ?? null, options.project_id ?? null, url, secret, JSON.stringify(events), n]
  );
  return { id, workspace_id: options.workspace_id ?? null, project_id: options.project_id ?? null, url, secret, events, is_active: true, last_triggered_at: null, failure_count: 0, created_at: n };
}

export function listWebhooks(options: { workspace_id?: string; project_id?: string } = {}, db?: Database): Webhook[] {
  const database = db ?? getDatabase();
  if (options.project_id) {
    return database.query<RawWebhook, [string]>("SELECT * FROM webhooks WHERE project_id = ? ORDER BY created_at DESC").all(options.project_id).map(rowToWebhook);
  }
  if (options.workspace_id) {
    return database.query<RawWebhook, [string]>("SELECT * FROM webhooks WHERE workspace_id = ? ORDER BY created_at DESC").all(options.workspace_id).map(rowToWebhook);
  }
  return database.query<RawWebhook, []>("SELECT * FROM webhooks ORDER BY created_at DESC").all().map(rowToWebhook);
}

export function getWebhookById(id: string, db?: Database): Webhook {
  const database = db ?? getDatabase();
  const row = database.query<RawWebhook, [string]>("SELECT * FROM webhooks WHERE id = ?").get(id);
  if (!row) throw new NotFoundError("Webhook", id);
  return rowToWebhook(row);
}

export function deleteWebhook(id: string, db?: Database): void {
  const database = db ?? getDatabase();
  const result = database.run("DELETE FROM webhooks WHERE id = ?", [id]);
  if (result.changes === 0) throw new NotFoundError("Webhook", id);
}

export function updateWebhookTriggered(id: string, db?: Database): void {
  const database = db ?? getDatabase();
  database.run("UPDATE webhooks SET last_triggered_at = ?, failure_count = 0 WHERE id = ?", [now(), id]);
}

export function incrementWebhookFailure(id: string, db?: Database): number {
  const database = db ?? getDatabase();
  database.run("UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ?", [id]);
  const row = database.query<{ failure_count: number }, [string]>("SELECT failure_count FROM webhooks WHERE id = ?").get(id);
  const count = row?.failure_count ?? 0;
  // Deactivate after 10 consecutive failures
  if (count >= 10) database.run("UPDATE webhooks SET is_active = 0 WHERE id = ?", [id]);
  return count;
}

function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
