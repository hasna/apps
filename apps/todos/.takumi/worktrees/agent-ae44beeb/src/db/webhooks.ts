import type { Database } from "bun:sqlite";
import type { Webhook, CreateWebhookInput } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000; // 1s, 2s, 4s exponential backoff

/** Check if an IP address is in a private/reserved range (SSRF prevention) */
function isPrivateOrInternal(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 0) return true;
  return false;
}

/**
 * Validate webhook URL to prevent SSRF attacks.
 * Blocks localhost, private IPs, and cloud metadata endpoints.
 */
export function validateWebhookUrl(urlString: string): { valid: false; error: string } | { valid: true } {
  try {
    const url = new URL(urlString);

    // Only allow HTTPS
    if (url.protocol !== "https:") {
      return { valid: false, error: "Webhook URLs must use HTTPS" };
    }

    const hostname = url.hostname.toLowerCase();

    // Block localhost and loopback
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0") {
      return { valid: false, error: "Webhook URLs cannot target localhost" };
    }

    // Block cloud metadata endpoints
    if (hostname === "169.254.169.254" || hostname.startsWith("169.254.")) {
      return { valid: false, error: "Webhook URLs cannot target cloud metadata endpoints" };
    }

    // Block private IP ranges
    const privateRanges = [
      /^10\./,                    // 10.0.0.0/8
      /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
      /^192\.168\./,              // 192.168.0.0/16
      /^127\./,                   // 127.0.0.0/8
      /^169\.254\./,              // Link-local
      /^fc00:/i,                 // IPv6 private
      /^fe80:/i,                 // IPv6 link-local
    ];

    for (const range of privateRanges) {
      if (range.test(hostname)) {
        return { valid: false, error: "Webhook URLs cannot target private IP ranges" };
      }
    }

    return { valid: true };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Webhook URLs")) {
      return { valid: false, error: e.message };
    }
    return { valid: false, error: `Invalid webhook URL: ${urlString}` };
  }
}

/** Resolve hostname and check if the resolved IP is private (SSRF prevention) */
async function resolveAndCheckIp(hostname: string): Promise<{ allowed: false; error: string } | { allowed: true; ip: string }> {
  try {
    const resolved = await Bun.dns.lookup(hostname);
    if (!resolved) return { allowed: false, error: `Could not resolve hostname: ${hostname}` };
    const addresses = Array.isArray(resolved) ? resolved : [resolved];
    for (const addr of addresses) {
      if (isPrivateOrInternal(addr)) {
        return { allowed: false, error: `Hostname ${hostname} resolves to blocked address ${addr}` };
      }
    }
    return { allowed: true, ip: addresses[0]! };
  } catch {
    return { allowed: true, ip: "" };
  }
}

// Limit concurrent in-flight webhook deliveries to prevent resource exhaustion
let activeDeliveries = 0;
const MAX_CONCURRENT_DELIVERIES = 20;

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
  const urlValidation = validateWebhookUrl(input.url);
  if (!urlValidation.valid) {
    throw new Error(`Invalid webhook URL: ${urlValidation.error}`);
  }
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
  // SSRF prevention: resolve hostname and verify the IP is not private/internal
  try {
    const url = new URL(wh.url);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1") {
      logDelivery(db, wh.id, event, body, null, "Blocked: webhook URL points to localhost", attempt);
      return;
    }
    const ipCheck = await resolveAndCheckIp(hostname);
    if (!ipCheck.allowed) {
      logDelivery(db, wh.id, event, body, null, `Blocked: ${ipCheck.error}`, attempt);
      return;
    }
  } catch {
    logDelivery(db, wh.id, event, body, null, `Invalid URL at delivery time: ${wh.url}`, attempt);
    return;
  }

  // Backpressure: drop delivery if too many in-flight
  if (activeDeliveries >= MAX_CONCURRENT_DELIVERIES) {
    logDelivery(db, wh.id, event, body, null, "Dropped: too many concurrent deliveries", attempt);
    return;
  }

  activeDeliveries++;
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

    if (resp.status >= 400 && attempt < MAX_RETRY_ATTEMPTS) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      setTimeout(() => {
        deliverWebhook(wh, event, body, attempt + 1, db).catch((retryErr) => {
          console.error(`[webhook] Retry failed for webhook ${wh.id}:`, retryErr);
        });
      }, delay);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logDelivery(db, wh.id, event, body, null, errorMsg.slice(0, 1000), attempt);
    console.error(`[webhook] Delivery failed for webhook ${wh.id} (attempt ${attempt}):`, errorMsg);

    if (attempt < MAX_RETRY_ATTEMPTS) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      setTimeout(() => {
        deliverWebhook(wh, event, body, attempt + 1, db).catch((retryErr) => {
          console.error(`[webhook] Retry failed for webhook ${wh.id}:`, retryErr);
        });
      }, delay);
    }
  } finally {
    activeDeliveries--;
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
    deliverWebhook(wh, event, body, 1, d).catch((err) => {
      console.error(`[webhook] Dispatch failed for webhook ${wh.id}:`, err);
    });
  }
}
