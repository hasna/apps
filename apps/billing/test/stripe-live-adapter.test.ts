import { afterEach, describe, expect, it } from "bun:test";
import { LiveStripeAdapter, getStripeAdapter } from "../src/adapters/stripe.js";

afterEach(() => {
  delete process.env["HASNA_BILLING_LIVE_UPSTREAM"];
  delete process.env["HASNA_BILLING_STRIPE_SECRET_KEY"];
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("LiveStripeAdapter", () => {
  it("fails closed when live mode is requested without a Stripe secret key", () => {
    process.env["HASNA_BILLING_LIVE_UPSTREAM"] = "1";
    expect(() => getStripeAdapter()).toThrow(/secret key/);
  });

  it("uses Stripe API paths, bearer auth, and idempotency headers without real network calls", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const adapter = new LiveStripeAdapter({
      apiKey: "sk_unit_redacted",
      baseUrl: "https://stripe.test/v1",
      fetch: async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith("/customers")) return jsonResponse({ id: "cus_live_1", email: "buyer@example.com", delinquent: false });
        if (url.endsWith("/subscriptions")) {
          return jsonResponse({
            id: "sub_live_1",
            customer: "cus_live_1",
            status: "active",
            current_period_start: 1_800_000_000,
            current_period_end: 1_802_592_000,
          });
        }
        if (url.endsWith("/refunds")) return jsonResponse({ id: "re_live_1", charge: "ch_1", amount: 500, status: "succeeded" });
        throw new Error(`unexpected URL ${url}`);
      },
    });

    await adapter.createCustomer({ email: "buyer@example.com" });
    await adapter.createSubscription({ customer: "cus_live_1", plan: "price_1" });
    await adapter.createRefund({ charge: "ch_1", amount: 500, reason: "requested_by_customer" });

    expect(calls.map((c) => c.url)).toEqual([
      "https://stripe.test/v1/customers",
      "https://stripe.test/v1/subscriptions",
      "https://stripe.test/v1/refunds",
    ]);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(["Bearer", "sk_unit_redacted"].join(" "));
    expect((calls[1]!.init.headers as Record<string, string>)["Idempotency-Key"]).toBe("sub:create:cus_live_1:price_1");
    expect((calls[2]!.init.headers as Record<string, string>)["Idempotency-Key"]).toBe("refund:ch_1:500");
  });
});
