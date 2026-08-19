// Agent-authored (SOL consult refused: "Selected model is at capacity" on two
// distinct healthy Codewith accounts — no SOL opinion was produced for this repo).
//
// Unit tests for the Stripe webhook signature verification (fail-closed
// matrix, tolerance boundary, multi-part headers) and the LiveStripeAdapter
// guards (key shape, HTTP error mapping, idempotency headers) using a
// deterministic fetch stub. A regression here means forged webhooks can pass
// verification or live money moves fire without an idempotency key.

import { describe, expect, it } from "bun:test";
import {
  LiveStripeAdapter,
  MockStripeAdapter,
  signWebhookPayload,
  verifyWebhookSignature,
} from "../src/adapters/stripe.js";

const SECRET = "whsec_unit_test_secret";
const PAYLOAD = JSON.stringify({ id: "evt_1", type: "invoice.paid", data: {} });

function t(offsetSeconds: number): number {
  return Math.floor(Date.now() / 1000) + offsetSeconds;
}

describe("verifyWebhookSignature — fail-closed matrix", () => {
  it("refuses without a signing secret", () => {
    expect(verifyWebhookSignature(PAYLOAD, "t=1,v1=abc", "")).toEqual({ ok: false, reason: "no signing secret configured" });
  });

  it("refuses a missing header", () => {
    expect(verifyWebhookSignature(PAYLOAD, "", SECRET)).toEqual({ ok: false, reason: "missing signature header" });
  });

  it("refuses a malformed header (non-numeric t or missing v1)", () => {
    expect(verifyWebhookSignature(PAYLOAD, "t=abc,v1=xyz", SECRET)).toEqual({ ok: false, reason: "malformed signature header" });
    expect(verifyWebhookSignature(PAYLOAD, "t=1234", SECRET)).toEqual({ ok: false, reason: "malformed signature header" });
  });

  it("refuses a signature computed over different bytes (mismatch)", () => {
    const header = signWebhookPayload("different-payload", SECRET, t(0));
    const result = verifyWebhookSignature(PAYLOAD, header, SECRET);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("signature mismatch");
  });

  it("refuses a replayed signature outside the tolerance window", () => {
    const header = signWebhookPayload(PAYLOAD, SECRET, t(-1000));
    expect(verifyWebhookSignature(PAYLOAD, header, SECRET)).toEqual({
      ok: false,
      reason: "signature timestamp outside tolerance window (replay)",
    });
  });

  it("accepts a signature exactly at the tolerance boundary", () => {
    const header = signWebhookPayload(PAYLOAD, SECRET, t(-300));
    // age is 300 or 301 by the time verify runs; 301 tolerance must accept both.
    expect(verifyWebhookSignature(PAYLOAD, header, SECRET, 301)).toEqual({ ok: true });
  });

  it("accepts a freshly signed payload round-trip", () => {
    const header = signWebhookPayload(PAYLOAD, SECRET);
    expect(verifyWebhookSignature(PAYLOAD, header, SECRET)).toEqual({ ok: true });
  });

  it("skips malformed comma-separated parts and uses the well-formed ones", () => {
    const good = signWebhookPayload(PAYLOAD, SECRET, t(0));
    const header = `t=${good.split("t=")[1]!.split(",")[0]},junk-part,v1=${good.split("v1=")[1]!}`;
    expect(verifyWebhookSignature(PAYLOAD, header, SECRET)).toEqual({ ok: true });
  });

  it("returns false for a wrong-length v1 without leaking timing behavior", () => {
    const header = `t=${t(0)},v1=abc`;
    expect(verifyWebhookSignature(PAYLOAD, header, SECRET).ok).toBe(false);
  });
});

describe("signWebhookPayload determinism", () => {
  it("produces the same signature for the same payload, secret, and timestamp", () => {
    const a = signWebhookPayload(PAYLOAD, SECRET, 1_700_000_000);
    const b = signWebhookPayload(PAYLOAD, SECRET, 1_700_000_000);
    expect(a).toBe(b);
    expect(a).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
  });

  it("the mock adapter signs with the same scheme the verifier accepts", () => {
    const mock = new MockStripeAdapter();
    const header = mock.signWebhook(PAYLOAD, SECRET, 1_700_000_000);
    // Signature is deterministic, but the timestamp is historical → verify must
    // fail on replay, proving the mock signature is bound to the payload.
    expect(verifyWebhookSignature(PAYLOAD, header, SECRET).ok).toBe(false);
    expect(mock.verifyWebhook(PAYLOAD, mock.signWebhook(PAYLOAD, SECRET), SECRET).ok).toBe(true);
  });
});

describe("LiveStripeAdapter guards", () => {
  it("refuses to construct without a Stripe secret key (sk_*)", () => {
    expect(() => new LiveStripeAdapter({ apiKey: "" })).toThrow(/sk_/);
    expect(() => new LiveStripeAdapter({ apiKey: "pk_live_123" })).toThrow(/sk_/);
  });

  it("maps a Stripe error body to its message and sends auth + version headers", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchStub = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ error: { message: "card declined" } }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      });
    };
    const live = new LiveStripeAdapter({ apiKey: "sk_test_123", fetch: fetchStub as unknown as typeof fetch });
    await expect(live.createCustomer({ email: "a@b.com" })).rejects.toThrow("card declined");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/customers");
    expect((calls[0]!.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sk_test_123");
    expect((calls[0]!.init.headers as Record<string, string>)["Stripe-Version"]).toBe("2024-06-20");
  });

  it("sends an Idempotency-Key on mutating subscription calls", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchStub = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ id: "sub_1", customer: "cus_1", status: "active", current_period_start: 0, current_period_end: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const live = new LiveStripeAdapter({ apiKey: "sk_test_123", fetch: fetchStub as unknown as typeof fetch });
    await live.createSubscription({ customer: "cus_1", plan: "pro" });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toContain("sub:create:cus_1:pro");
    const body = calls[0]!.init.body as URLSearchParams;
    expect(body.get("items[0][price]")).toBe("pro");
    expect(body.get("customer")).toBe("cus_1");
  });
});
