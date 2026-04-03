import type { Database } from "bun:sqlite";
import type { Webhook, CreateWebhookInput } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000; // 1s, 2s, 4s exponential backoff

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event: string;
  payload: string;
  status_code: number | null;
  response: string | null;
  attempt: number;
  created_at: string;
}

function rowToWebhook(row: any): Webhook {
  return {
    ...row,
    events: JSON.parse(row.events || "[]"),
    active: !!row.active,
    project_id: row.project_id || null,
    task_list_id: row.task_list_id || null,
    agent_id: row.agent_id || null,
    task_id: row.task_id || null,
  };
}

export function createWebhook(input: CreateWebhookInput, db?: Database): Webhook {
  const d = db || getDatabase();
  const id = uuid();
  d.run(
    `INSERT INTO webhooks (id, url, events, secret, project_id, task_list_id, agent_id, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.url,
      JSON.stringify(input.events || []),
      input.secret || null,
      input.project_id || null,
      input.task_list_id || null,
      input.agent_id || null,
      input.task_id || null,
      now(),
    ],
  );
  return getWebhook(id, d)!;
}

export function getWebhook(id: string, db?: Database): Webhook | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM webhooks WHERE id = ?").get(id);
  return row ? rowToWebhook(row) : null;
}

export function listWebhooks(db?: Database): Webhook[] {
  const d = db || getDatabase();
  return (d.query("SELECT * FROM webhooks ORDER BY created_at DESC").all()).map(rowToWebhook);
}

export function deleteWebhook(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM webhooks WHERE id = ?", [id]).changes > 0;
}

export function listDeliveries(webhookId?: string, limit = 50, db?: Database): WebhookDelivery[] {
  const d = db || getDatabase();
  if (webhookId) {
    return d.query("SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?").all(webhookId, limit) as WebhookDelivery[];
  }
  return d.query("SELECT * FROM webhook_deliveries ORDER BY created_at DESC LIMIT ?").all(limit) as WebhookDelivery[];
}

function logDelivery(
  d: Database,
  webhookId: string,
  event: string,
  payload: string,
  statusCode: number | null,
  response: string | null,
  attempt: number,
): void {
  const id = uuid();
  d.run(
    `INSERT INTO webhook_deliveries (id, webhook_id, event, payload, status_code, response, attempt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, webhookId, event, payload, statusCode, response, attempt, now()],
  );
}

/**
 * Check whether a webhook's scope filters match the given event payload.
 * If a webhook has no scope filters (all null), it matches everything.
 * If it has filters, each non-null filter must match the corresponding payload field.
 */
function matchesScope(wh: Webhook, payload: Record<string, unknown>): boolean {
  if (wh.project_id && payload.project_id !== wh.project_id) return false;
  if (wh.task_list_id && payload.task_list_id !== wh.task_list_id) return false;
  if (wh.agent_id && payload.agent_id !== wh.agent_id && payload.assigned_to !== wh.agent_id) return false;
  if (wh.task_id && payload.id !== wh.task_id) return false;
  return true;
}

async function deliverWebhook(
  wh: Webhook,
  event: string,
  body: string,
  attempt: number,
  db: Database,
): Promise<void> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (wh.secret) {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", encoder.encode(wh.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
      headers["X-Webhook-Signature"] = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
    }
    const resp = await fetch(wh.url, { method: "POST", headers, body });
    const respText = await resp.text().catch(() => "");
    logDelivery(db, wh.id, event, body, resp.status, respText.slice(0, 1000), attempt);

    // Retry on failure (status >= 400)
    if (resp.status >= 400 && attempt < MAX_RETRY_ATTEMPTS) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      setTimeout(() => {
        deliverWebhook(wh, event, body, attempt + 1, db).catch(() => {});
      }, delay);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logDelivery(db, wh.id, event, body, null, errorMsg.slice(0, 1000), attempt);

    // Retry on network error
    if (attempt < MAX_RETRY_ATTEMPTS) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      setTimeout(() => {
        deliverWebhook(wh, event, body, attempt + 1, db).catch(() => {});
      }, delay);
    }
  }
}

export async function dispatchWebhook(event: string, payload: unknown, db?: Database): Promise<void> {
  const d = db || getDatabase();
  const webhooks = listWebhooks(d).filter(w => w.active && (w.events.length === 0 || w.events.includes(event)));
  const payloadObj = (typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>;

  for (const wh of webhooks) {
    // Check scope filters
    if (!matchesScope(wh, payloadObj)) continue;

    const body = JSON.stringify({ event, payload, timestamp: now() });
    // Fire and forget — non-blocking
    deliverWebhook(wh, event, body, 1, d).catch(() => {});
  }
}
