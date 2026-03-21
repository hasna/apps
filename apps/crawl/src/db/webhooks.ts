import type { Webhook, WebhookDelivery, WebhookEvent } from "../types/index.js";
import { getDb } from "./database.js";

// ─── Row Types ────────────────────────────────────────────────────────────────

interface WebhookRow {
  id: string;
  url: string;
  events: string;
  secret: string | null;
  active: number;
  created_at: string;
  last_triggered_at: string | null;
  failure_count: number;
}

interface WebhookDeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  payload: string;
  status: string;
  http_status: number | null;
  response_body: string | null;
  attempt_count: number;
  next_retry_at: string | null;
  created_at: string;
  delivered_at: string | null;
}

// ─── Row Converters ───────────────────────────────────────────────────────────

function rowToWebhook(row: WebhookRow): Webhook {
  return {
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events) as WebhookEvent[],
    secret: row.secret,
    active: row.active === 1,
    createdAt: row.created_at,
    lastTriggeredAt: row.last_triggered_at,
    failureCount: row.failure_count,
  };
}

function rowToDelivery(row: WebhookDeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    event: row.event as WebhookEvent,
    payload: row.payload,
    status: row.status as WebhookDelivery["status"],
    httpStatus: row.http_status,
    responseBody: row.response_body,
    attemptCount: row.attempt_count,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

// ─── Webhook CRUD ─────────────────────────────────────────────────────────────

export function createWebhook(input: {
  url: string;
  events?: WebhookEvent[];
  secret?: string;
}): Webhook {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const events = JSON.stringify(input.events ?? ["crawl.completed"]);
  const secret = input.secret ?? null;

  db.prepare(
    `INSERT INTO webhooks (id, url, events, secret, active, created_at, last_triggered_at, failure_count)
     VALUES (?, ?, ?, ?, 1, ?, NULL, 0)`
  ).run(id, input.url, events, secret, now);

  return getWebhook(id)!;
}

export function getWebhook(id: string): Webhook | null {
  const db = getDb();
  const row = db
    .prepare<WebhookRow, [string]>("SELECT * FROM webhooks WHERE id = ?")
    .get(id);
  return row ? rowToWebhook(row) : null;
}

export function listWebhooks(): Webhook[] {
  const db = getDb();
  return db
    .prepare<WebhookRow, []>("SELECT * FROM webhooks ORDER BY created_at DESC")
    .all()
    .map(rowToWebhook);
}

export function updateWebhook(
  id: string,
  updates: Partial<
    Pick<Webhook, "url" | "events" | "secret" | "active" | "lastTriggeredAt" | "failureCount">
  >
): Webhook | null {
  const db = getDb();
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.url !== undefined) {
    setClauses.push("url = ?");
    values.push(updates.url);
  }
  if (updates.events !== undefined) {
    setClauses.push("events = ?");
    values.push(JSON.stringify(updates.events));
  }
  if (updates.secret !== undefined) {
    setClauses.push("secret = ?");
    values.push(updates.secret);
  }
  if (updates.active !== undefined) {
    setClauses.push("active = ?");
    values.push(updates.active ? 1 : 0);
  }
  if (updates.lastTriggeredAt !== undefined) {
    setClauses.push("last_triggered_at = ?");
    values.push(updates.lastTriggeredAt);
  }
  if (updates.failureCount !== undefined) {
    setClauses.push("failure_count = ?");
    values.push(updates.failureCount);
  }

  if (setClauses.length === 0) return getWebhook(id);

  values.push(id);
  db.prepare(
    `UPDATE webhooks SET ${setClauses.join(", ")} WHERE id = ?`
  ).run(...(values as Parameters<ReturnType<typeof db.prepare>["run"]>));

  return getWebhook(id);
}

export function deleteWebhook(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM webhooks WHERE id = ?").run(id);
  return result.changes > 0;
}

// ─── Delivery CRUD ────────────────────────────────────────────────────────────

export function createDelivery(input: {
  webhookId: string;
  event: WebhookEvent;
  payload: string;
}): WebhookDelivery {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status, http_status, response_body, attempt_count, next_retry_at, created_at, delivered_at)
     VALUES (?, ?, ?, ?, 'pending', NULL, NULL, 0, NULL, ?, NULL)`
  ).run(id, input.webhookId, input.event, input.payload, now);

  return getDelivery(id)!;
}

export function getDelivery(id: string): WebhookDelivery | null {
  const db = getDb();
  const row = db
    .prepare<WebhookDeliveryRow, [string]>(
      "SELECT * FROM webhook_deliveries WHERE id = ?"
    )
    .get(id);
  return row ? rowToDelivery(row) : null;
}

export function updateDelivery(
  id: string,
  updates: Partial<
    Pick<
      WebhookDelivery,
      | "status"
      | "httpStatus"
      | "responseBody"
      | "attemptCount"
      | "nextRetryAt"
      | "deliveredAt"
    >
  >
): WebhookDelivery | null {
  const db = getDb();
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    setClauses.push("status = ?");
    values.push(updates.status);
  }
  if (updates.httpStatus !== undefined) {
    setClauses.push("http_status = ?");
    values.push(updates.httpStatus);
  }
  if (updates.responseBody !== undefined) {
    setClauses.push("response_body = ?");
    values.push(updates.responseBody);
  }
  if (updates.attemptCount !== undefined) {
    setClauses.push("attempt_count = ?");
    values.push(updates.attemptCount);
  }
  if (updates.nextRetryAt !== undefined) {
    setClauses.push("next_retry_at = ?");
    values.push(updates.nextRetryAt);
  }
  if (updates.deliveredAt !== undefined) {
    setClauses.push("delivered_at = ?");
    values.push(updates.deliveredAt);
  }

  if (setClauses.length === 0) return getDelivery(id);

  values.push(id);
  db.prepare(
    `UPDATE webhook_deliveries SET ${setClauses.join(", ")} WHERE id = ?`
  ).run(...(values as Parameters<ReturnType<typeof db.prepare>["run"]>));

  return getDelivery(id);
}

export function listDeliveries(webhookId: string, limit = 50): WebhookDelivery[] {
  const db = getDb();
  return db
    .prepare<WebhookDeliveryRow, [string, number]>(
      "SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(webhookId, limit)
    .map(rowToDelivery);
}

export function getPendingDeliveries(): WebhookDelivery[] {
  const db = getDb();
  return db
    .prepare<WebhookDeliveryRow, []>(
      `SELECT * FROM webhook_deliveries
       WHERE status IN ('pending', 'failed')
       ORDER BY created_at ASC`
    )
    .all()
    .map(rowToDelivery);
}
