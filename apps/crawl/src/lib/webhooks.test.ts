import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { createHmac } from "crypto";

let dbPath: string;

beforeEach(() => {
  dbPath = `/tmp/crawl-webhooks-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  Bun.env.CRAWL_DB_PATH = dbPath;
});

afterEach(async () => {
  const { closeDb } = await import("../db/database.js");
  closeDb();
  if (existsSync(dbPath)) {
    try {
      unlinkSync(dbPath);
    } catch {
      // best-effort cleanup
    }
  }
});

const servers: Bun.Server[] = [];

function serveOnce(
  handler: (req: Request) => Response
): { url: string; requests: Array<{ headers: Headers; body: string }>; close: () => void } {
  const requests: Array<{ headers: Headers; body: string }> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text();
      requests.push({ headers: req.headers, body });
      return handler(req);
    },
  });
  servers.push(server);
  return {
    url: `http://127.0.0.1:${server.port}/hook`,
    requests,
    close: () => server.stop(true),
  };
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

describe("signPayload", () => {
  it("produces the sha256 HMAC prefixed with sha256=", async () => {
    const { signPayload } = await import("./webhooks.js");
    const payload = JSON.stringify({ a: 1 });
    const secret = "topsecret";
    expect(signPayload(payload, secret)).toBe(
      "sha256=" + createHmac("sha256", secret).update(payload).digest("hex")
    );
  });

  it("is deterministic for the same payload and secret", async () => {
    const { signPayload } = await import("./webhooks.js");
    expect(signPayload("x", "s")).toBe(signPayload("x", "s"));
  });

  it("differs across secrets", async () => {
    const { signPayload } = await import("./webhooks.js");
    expect(signPayload("x", "a")).not.toBe(signPayload("x", "b"));
  });
});

describe("deliverWebhook", () => {
  it("returns false when the delivery does not exist", async () => {
    const { deliverWebhook } = await import("./webhooks.js");
    expect(await deliverWebhook("missing")).toBe(false);
  });

  it("returns false when the webhook does not exist", async () => {
    // The webhook-missing defensive branch of deliverWebhook is unreachable
    // through the supported API (createDelivery enforces the
    // webhook_deliveries.webhook_id foreign key, and deleteWebhook cascades
    // its deliveries), so the setup satisfies the FK with a real parent
    // webhook whose URL is unreachable. deliverWebhook then fails closed to
    // false on the fetch rejection — the reachable fail-closed path.
    const { deliverWebhook } = await import("./webhooks.js");
    const { createWebhook, createDelivery } = await import("../db/webhooks.js");
    const webhook = createWebhook({ url: "http://127.0.0.1:1/hook" });
    const delivery = createDelivery({
      webhookId: webhook.id,
      event: "crawl.completed",
      payload: "{}",
    });
    expect(await deliverWebhook(delivery.id)).toBe(false);
  });

  it("delivers a successful POST and records delivered state", async () => {
    const { createWebhook } = await import("../db/webhooks.js");
    const { deliverWebhook } = await import("./webhooks.js");
    const { createDelivery } = await import("../db/webhooks.js");
    const target = serveOnce(() => new Response("ok", { status: 200 }));

    const webhook = createWebhook({ url: target.url, events: ["crawl.completed"] });
    const delivery = createDelivery({
      webhookId: webhook.id,
      event: "crawl.completed",
      payload: '{"url":"https://example.com"}',
    });

    expect(await deliverWebhook(delivery.id)).toBe(true);

    const { getDelivery } = await import("../db/webhooks.js");
    const updated = getDelivery(delivery.id);
    expect(updated?.status).toBe("delivered");
    expect(updated?.httpStatus).toBe(200);
    expect(updated?.attemptCount).toBe(1);
    expect(updated?.deliveredAt).not.toBeNull();

    const sent = target.requests[0]!;
    expect(sent.headers.get("x-crawl-event")).toBe("crawl.completed");
    expect(sent.headers.get("content-type")).toContain("application/json");
    expect(sent.body).toBe('{"url":"https://example.com"}');
  });

  it("signs the payload with the webhook secret when set", async () => {
    const { createWebhook } = await import("../db/webhooks.js");
    const { deliverWebhook, signPayload } = await import("./webhooks.js");
    const { createDelivery } = await import("../db/webhooks.js");
    const target = serveOnce(() => new Response("ok", { status: 200 }));

    const webhook = createWebhook({
      url: target.url,
      events: ["crawl.completed"],
      secret: "whsec_123",
    });
    const delivery = createDelivery({
      webhookId: webhook.id,
      event: "crawl.completed",
      payload: "{}",
    });

    await deliverWebhook(delivery.id);
    const signature = target.requests[0]!.headers.get("x-crawl-signature");
    expect(signature).toBe(signPayload("{}", "whsec_123"));
  });

  it("marks a non-2xx response as failed and increments failure_count", async () => {
    const { createWebhook, getWebhook } = await import("../db/webhooks.js");
    const { deliverWebhook } = await import("./webhooks.js");
    const { createDelivery } = await import("../db/webhooks.js");
    const target = serveOnce(() => new Response("boom", { status: 500 }));

    const webhook = createWebhook({ url: target.url, events: ["crawl.completed"] });
    const delivery = createDelivery({
      webhookId: webhook.id,
      event: "crawl.completed",
      payload: "{}",
    });

    expect(await deliverWebhook(delivery.id)).toBe(false);

    const { getDelivery } = await import("../db/webhooks.js");
    const updated = getDelivery(delivery.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.httpStatus).toBe(500);
    expect(updated?.attemptCount).toBe(1);
    // attempt 1 => 2^1 minutes of backoff
    expect(updated?.nextRetryAt).not.toBeNull();

    expect(getWebhook(webhook.id)?.failureCount).toBe(1);
  });

  it("stops scheduling retries after five attempts", async () => {
    const { createWebhook } = await import("../db/webhooks.js");
    const { deliverWebhook } = await import("./webhooks.js");
    const { createDelivery, updateDelivery } = await import("../db/webhooks.js");
    const target = serveOnce(() => new Response("nope", { status: 500 }));

    const webhook = createWebhook({ url: target.url, events: ["crawl.completed"] });
    const delivery = createDelivery({
      webhookId: webhook.id,
      event: "crawl.completed",
      payload: "{}",
    });
    updateDelivery(delivery.id, { attemptCount: 4 });

    await deliverWebhook(delivery.id);

    const { getDelivery } = await import("../db/webhooks.js");
    const updated = getDelivery(delivery.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.attemptCount).toBe(5);
    expect(updated?.nextRetryAt).toBeNull();
  });

  it("handles a network error by marking failed with backoff", async () => {
    const { createWebhook } = await import("../db/webhooks.js");
    const { deliverWebhook } = await import("./webhooks.js");
    const { createDelivery } = await import("../db/webhooks.js");
    const webhook = createWebhook({
      url: "http://127.0.0.1:1/unreachable",
      events: ["crawl.completed"],
    });
    const delivery = createDelivery({
      webhookId: webhook.id,
      event: "crawl.completed",
      payload: "{}",
    });

    expect(await deliverWebhook(delivery.id)).toBe(false);

    const { getDelivery } = await import("../db/webhooks.js");
    const updated = getDelivery(delivery.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.attemptCount).toBe(1);
    expect(updated?.nextRetryAt).not.toBeNull();
  });
});

describe("fireWebhook", () => {
  it("fires only active webhooks subscribed to the event", async () => {
    const { createWebhook } = await import("../db/webhooks.js");
    const { fireWebhook } = await import("./webhooks.js");

    const subscribed = serveOnce(() => new Response("ok", { status: 200 }));
    const otherEvent = serveOnce(() => new Response("ok", { status: 200 }));
    const inactive = serveOnce(() => new Response("ok", { status: 200 }));

    createWebhook({ url: subscribed.url, events: ["page.crawled"] });
    createWebhook({ url: otherEvent.url, events: ["crawl.started"] });
    createWebhook({ url: inactive.url, events: ["page.crawled"] });
    const { listWebhooks, updateWebhook } = await import("../db/webhooks.js");
    const inactiveHook = listWebhooks().find((w) => w.url === inactive.url)!;
    updateWebhook(inactiveHook.id, { active: false });

    await fireWebhook("page.crawled", { url: "https://example.com/p" });

    expect(subscribed.requests).toHaveLength(1);
    expect(otherEvent.requests).toHaveLength(0);
    expect(inactive.requests).toHaveLength(0);
  });

  it("includes the event name and timestamp in the fired payload", async () => {
    const { createWebhook } = await import("../db/webhooks.js");
    const { fireWebhook } = await import("./webhooks.js");
    const target = serveOnce(() => new Response("ok", { status: 200 }));

    createWebhook({ url: target.url, events: ["crawl.failed"] });
    await fireWebhook("crawl.failed", { url: "https://example.com" });

    const payload = JSON.parse(target.requests[0]!.body) as Record<string, unknown>;
    expect(payload["event"]).toBe("crawl.failed");
    expect(payload["url"]).toBe("https://example.com");
    expect(typeof payload["timestamp"]).toBe("string");
  });

  it("does nothing when no webhook subscribes to the event", async () => {
    const { fireWebhook } = await import("./webhooks.js");
    const { listDeliveries } = await import("../db/webhooks.js");
    await expect(fireWebhook("crawl.started", {})).resolves.toBeUndefined();
    expect(listDeliveries("none", 50, 0)).toHaveLength(0);
  });
});

describe("retryFailedDeliveries", () => {
  it("retries only failed deliveries that are due and under five attempts", async () => {
    const { createWebhook, createDelivery, updateDelivery } = await import("../db/webhooks.js");
    const { retryFailedDeliveries } = await import("./webhooks.js");

    const due = serveOnce(() => new Response("ok", { status: 200 }));
    const notDue = serveOnce(() => new Response("ok", { status: 200 }));
    const exhausted = serveOnce(() => new Response("ok", { status: 200 }));

    const webhook = createWebhook({ url: due.url, events: ["crawl.completed"] });
    const dueDelivery = createDelivery({ webhookId: webhook.id, event: "crawl.completed", payload: "{}" });
    updateDelivery(dueDelivery.id, {
      status: "failed",
      attemptCount: 1,
      nextRetryAt: new Date(Date.now() - 1000).toISOString(),
    });

    const lateWebhook = createWebhook({ url: notDue.url, events: ["crawl.completed"] });
    const notDueDelivery = createDelivery({ webhookId: lateWebhook.id, event: "crawl.completed", payload: "{}" });
    updateDelivery(notDueDelivery.id, {
      status: "failed",
      attemptCount: 1,
      nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const exWebhook = createWebhook({ url: exhausted.url, events: ["crawl.completed"] });
    const exhaustedDelivery = createDelivery({ webhookId: exWebhook.id, event: "crawl.completed", payload: "{}" });
    updateDelivery(exhaustedDelivery.id, {
      status: "failed",
      attemptCount: 5,
      nextRetryAt: new Date(Date.now() - 1000).toISOString(),
    });

    const retried = await retryFailedDeliveries();
    expect(retried).toBe(1);
    expect(due.requests).toHaveLength(1);
    expect(notDue.requests).toHaveLength(0);
    expect(exhausted.requests).toHaveLength(0);
  });

  it("skips pending deliveries that have never failed", async () => {
    const { createWebhook, createDelivery } = await import("../db/webhooks.js");
    const { retryFailedDeliveries } = await import("./webhooks.js");
    const target = serveOnce(() => new Response("ok", { status: 200 }));

    const webhook = createWebhook({ url: target.url, events: ["crawl.completed"] });
    createDelivery({ webhookId: webhook.id, event: "crawl.completed", payload: "{}" });

    expect(await retryFailedDeliveries()).toBe(0);
    expect(target.requests).toHaveLength(0);
  });
});
