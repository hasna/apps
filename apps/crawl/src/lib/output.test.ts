import { describe, expect, it } from "bun:test";
import { compactDelivery, compactPage, compactWebhook, parseLimit, truncateText } from "./output.js";
import type { Page, Webhook, WebhookDelivery } from "../types/index.js";

describe("compact output helpers", () => {
  it("truncates long text and clamps human limits", () => {
    expect(truncateText("alpha   beta\n gamma", 40)).toBe("alpha beta gamma");
    expect(truncateText("x".repeat(20), 10)).toBe("xxxxxxxxx…");
    expect(parseLimit(undefined, 20)).toBe(20);
    expect(parseLimit("500", 20, 100)).toBe(100);
    expect(parseLimit("not-a-number", 20)).toBe(20);
  });

  it("keeps compact pages free of full body fields", () => {
    const page: Page = {
      id: "page-1",
      crawlId: "crawl-1",
      url: "https://example.com/a",
      statusCode: 200,
      contentType: "text/html",
      title: "Example",
      description: "Description",
      textContent: "Visible body ".repeat(200),
      markdownContent: "# Visible body\n".repeat(200),
      htmlContent: "<h1>Visible body</h1>",
      metadata: { links: [{ href: "https://example.com/b", text: "B" }] },
      screenshotPath: null,
      wordCount: 400,
      byteSize: 1234,
      crawledAt: "2026-01-01T00:00:00.000Z",
    };

    const compact = compactPage(page, { includePreview: true, previewChars: 80 });
    expect(compact).not.toHaveProperty("textContent");
    expect(compact).not.toHaveProperty("markdownContent");
    expect(compact).not.toHaveProperty("htmlContent");
    expect(compact.preview?.length).toBeLessThanOrEqual(80);
  });

  it("omits webhook secrets and delivery payloads by default", () => {
    const webhook: Webhook = {
      id: "webhook-1",
      url: "https://example.com/webhook",
      events: ["crawl.completed"],
      secret: "super-secret",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastTriggeredAt: null,
      failureCount: 0,
    };
    const delivery: WebhookDelivery = {
      id: "delivery-1",
      webhookId: webhook.id,
      event: "crawl.completed",
      payload: JSON.stringify({ body: "payload ".repeat(200) }),
      status: "failed",
      httpStatus: 500,
      responseBody: "response ".repeat(200),
      attemptCount: 2,
      nextRetryAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      deliveredAt: null,
    };

    expect(compactWebhook(webhook)).toEqual(expect.objectContaining({ hasSecret: true }));
    expect(compactWebhook(webhook)).not.toHaveProperty("secret");
    expect(compactDelivery(delivery)).not.toHaveProperty("payload");
    expect(compactDelivery(delivery)).not.toHaveProperty("responseBody");
    expect(compactDelivery(delivery, { verbose: true }).payloadPreview).toContain("payload");
  });
});
