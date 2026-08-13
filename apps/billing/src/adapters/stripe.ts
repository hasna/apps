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

export interface StripeProductRef {
  id: string;
  name: string;
  active: boolean;
}

export interface StripePriceRef {
  id: string;
  product: string;
  currency: string;
  unit_amount: number;
  recurring_interval: string | null;
}

export interface StripeRefundResult {
  id: string;
  charge: string;
  amount: number;
  status: string;
}

export interface StripeDisputeRef {
  id: string;
  charge: string;
  amount: number;
  status: string;
}

/** Result of verifying a Stripe webhook signature (fail-closed). */
export interface StripeWebhookCheck {
  ok: boolean;
  reason?: string;
}

export interface StripeAdapter {
  readonly kind: "mock" | "live";
  createCustomer(input: { email: string; name?: string | null; currency?: string }): Promise<StripeCustomerRef>;
  createProduct(input: { name: string; active?: boolean }): Promise<StripeProductRef>;
  createPrice(input: { product: string; currency: string; unit_amount: number; recurring_interval?: string | null }): Promise<StripePriceRef>;
  createSubscription(input: { customer: string; plan: string }): Promise<StripeSubscriptionRef>;
  cancelSubscription(id: string): Promise<StripeSubscriptionRef>;
  updateSubscriptionPlan(id: string, plan: string): Promise<StripeSubscriptionRef>;
  listPaymentMethods(customer: string): Promise<unknown[]>;
  /** Attempt to (re)collect an invoice — the core dunning retry primitive. */
  retryInvoicePayment(input: { invoice_id: string; amount: number }): Promise<StripeChargeResult>;
  createRefund(input: { charge: string; amount: number; reason?: string }): Promise<StripeRefundResult>;
  listDisputes(input?: { charge?: string }): Promise<StripeDisputeRef[]>;
  recordMeteredUsage(input: { subscription_item: string; quantity: number; timestamp?: number; idempotencyKey: string }): Promise<{ id: string }>;
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

  async createProduct(input: { name: string; active?: boolean }): Promise<StripeProductRef> {
    return { id: this.nextId("prod"), name: input.name, active: input.active ?? true };
  }

  async createPrice(input: { product: string; currency: string; unit_amount: number; recurring_interval?: string | null }): Promise<StripePriceRef> {
    return {
      id: this.nextId("price"),
      product: input.product,
      currency: input.currency,
      unit_amount: input.unit_amount,
      recurring_interval: input.recurring_interval ?? null,
    };
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

  async listPaymentMethods(): Promise<unknown[]> {
    return [];
  }

  async retryInvoicePayment(input: { invoice_id: string; amount: number }): Promise<StripeChargeResult> {
    const queue = this.scripted.get(input.invoice_id);
    if (queue && queue.length > 0) {
      const next = queue.shift() as StripeChargeResult;
      return { ...next, invoice_id: input.invoice_id, amount: input.amount };
    }
    return { paid: true, invoice_id: input.invoice_id, amount: input.amount, decline_code: null };
  }

  async createRefund(input: { charge: string; amount: number; reason?: string }): Promise<StripeRefundResult> {
    return { id: this.nextId("re"), charge: input.charge, amount: input.amount, status: "succeeded" };
  }

  async listDisputes(input: { charge?: string } = {}): Promise<StripeDisputeRef[]> {
    return input.charge ? [] : [];
  }

  async recordMeteredUsage(input: { subscription_item: string; quantity: number; timestamp?: number; idempotencyKey: string }): Promise<{ id: string }> {
    return { id: `usage_${input.idempotencyKey}` };
  }

  signWebhook(payload: string, secret: string, timestampSeconds?: number): string {
    return signWebhookPayload(payload, secret, timestampSeconds);
  }

  verifyWebhook(payload: string, header: string, secret: string, toleranceSeconds?: number): StripeWebhookCheck {
    return verifyWebhookSignature(payload, header, secret, toleranceSeconds);
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface LiveStripeAdapterOptions {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
}

export class LiveStripeAdapter implements StripeAdapter {
  readonly kind = "live" as const;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(options: LiveStripeAdapterOptions) {
    if (!options.apiKey || !options.apiKey.startsWith("sk_")) {
      throw new Error("Live Stripe adapter requires a Stripe secret key (sk_*)");
    }
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.stripe.com/v1";
  }

  private async request(path: string, body?: URLSearchParams, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Stripe-Version": "2024-06-20",
    };
    const init: RequestInit = { method: body ? "POST" : "GET", headers };
    if (body) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = body;
    }
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const message =
        typeof json.error === "object" && json.error && "message" in json.error
          ? String((json.error as { message?: unknown }).message)
          : `Stripe request failed with HTTP ${res.status}`;
      throw new Error(message);
    }
    return json;
  }

  async createCustomer(input: { email: string; name?: string | null; currency?: string }): Promise<StripeCustomerRef> {
    const body = new URLSearchParams({ email: input.email });
    if (input.name) body.set("name", input.name);
    if (input.currency) body.set("preferred_locales[0]", input.currency.toLowerCase());
    const json = await this.request("/customers", body);
    return { id: String(json.id), email: String(json.email ?? input.email), delinquent: Boolean(json.delinquent) };
  }

  async createProduct(input: { name: string; active?: boolean }): Promise<StripeProductRef> {
    const body = new URLSearchParams({ name: input.name, active: String(input.active ?? true) });
    const json = await this.request("/products", body);
    return { id: String(json.id), name: String(json.name ?? input.name), active: Boolean(json.active ?? true) };
  }

  async createPrice(input: { product: string; currency: string; unit_amount: number; recurring_interval?: string | null }): Promise<StripePriceRef> {
    const body = new URLSearchParams({
      product: input.product,
      currency: input.currency.toLowerCase(),
      unit_amount: String(input.unit_amount),
    });
    if (input.recurring_interval) body.set("recurring[interval]", input.recurring_interval);
    const json = await this.request("/prices", body);
    return {
      id: String(json.id),
      product: String(json.product ?? input.product),
      currency: String(json.currency ?? input.currency),
      unit_amount: Number(json.unit_amount ?? input.unit_amount),
      recurring_interval:
        typeof json.recurring === "object" && json.recurring && "interval" in json.recurring
          ? String((json.recurring as { interval?: unknown }).interval)
          : null,
    };
  }

  async createSubscription(input: { customer: string; plan: string }): Promise<StripeSubscriptionRef> {
    const body = new URLSearchParams({ customer: input.customer, "items[0][price]": input.plan });
    const json = await this.request("/subscriptions", body, `sub:create:${input.customer}:${input.plan}`);
    return this.subscriptionFromJson(json, input.plan);
  }

  async cancelSubscription(id: string): Promise<StripeSubscriptionRef> {
    const json = await this.request(`/subscriptions/${encodeURIComponent(id)}/cancel`, new URLSearchParams(), `sub:cancel:${id}`);
    return this.subscriptionFromJson(json, "");
  }

  async updateSubscriptionPlan(id: string, plan: string): Promise<StripeSubscriptionRef> {
    const body = new URLSearchParams({ "items[0][price]": plan });
    const json = await this.request(`/subscriptions/${encodeURIComponent(id)}`, body, `sub:update:${id}:${plan}`);
    return this.subscriptionFromJson(json, plan);
  }

  async listPaymentMethods(customer: string): Promise<unknown[]> {
    const json = await this.request(`/payment_methods?customer=${encodeURIComponent(customer)}&type=card`);
    return Array.isArray(json.data) ? json.data : [];
  }

  async retryInvoicePayment(input: { invoice_id: string; amount: number }): Promise<StripeChargeResult> {
    const json = await this.request(`/invoices/${encodeURIComponent(input.invoice_id)}/pay`, new URLSearchParams(), `invoice:pay:${input.invoice_id}`);
    return {
      paid: json.status === "paid" || json.paid === true,
      invoice_id: String(json.id ?? input.invoice_id),
      amount: Number(json.amount_paid ?? input.amount),
      decline_code: null,
    };
  }

  async createRefund(input: { charge: string; amount: number; reason?: string }): Promise<StripeRefundResult> {
    const body = new URLSearchParams({ charge: input.charge, amount: String(input.amount) });
    if (input.reason) body.set("reason", input.reason);
    const json = await this.request("/refunds", body, `refund:${input.charge}:${input.amount}`);
    return { id: String(json.id), charge: String(json.charge ?? input.charge), amount: Number(json.amount ?? input.amount), status: String(json.status ?? "pending") };
  }

  async listDisputes(input: { charge?: string } = {}): Promise<StripeDisputeRef[]> {
    const path = input.charge ? `/disputes?charge=${encodeURIComponent(input.charge)}` : "/disputes";
    const json = await this.request(path);
    const rows = Array.isArray(json.data) ? json.data : [];
    return rows.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        id: String(item.id),
        charge: String(item.charge ?? input.charge ?? ""),
        amount: Number(item.amount ?? 0),
        status: String(item.status ?? "unknown"),
      };
    });
  }

  async recordMeteredUsage(input: { subscription_item: string; quantity: number; timestamp?: number; idempotencyKey: string }): Promise<{ id: string }> {
    const body = new URLSearchParams({
      quantity: String(input.quantity),
      timestamp: String(input.timestamp ?? Math.floor(Date.now() / 1000)),
      action: "increment",
    });
    const json = await this.request(`/subscription_items/${encodeURIComponent(input.subscription_item)}/usage_records`, body, input.idempotencyKey);
    return { id: String(json.id) };
  }

  signWebhook(payload: string, secret: string, timestampSeconds?: number): string {
    return signWebhookPayload(payload, secret, timestampSeconds);
  }

  verifyWebhook(payload: string, header: string, secret: string, toleranceSeconds?: number): StripeWebhookCheck {
    return verifyWebhookSignature(payload, header, secret, toleranceSeconds);
  }

  private subscriptionFromJson(json: Record<string, unknown>, fallbackPlan: string): StripeSubscriptionRef {
    const start = Number(json.current_period_start ?? 0);
    const end = Number(json.current_period_end ?? 0);
    return {
      id: String(json.id),
      customer: String(json.customer ?? "unknown"),
      status: String(json.status ?? "active"),
      current_period_start: start > 0 ? new Date(start * 1000).toISOString() : new Date().toISOString(),
      current_period_end: end > 0 ? new Date(end * 1000).toISOString() : new Date().toISOString(),
      plan: fallbackPlan,
    };
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
    const key = process.env["HASNA_BILLING_STRIPE_SECRET_KEY"] || process.env["STRIPE_SECRET_KEY"] || "";
    return new LiveStripeAdapter({ apiKey: key });
  }
  if (!_default) _default = new MockStripeAdapter();
  return _default;
}

/** Test/bootstrap hook to inject a specific adapter instance. */
export function setStripeAdapter(adapter: StripeAdapter | null): void {
  _default = adapter;
}
