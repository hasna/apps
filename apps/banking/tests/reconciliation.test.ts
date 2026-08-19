/**
 * TEST-GAP suite: reconciliation matrix and webhook normalization.
 *
 * AGENT-AUTHORED — the gpt-5.6-sol advisory consult was attempted on two
 * distinct provider accounts and refused at the capacity wall on both
 * ("Selected model is at capacity. Please try a different model."), so this
 * spec was produced from direct source analysis, not attributed to SOL.
 *
 * tests/core.test.ts covers only the no-intent indeterminate case and
 * tests/store.test.ts only the matched happy path. This file locks the full
 * matrix: currency mismatch, minor-unit mismatch, missing amount, reason
 * strings, and rawHash stability across JSON key order.
 */
import { describe, expect, test } from "bun:test";
import {
  createReconciliationHook,
  moneyFromDecimal,
  moneyFromMinor,
  normalizeProviderWebhookEvent,
  reconcileProviderEvent,
  type ProviderEvent,
} from "../src/index.ts";

function providerEvent(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
  return {
    id: "evt_recon_1",
    providerId: "mercury",
    kind: "payment",
    providerObjectId: "provider_payment_1",
    occurredAt: "2026-06-29T10:00:00.000Z",
    amount: moneyFromDecimal("10.00", "USD"),
    rawHash: "hash",
    ...overrides,
  };
}

describe("reconciliation status matrix", () => {
  test("matching intent, amount, and currency reconciles as matched", () => {
    const record = reconcileProviderEvent("intent_1", providerEvent(), moneyFromDecimal("10.00", "USD"));
    expect(record.status).toBe("matched");
    expect(record.reasons).toEqual(["Provider event matched local expectation."]);
    expect(record.intentId).toBe("intent_1");
    expect(record.providerEventId).toBe("evt_recon_1");
  });

  test("a different minor-unit amount is a mismatch", () => {
    const record = reconcileProviderEvent("intent_1", providerEvent(), moneyFromDecimal("10.01", "USD"));
    expect(record.status).toBe("mismatch");
    expect(record.reasons).toContain("Provider event amount does not match the expected intent amount.");
  });

  test("a different currency is a mismatch even at the same numeric value", () => {
    const record = reconcileProviderEvent("intent_1", providerEvent({ amount: moneyFromDecimal("10.00", "EUR") }), moneyFromDecimal("10.00", "USD"));
    expect(record.status).toBe("mismatch");
    expect(record.reasons).toContain("Provider event amount does not match the expected intent amount.");
  });

  test("an expected amount with no event amount is indeterminate", () => {
    const record = reconcileProviderEvent("intent_1", providerEvent({ amount: undefined as never }), moneyFromDecimal("10.00", "USD"));
    expect(record.status).toBe("indeterminate");
    expect(record.reasons).toContain("Provider event omitted an amount needed for reconciliation.");
  });

  test("no local intent is indeterminate even with a matching amount", () => {
    const record = reconcileProviderEvent(undefined, providerEvent(), moneyFromDecimal("10.00", "USD"));
    expect(record.status).toBe("indeterminate");
    expect(record.reasons).toContain("Provider event has no known local intent.");
    expect(record).not.toHaveProperty("intentId");
  });

  test("a mismatch takes precedence over a missing intent reason set", () => {
    const record = reconcileProviderEvent(undefined, providerEvent({ amount: moneyFromDecimal("1.00", "USD") }), moneyFromDecimal("10.00", "USD"));
    expect(record.status).toBe("mismatch");
    expect(record.reasons).toContain("Provider event amount does not match the expected intent amount.");
  });
});

describe("webhook normalization", () => {
  test("rawHash is stable across rawPayload key order", () => {
    const first = normalizeProviderWebhookEvent({
      id: "evt_hash_1",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "p_1",
      occurredAt: "2026-06-29T10:00:00.000Z",
      amount: moneyFromDecimal("5.00", "USD"),
      rawPayload: { id: "p_1", amount: "5.00", counterparty: { name: "V", id: "x" } },
    });
    const reordered = normalizeProviderWebhookEvent({
      id: "evt_hash_1",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "p_1",
      occurredAt: "2026-06-29T10:00:00.000Z",
      amount: moneyFromDecimal("5.00", "USD"),
      rawPayload: { counterparty: { id: "x", name: "V" }, amount: "5.00", id: "p_1" },
    });
    expect(first.rawHash).toBe(reordered.rawHash);
    expect(first.rawHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("different payloads produce different hashes", () => {
    const first = normalizeProviderWebhookEvent({
      id: "evt_hash_2",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "p_1",
      occurredAt: "2026-06-29T10:00:00.000Z",
      rawPayload: { id: "p_1", amount: "5.00" },
    });
    const second = normalizeProviderWebhookEvent({
      id: "evt_hash_2",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "p_1",
      occurredAt: "2026-06-29T10:00:00.000Z",
      rawPayload: { id: "p_1", amount: "6.00" },
    });
    expect(first.rawHash).not.toBe(second.rawHash);
  });

  test("omitted amounts stay absent from the normalized event", () => {
    const event = normalizeProviderWebhookEvent({
      id: "evt_no_amount",
      providerId: "mercury",
      kind: "transaction",
      providerObjectId: "t_1",
      occurredAt: "2026-06-29T10:00:00.000Z",
      rawPayload: { id: "t_1" },
    });
    expect(event).not.toHaveProperty("amount");
    expect(event.kind).toBe("transaction");
  });

  test("createReconciliationHook delegates to reconcileProviderEvent", () => {
    const event = normalizeProviderWebhookEvent({
      id: "evt_hook_1",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "p_1",
      occurredAt: "2026-06-29T10:00:00.000Z",
      amount: moneyFromMinor("100", "USD"),
      rawPayload: { id: "p_1", amount: "1.00" },
    });
    const record = createReconciliationHook({
      intentId: "intent_1",
      providerEvent: event,
      expectedAmount: moneyFromDecimal("1.00", "USD"),
    });
    expect(record.status).toBe("matched");
    expect(record.id).toBe(`recon_${event.id}`);
  });
});
