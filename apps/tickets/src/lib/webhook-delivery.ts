import type { Webhook, WebhookEvent, WebhookPayload } from "../types/index.ts";
import { updateWebhookTriggered, incrementWebhookFailure } from "../db/webhooks.ts";

/** HMAC-SHA256 signature for webhook payload */
async function signPayload(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return "sha256=" + Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  attempts: number;
}

/** Deliver a webhook event with HMAC signing and exponential backoff retry (3 attempts). */
export async function deliverWebhook(
  webhook: Webhook,
  event: WebhookEvent,
  data: unknown,
  actor: WebhookPayload["actor"] = null
): Promise<DeliveryResult> {
  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    webhook_id: webhook.id,
    project_id: webhook.project_id ?? "",
    data,
    actor,
  };

  const body = JSON.stringify(payload);
  const signature = await signPayload(body, webhook.secret);

  const MAX_ATTEMPTS = 3;
  let lastError = "";
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const res = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tickets-Signature": signature,
          "X-Tickets-Event": event,
          "X-Tickets-Delivery": webhook.id,
          "User-Agent": "open-tickets/0.1.0",
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      lastStatus = res.status;

      if (res.ok) {
        updateWebhookTriggered(webhook.id);
        return { success: true, statusCode: res.status, attempts: attempt };
      }

      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    // Exponential backoff: 1s, 2s, 4s
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
    }
  }

  incrementWebhookFailure(webhook.id);
  return { success: false, statusCode: lastStatus, error: lastError, attempts: MAX_ATTEMPTS };
}

/** Fire-and-forget: deliver to all active webhooks subscribed to this event. */
export function dispatchWebhookEvent(
  webhooks: Webhook[],
  event: WebhookEvent,
  data: unknown,
  actor: WebhookPayload["actor"] = null
): void {
  const active = webhooks.filter((w) => w.is_active && w.events.includes(event));
  for (const webhook of active) {
    // Non-blocking delivery
    deliverWebhook(webhook, event, data, actor).catch(() => {
      // Errors already handled inside deliverWebhook
    });
  }
}
