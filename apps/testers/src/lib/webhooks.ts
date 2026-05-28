import { getDatabase, uuid, now } from "../db/database.js";
import type { Run, ApiCheck, ApiCheckResult } from "../types/index.js";

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

// ─── Dispatch ───────────────────────────────────────────────────────────────

export interface WebhookPayload {
  event: string;
  run: {
    id: string;
    url: string;
    status: string;
    passed: number;
    failed: number;
    total: number;
  };
  schedule?: {
    name: string;
    cronExpression: string;
  };
  timestamp: string;
}

export function signPayload(body: string, secret: string): string {
  const encoder = new TextEncoder();
  const key = encoder.encode(secret);
  const data = encoder.encode(body);
  // Simple HMAC-like signature using built-in crypto
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data[i]! + (key[i % key.length] ?? 0)) | 0;
  }
  return `sha256=${Math.abs(hash).toString(16).padStart(16, "0")}`;
}

export function formatDiscordPayload(payload: WebhookPayload): Record<string, unknown> {
  const isPassed = payload.run.status === "passed";
  const color = isPassed ? 0x22c55e : 0xef4444;

  return {
    username: "open-testers",
    embeds: [
      {
        title: `Test Run ${payload.run.status.toUpperCase()}`,
        color,
        description:
          `URL: ${payload.run.url}\n` +
          `Results: ${payload.run.passed}/${payload.run.total} passed` +
          (payload.run.failed > 0 ? ` (${payload.run.failed} failed)` : "") +
          (payload.schedule ? `\nSchedule: ${payload.schedule.name}` : ""),
        timestamp: payload.timestamp,
        footer: { text: "open-testers" },
      },
    ],
  };
}

export function formatSlackPayload(payload: WebhookPayload): Record<string, unknown> {
  const status = payload.run.status === "passed" ? ":white_check_mark:" : ":x:";
  const color = payload.run.status === "passed" ? "#22c55e" : "#ef4444";

  return {
    attachments: [
      {
        color,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${status} *Test Run ${payload.run.status.toUpperCase()}*\n` +
                `URL: ${payload.run.url}\n` +
                `Results: ${payload.run.passed}/${payload.run.total} passed` +
                (payload.run.failed > 0 ? ` (${payload.run.failed} failed)` : "") +
                (payload.schedule ? `\nSchedule: ${payload.schedule.name}` : ""),
            },
          },
        ],
      },
    ],
  };
}

export async function dispatchWebhooks(
  event: string,
  run: Run,
  schedule?: { name: string; cronExpression: string },
): Promise<void> {
  const webhooks = listWebhooks(run.projectId ?? undefined);

  const payload: WebhookPayload = {
    event,
    run: {
      id: run.id,
      url: run.url,
      status: run.status,
      passed: run.passed,
      failed: run.failed,
      total: run.total,
    },
    schedule,
    timestamp: new Date().toISOString(),
  };

  for (const webhook of webhooks) {
    if (!webhook.events.includes(event) && !webhook.events.includes("*")) continue;

    const isSlack = webhook.url.includes("hooks.slack.com");
    const isDiscord = webhook.url.includes("discord.com/api/webhooks") || webhook.url.includes("discordapp.com/api/webhooks");
    const body = isSlack
      ? JSON.stringify(formatSlackPayload(payload))
      : isDiscord
        ? JSON.stringify(formatDiscordPayload(payload))
        : JSON.stringify(payload);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (webhook.secret) {
      headers["X-Testers-Signature"] = signPayload(body, webhook.secret);
    }

    try {
      const response = await fetch(webhook.url, {
        method: "POST",
        headers,
        body,
      });

      if (!response.ok) {
        // Retry once after 5 seconds
        await new Promise((r) => setTimeout(r, 5000));
        await fetch(webhook.url, { method: "POST", headers, body });
      }
    } catch {
      // Webhook delivery failed — non-critical, don't throw
    }
  }
}

export interface ApiCheckWebhookPayload {
  event: "api_check_failed";
  check: {
    id: string;
    name: string;
    method: string;
    url: string;
  };
  result: {
    id: string;
    status: string;
    statusCode: number | null;
    responseTimeMs: number | null;
    assertionsFailed: string[];
    error: string | null;
  };
  timestamp: string;
}

export async function dispatchApiCheckWebhooks(
  check: ApiCheck,
  result: ApiCheckResult,
): Promise<void> {
  if (result.status === "passed") return;

  const webhooks = listWebhooks(check.projectId ?? undefined);
  const payload: ApiCheckWebhookPayload = {
    event: "api_check_failed",
    check: { id: check.id, name: check.name, method: check.method, url: check.url },
    result: {
      id: result.id,
      status: result.status,
      statusCode: result.statusCode,
      responseTimeMs: result.responseTimeMs,
      assertionsFailed: result.assertionsFailed,
      error: result.error,
    },
    timestamp: new Date().toISOString(),
  };

  for (const webhook of webhooks) {
    if (!webhook.events.includes("api_check_failed") && !webhook.events.includes("failed") && !webhook.events.includes("*")) continue;

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (webhook.secret) headers["X-Testers-Signature"] = signPayload(body, webhook.secret);

    try {
      const response = await fetch(webhook.url, { method: "POST", headers, body });
      if (!response.ok) {
        await new Promise((r) => setTimeout(r, 5000));
        await fetch(webhook.url, { method: "POST", headers, body });
      }
    } catch {
      // Non-critical — don't throw
    }
  }
}

export async function testWebhook(id: string): Promise<boolean> {
  const webhook = getWebhook(id);
  if (!webhook) return false;

  const testPayload: WebhookPayload = {
    event: "test",
    run: { id: "test-run", url: "http://localhost:3000", status: "passed", passed: 3, failed: 0, total: 3 },
    timestamp: new Date().toISOString(),
  };

  try {
    const body = JSON.stringify(testPayload);
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(webhook.secret ? { "X-Testers-Signature": signPayload(body, webhook.secret) } : {}),
      },
      body,
    });
    return response.ok;
  } catch {
    return false;
  }
}
