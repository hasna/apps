import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DeclineCode } from "../types/index.js";

/**
 * Stripe Billing adapter INTERFACE + MOCK implementation (BUILD-SPEC §1/§1a).
 *
 * Billing is a THIN orchestration layer over Stripe Billing — it does NOT
 * reimplement the billing engine. All Stripe interaction goes through this
 * interface so v0 is buildable/testable in isolation with a deterministic mock
 * (no live keys), and v1 can swap in a live Stripe client behind the same
 * contract (gated by HASNA_BILLING_LIVE_UPSTREAM=1).
 */

export interface StripeCustomerRef {
  id: string;
  email: string;
  delinquent: boolean;
}

export interface StripeSubscriptionRef {
  id: string;
  customer: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  plan: string;
}

export interface StripeChargeResult {
  paid: boolean;
  invoice_id: string;
  amount: number;
  decline_code: DeclineCode | null;
}

/** Result of verifying a Stripe webhook signature (fail-closed). */
export interface StripeWebhookCheck {
  ok: boolean;
  reason?: string;
}

export interface StripeAdapter {
  readonly kind: "mock" | "live";
  createCustomer(input: { email: string; name?: string | null; currency?: string }): Promise<StripeCustomerRef>;
  createSubscription(input: { customer: string; plan: string }): Promise<StripeSubscriptionRef>;
  cancelSubscription(id: string): Promise<StripeSubscriptionRef>;
  updateSubscriptionPlan(id: string, plan: string): Promise<StripeSubscriptionRef>;
  /** Attempt to (re)collect an invoice — the core dunning retry primitive. */
  retryInvoicePayment(input: { invoice_id: string; amount: number }): Promise<StripeChargeResult>;
  /**
   * Produce a Stripe-style `Stripe-Signature` header value (`t=<unix>,v1=<hex
   * hmac-sha256>`) over the raw payload. Deterministic; used by the mock and by
   * tests. Real Stripe signs upstream — a live adapter never needs to sign, but
   * MUST implement `verifyWebhook` with the same algorithm.
   */
  signWebhook(payload: string, secret: string, timestampSeconds?: number): string;
  /**
   * Verify a `Stripe-Signature` header against the raw payload using a
   * timing-safe HMAC-SHA256 compare plus a replay/tolerance window. Fail-closed:
   * unsigned/malformed/expired/mismatched signatures return `{ ok: false }`.
   */
  verifyWebhook(payload: string, header: string, secret: string, toleranceSeconds?: number): StripeWebhookCheck;
}

/** Default replay-protection window for webhook timestamps (seconds). */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

function computeWebhookHmac(payload: string, secret: string, timestampSeconds: number): string {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${payload}`).digest("hex");
}

/** Sign a raw payload → `t=<unix>,v1=<hmac-sha256>` (Stripe scheme). */
export function signWebhookPayload(
  payload: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestampSeconds},v1=${computeWebhookHmac(payload, secret, timestampSeconds)}`;
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Verify a `Stripe-Signature` header (timing-safe HMAC-SHA256 + replay window).
 * This is the exact algorithm Stripe uses, so a live adapter can delegate here.
 */
export function verifyWebhookSignature(
  payload: string,
  header: string,
  secret: string,
  toleranceSeconds: number = DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
): StripeWebhookCheck {
  if (!secret) return { ok: false, reason: "no signing secret configured" };
  if (!header) return { ok: false, reason: "missing signature header" };
  const parts: Record<string, string> = {};
  for (const kv of header.split(",")) {
    const idx = kv.indexOf("=");
    if (idx <= 0) continue;
    parts[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  }
  const t = Number.parseInt(parts["t"] ?? "", 10);
  const v1 = parts["v1"] ?? "";
  if (!Number.isFinite(t) || !v1) return { ok: false, reason: "malformed signature header" };
  const age = Math.abs(Math.floor(Date.now() / 1000) - t);
  if (age > toleranceSeconds) return { ok: false, reason: "signature timestamp outside tolerance window (replay)" };
  if (!timingSafeHexEqual(computeWebhookHmac(payload, secret, t), v1)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

/**
 * Deterministic mock. Charge outcome is driven by a per-invoice scripted queue
 * (set via `scriptCharge`) so dunning golden tests are reproducible; unset
 * invoices default to success.
 */
export class MockStripeAdapter implements StripeAdapter {
  readonly kind = "mock" as const;
  private seq = 0;
  private readonly scripted = new Map<string, StripeChargeResult[]>();

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_mock_${this.seq.toString().padStart(6, "0")}`;
  }

  /** Queue scripted charge outcomes for an invoice (consumed in order). */
  scriptCharge(invoiceId: string, results: StripeChargeResult[]): void {
    this.scripted.set(invoiceId, [...results]);
  }

  async createCustomer(input: { email: string; name?: string | null; currency?: string }): Promise<StripeCustomerRef> {
    return { id: this.nextId("cus"), email: input.email, delinquent: false };
  }

  async createSubscription(input: { customer: string; plan: string }): Promise<StripeSubscriptionRef> {
    const start = new Date();
    const end = new Date(start.getTime() + 30 * 24 * 3600 * 1000);
    return {
      id: this.nextId("sub"),
      customer: input.customer,
      status: "active",
      current_period_start: start.toISOString(),
      current_period_end: end.toISOString(),
      plan: input.plan,
    };
  }

  async cancelSubscription(id: string): Promise<StripeSubscriptionRef> {
    const now = new Date().toISOString();
    return { id, customer: "unknown", status: "canceled", current_period_start: now, current_period_end: now, plan: "" };
  }

  async updateSubscriptionPlan(id: string, plan: string): Promise<StripeSubscriptionRef> {
    const now = new Date().toISOString();
    return { id, customer: "unknown", status: "active", current_period_start: now, current_period_end: now, plan };
  }

  async retryInvoicePayment(input: { invoice_id: string; amount: number }): Promise<StripeChargeResult> {
    const queue = this.scripted.get(input.invoice_id);
    if (queue && queue.length > 0) {
      const next = queue.shift() as StripeChargeResult;
      return { ...next, invoice_id: input.invoice_id, amount: input.amount };
    }
    return { paid: true, invoice_id: input.invoice_id, amount: input.amount, decline_code: null };
  }

  signWebhook(payload: string, secret: string, timestampSeconds?: number): string {
    return signWebhookPayload(payload, secret, timestampSeconds);
  }

  verifyWebhook(payload: string, header: string, secret: string, toleranceSeconds?: number): StripeWebhookCheck {
    return verifyWebhookSignature(payload, header, secret, toleranceSeconds);
  }
}

let _default: StripeAdapter | null = null;

/**
 * Resolve the Stripe adapter. v0 always returns the mock. A live adapter is
 * only wired behind HASNA_BILLING_LIVE_UPSTREAM=1 (not in this cohort); until
 * then, requesting live fails closed rather than silently mocking money moves.
 */
export function getStripeAdapter(): StripeAdapter {
  if (process.env["HASNA_BILLING_LIVE_UPSTREAM"] === "1") {
    throw new Error(
      "Live Stripe adapter is not enabled in this build (v0). Unset HASNA_BILLING_LIVE_UPSTREAM to use the mock.",
    );
  }
  if (!_default) _default = new MockStripeAdapter();
  return _default;
}

/** Test/bootstrap hook to inject a specific adapter instance. */
export function setStripeAdapter(adapter: StripeAdapter | null): void {
  _default = adapter;
}
