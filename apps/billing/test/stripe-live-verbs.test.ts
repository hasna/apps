// Sol-guided coverage (tests-coverage-sol workflow, 2026-08-19).
//
// Priority 4 — the remaining LiveStripeAdapter verbs through a fake fetch
// that records URL, method, body, and idempotency headers (never calls
// Stripe): retryInvoicePayment (invoice:pay + paid mapping), cancellation
// (sub:cancel), plan changes (sub:update), disputes/payment-methods/metered
// usage serialization, and the non-2xx "Stripe request failed with HTTP n"
// fallback message when the error body carries no message.

import { afterEach, describe, expect, it } from "bun:test";
import { LiveStripeAdapter } from "../src/adapters/stripe.js";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: URLSearchParams | null;
}

function recordingFetch(calls: Call[], handler: (url: string) => Response) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({
      url,
      method: String(init.method ?? "GET"),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body instanceof URLSearchParams ? init.body : null,
    });
    return handler(url);
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function liveAdapter(calls: Call[], handler: (url: string) => Response): LiveStripeAdapter {
  return new LiveStripeAdapter({
    apiKey: "sk_test_coverage",
    baseUrl: "https://stripe.test/v1",
    fetch: recordingFetch(calls, handler),
  });
}

afterEach(() => {
  delete process.env["HASNA_BILLING_LIVE_UPSTREAM"];
  delete process.env["HASNA_BILLING_STRIPE_SECRET_KEY"];
});

describe("retryInvoicePayment", () => {
  it("calls POST /invoices/:id/pay with the invoice:pay idempotency key and maps paid from status", async () => {
    const calls: Call[] = [];
    const live = liveAdapter(calls, (url) =>
      url.endsWith("/invoices/in_1/pay")
        ? jsonResponse({ id: "in_1", status: "paid", amount_paid: 2500 })
        : jsonResponse({}, 404),
    );

    const result = await live.retryInvoicePayment({ invoice_id: "in_1", amount: 2500 });
    expect(result.paid).toBe(true);
    expect(result.amount).toBe(2500);
    expect(result.invoice_id).toBe("in_1");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://stripe.test/v1/invoices/in_1/pay");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers["Idempotency-Key"]).toBe("invoice:pay:in_1");
  });

  it("maps paid from the boolean paid field when status is absent", async () => {
    const calls: Call[] = [];
    const live = liveAdapter(calls, () => jsonResponse({ id: "in_2", paid: true }));
    const result = await live.retryInvoicePayment({ invoice_id: "in_2", amount: 100 });
    expect(result.paid).toBe(true);
    // amount falls back to the input amount when amount_paid is missing.
    expect(result.amount).toBe(100);
  });

  it("reports unpaid when the invoice is not paid", async () => {
    const calls: Call[] = [];
    const live = liveAdapter(calls, () => jsonResponse({ id: "in_3", status: "open" }));
    const result = await live.retryInvoicePayment({ invoice_id: "in_3", amount: 100 });
    expect(result.paid).toBe(false);
  });
});

describe("cancellation and plan changes", () => {
  it("cancels via POST /subscriptions/:id/cancel with sub:cancel idempotency", async () => {
    const calls: Call[] = [];
    const live = liveAdapter(calls, () =>
      jsonResponse({ id: "sub_1", customer: "cus_1", status: "canceled", current_period_start: 0, current_period_end: 0 }),
    );
    const result = await live.cancelSubscription("sub_1");
    expect(result.id).toBe("sub_1");
    expect(result.status).toBe("canceled");
    expect(calls[0]!.url).toBe("https://stripe.test/v1/subscriptions/sub_1/cancel");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers["Idempotency-Key"]).toBe("sub:cancel:sub_1");
  });

  it("changes plans via POST /subscriptions/:id with the new price and sub:update idempotency", async () => {
    const calls: Call[] = [];
    const live = liveAdapter(calls, () =>
      jsonResponse({ id: "sub_1", customer: "cus_1", status: "active", current_period_start: 0, current_period_end: 0 }),
    );
    const result = await live.updateSubscriptionPlan("sub_1", "price_basic");
    expect(result.plan).toBe("price_basic");
    expect(calls[0]!.url).toBe("https://stripe.test/v1/subscriptions/sub_1");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers["Idempotency-Key"]).toBe("sub:update:sub_1:price_basic");
    expect(calls[0]!.body!.get("items[0][price]")).toBe("price_basic");
  });
});

describe("serialization of disputes, payment methods, and metered usage", () => {
  it("lists disputes with the charge filter on the query string", async () => {
    const calls: Call[] = [];
    const live = liveAdapter(calls, () => jsonResponse({ data: [{ id: "dp_1", charge: "ch_1", amount: 500, status: "needs_response" }] }));
    const disputes = await live.listDisputes({ charge: "ch_1" });
    expect(disputes).toEqual([{ id: "dp_1", charge: "ch_1", amount: 500, status: "needs_response" }]);
    expect(calls[0]!.url).toBe("https://stripe.test/v1/disputes?charge=ch_1");
    expect(calls[0]!.method).toBe("GET");
  });

  it("lists payment methods with the customer and type filters", async () => {
    const calls: Call[] = [];
    const live = liveAdapter(calls, () => jsonResponse({ data: [{ id: "pm_1" }] }));
    const methods = await live.listPaymentMethods("cus_1");
    expect(methods).toEqual([{ id: "pm_1" }]);
    expect(calls[0]!.url).toBe("https://stripe.test/v1/payment_methods?customer=cus_1&type=card");
    expect(calls[0]!.method).toBe("GET");
  });

  it("records metered usage with quantity/timestamp/action=increment and the caller idempotency key", async () => {
    const calls: Call[] = [];
    const live = liveAdapter(calls, () => jsonResponse({ id: "usage_1" }));
    const result = await live.recordMeteredUsage({
      subscription_item: "si_1",
      quantity: 3,
      timestamp: 1_700_000_000,
      idempotencyKey: "usage:si_1:1700000000",
    });
    expect(result).toEqual({ id: "usage_1" });
    expect(calls[0]!.url).toBe("https://stripe.test/v1/subscription_items/si_1/usage_records");
    expect(calls[0]!.headers["Idempotency-Key"]).toBe("usage:si_1:1700000000");
    expect(calls[0]!.body!.get("quantity")).toBe("3");
    expect(calls[0]!.body!.get("timestamp")).toBe("1700000000");
    expect(calls[0]!.body!.get("action")).toBe("increment");
  });

  it("creates refunds with charge/amount/reason and the refund idempotency key", async () => {
    const calls: Call[] = [];
    const live = liveAdapter(calls, () => jsonResponse({ id: "re_1", charge: "ch_1", amount: 500, status: "succeeded" }));
    const result = await live.createRefund({ charge: "ch_1", amount: 500, reason: "requested_by_customer" });
    expect(result).toEqual({ id: "re_1", charge: "ch_1", amount: 500, status: "succeeded" });
    expect(calls[0]!.url).toBe("https://stripe.test/v1/refunds");
    expect(calls[0]!.headers["Idempotency-Key"]).toBe("refund:ch_1:500");
    expect(calls[0]!.body!.get("reason")).toBe("requested_by_customer");
  });
});

describe("non-2xx failure mapping", () => {
  it("throws 'Stripe request failed with HTTP n' when the error body carries no message", async () => {
    const calls: Call[] = [];
    const live = liveAdapter(calls, () => jsonResponse({ error: { code: "rate_limit" } }, 429));
    await expect(live.retryInvoicePayment({ invoice_id: "in_1", amount: 100 })).rejects.toThrow(
      "Stripe request failed with HTTP 429",
    );
  });

  it("prefers the Stripe error message when the body carries one", async () => {
    const calls: Call[] = [];
    const live = liveAdapter(calls, () => jsonResponse({ error: { message: "card declined" } }, 402));
    await expect(live.retryInvoicePayment({ invoice_id: "in_1", amount: 100 })).rejects.toThrow("card declined");
  });
});
