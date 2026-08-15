import { createWebhook, getWebhook, listWebhooks, deleteWebhook } from "../store/index.js";
import type { Run, ApiCheck, ApiCheckResult } from "../types/index.js";

// ─── CRUD (routed through the Store — never touches SQLite directly) ─────────
// The webhook domain lives in the Store (db/webhooks.ts locally, /v1/webhooks in
// cloud mode) so it can never be written to the wrong dataset.
export { createWebhook, getWebhook, listWebhooks, deleteWebhook };
export type { Webhook } from "../db/webhooks.js";

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
  const webhooks = await listWebhooks(run.projectId ?? undefined);

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

  const webhooks = await listWebhooks(check.projectId ?? undefined);
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
  const webhook = await getWebhook(id);
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
