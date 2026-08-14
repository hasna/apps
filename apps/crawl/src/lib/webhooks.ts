import { createHmac } from "crypto";
import {
  createDelivery,
  getDelivery,
  getPendingDeliveries,
  getWebhook,
  listWebhooks,
  updateDelivery,
  updateWebhook,
} from "../db/webhooks.js";
import type { WebhookEvent } from "../types/index.js";

// ─── Signing ──────────────────────────────────────────────────────────────────

export function signPayload(payload: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

export async function deliverWebhook(deliveryId: string): Promise<boolean> {
  const delivery = getDelivery(deliveryId);
  if (!delivery) return false;
  const webhook = getWebhook(delivery.webhookId);
  if (!webhook) return false;

  const attemptCount = delivery.attemptCount + 1;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "open-crawl-webhook/1.0",
      "X-Crawl-Event": delivery.event,
      "X-Crawl-Delivery": delivery.id,
    };
    if (webhook.secret) {
      headers["X-Crawl-Signature"] = signPayload(delivery.payload, webhook.secret);
    }

    const response = await fetch(webhook.url, {
      method: "POST",
      headers,
      body: delivery.payload,
      signal: AbortSignal.timeout(10_000),
    });

    const responseBody = await response.text().catch(() => "");
    const success = response.ok;

    updateDelivery(deliveryId, {
      status: success ? "delivered" : "failed",
      httpStatus: response.status,
      responseBody: responseBody.slice(0, 500),
      attemptCount,
      deliveredAt: success ? new Date().toISOString() : undefined,
      nextRetryAt:
        !success && attemptCount < 5
          ? new Date(Date.now() + Math.pow(2, attemptCount) * 60_000).toISOString()
          : undefined,
    });

    if (success) {
      updateWebhook(webhook.id, {
        lastTriggeredAt: new Date().toISOString(),
        failureCount: 0,
      });
    } else {
      updateWebhook(webhook.id, { failureCount: webhook.failureCount + 1 });
    }

    return success;
  } catch (err) {
    const backoffMs = Math.pow(2, attemptCount) * 60_000; // 2m, 4m, 8m, 16m, 32m
    updateDelivery(deliveryId, {
      status: "failed",
      attemptCount,
      responseBody: String(err).slice(0, 500),
      nextRetryAt:
        attemptCount < 5
          ? new Date(Date.now() + backoffMs).toISOString()
          : undefined,
    });
    return false;
  }
}

// ─── Fire ─────────────────────────────────────────────────────────────────────

export async function fireWebhook(
  event: WebhookEvent,
  payload: object
): Promise<void> {
  const webhooks = listWebhooks().filter(
    (w) => w.active && w.events.includes(event)
  );
  if (webhooks.length === 0) return;

  const payloadStr = JSON.stringify({
    ...payload,
    event,
    timestamp: new Date().toISOString(),
  });

  await Promise.allSettled(
    webhooks.map(async (webhook) => {
      const delivery = createDelivery({
        webhookId: webhook.id,
        event,
        payload: payloadStr,
      });
      await deliverWebhook(delivery.id);
    })
  );
}

// ─── Retry ────────────────────────────────────────────────────────────────────

export async function retryFailedDeliveries(): Promise<number> {
  const pending = getPendingDeliveries().filter(
    (d) =>
      d.status === "failed" &&
      d.attemptCount < 5 &&
      (!d.nextRetryAt || new Date(d.nextRetryAt) <= new Date())
  );
  let retried = 0;
  for (const d of pending) {
    await deliverWebhook(d.id);
    retried++;
  }
  return retried;
}
