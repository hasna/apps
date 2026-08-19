/**
 * TEST-GAP suite: intent builder surface.
 *
 * AGENT-AUTHORED — the gpt-5.6-sol advisory consult was attempted on two
 * distinct provider accounts and refused at the capacity wall on both
 * ("Selected model is at capacity. Please try a different model."), so this
 * spec was produced from direct source analysis, not attributed to SOL.
 *
 * tests/sdk.test.ts only exercises createPaymentRequest through the client
 * facade. This file locks the other five builders: field presence, optional
 * omission, deterministic identity (same input -> same id and idempotency key
 * even when `now` moves), and envelope fingerprint/policy consistency.
 */
import { describe, expect, test } from "bun:test";
import {
  createBankingClient,
  createIntentFingerprint,
  moneyFromDecimal,
  type ActorRef,
  type CardLifecycleIntent,
  type CardRequestIntent,
  type CardUpdateIntent,
  type IntentEnvelope,
  type PaymentQuoteIntent,
  type PaymentStatusIntent,
} from "../src/index.ts";

const requester: ActorRef = { id: "agent-builders", type: "agent" };

function quoteOf(envelope: IntentEnvelope): PaymentQuoteIntent {
  if (envelope.intent.type !== "payment.quote") throw new Error("expected a payment quote intent");
  return envelope.intent;
}

function statusOf(envelope: IntentEnvelope): PaymentStatusIntent {
  if (envelope.intent.type !== "payment.status") throw new Error("expected a payment status intent");
  return envelope.intent;
}

function cardRequestOf(envelope: IntentEnvelope): CardRequestIntent {
  if (envelope.intent.type !== "card.request") throw new Error("expected a card request intent");
  return envelope.intent;
}

function cardUpdateOf(envelope: IntentEnvelope): CardUpdateIntent {
  if (envelope.intent.type !== "card.update") throw new Error("expected a card update intent");
  return envelope.intent;
}

function cardLifecycleOf(envelope: IntentEnvelope): CardLifecycleIntent {
  if (envelope.intent.type !== "card.lifecycle") throw new Error("expected a card lifecycle intent");
  return envelope.intent;
}

describe("intent builders", () => {
  test("payment quote builders carry quote fields and no approval linkage", () => {
    const client = createBankingClient();
    const envelope = client.createPaymentQuote({
      providerId: "mercury",
      requester,
      reason: "quote",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor", providerRecipientId: "recipient_1" },
      amount: moneyFromDecimal("10.00", "USD"),
      rail: "ach",
      now: new Date("2026-06-29T10:00:00.000Z"),
    });
    const intent = quoteOf(envelope);
    expect(intent.type).toBe("payment.quote");
    expect(intent.sourceAccountId).toBe("acct_1");
    expect(intent.amount).toEqual(moneyFromDecimal("10.00", "USD"));
    expect(intent.rail).toBe("ach");
    expect(intent.status).toBe("draft");
    expect(envelope.policyDecision.kind).toBe("allow");
  });

  test("payment status builders omit providerPaymentId when absent", () => {
    const client = createBankingClient();
    const envelope = client.createPaymentStatus({
      providerId: "mercury",
      requester,
      reason: "status",
      paymentRequestId: "pr_1",
      now: new Date("2026-06-29T10:00:00.000Z"),
    });
    const intent = statusOf(envelope);
    expect(intent.paymentRequestId).toBe("pr_1");
    expect("providerPaymentId" in intent).toBe(false);

    const withProvider = statusOf(client.createPaymentStatus({
      providerId: "mercury",
      requester,
      reason: "status",
      paymentRequestId: "pr_1",
      providerPaymentId: "mercury_pay_1",
      now: new Date("2026-06-29T10:00:00.000Z"),
    }));
    expect(withProvider.providerPaymentId).toBe("mercury_pay_1");
  });

  test("card request builders set kind request_virtual and omit optionals", () => {
    const client = createBankingClient();
    const intent = cardRequestOf(client.createCardRequest({
      providerId: "mercury",
      requester,
      reason: "card",
      accountId: "acct_1",
      label: "Ops",
      now: new Date("2026-06-29T10:00:00.000Z"),
    }));
    expect(intent.type).toBe("card.request");
    expect(intent.kind).toBe("request_virtual");
    expect(intent.accountId).toBe("acct_1");
    expect(intent.label).toBe("Ops");
    expect("contactIds" in intent).toBe(false);
    expect("holderId" in intent).toBe(false);
    expect("spendingControls" in intent).toBe(false);

    const full = cardRequestOf(client.createCardRequest({
      providerId: "mercury",
      requester,
      reason: "card",
      accountId: "acct_1",
      label: "Ops",
      contactIds: ["contact_1"],
      holderId: "holder_1",
      spendingControls: { month: moneyFromDecimal("100.00", "USD") },
      now: new Date("2026-06-29T10:00:00.000Z"),
    }));
    expect(full.contactIds).toEqual(["contact_1"]);
    expect(full.holderId).toBe("holder_1");
    expect(full.spendingControls).toEqual({ month: moneyFromDecimal("100.00", "USD") });
  });

  test("card update builders set kind update and omit label when absent", () => {
    const client = createBankingClient();
    const intent = cardUpdateOf(client.createCardUpdate({
      providerId: "mercury",
      requester,
      reason: "update",
      cardId: "card_1",
      now: new Date("2026-06-29T10:00:00.000Z"),
    }));
    expect(intent.type).toBe("card.update");
    expect(intent.kind).toBe("update");
    expect(intent.cardId).toBe("card_1");
    expect("label" in intent).toBe(false);

    const labelled = cardUpdateOf(client.createCardUpdate({
      providerId: "mercury",
      requester,
      reason: "update",
      cardId: "card_1",
      label: "New label",
      now: new Date("2026-06-29T10:00:00.000Z"),
    }));
    expect(labelled.label).toBe("New label");
  });

  test("card lifecycle builders cover freeze, unfreeze, and terminate", () => {
    const client = createBankingClient();
    for (const kind of ["freeze", "unfreeze", "terminate"] as const) {
      const intent = cardLifecycleOf(client.createCardLifecycle({
        providerId: "mercury",
        requester,
        reason: "lifecycle",
        cardId: "card_1",
        kind,
        now: new Date("2026-06-29T10:00:00.000Z"),
      }));
      expect(intent.type).toBe("card.lifecycle");
      expect(intent.kind).toBe(kind);
      expect(intent.cardId).toBe("card_1");
      expect("approvalId" in intent).toBe(false);
    }
  });

  test("deterministic identity: same input yields the same id and key across time", () => {
    const client = createBankingClient();
    const input = {
      providerId: "mercury" as const,
      requester,
      reason: "determinism",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("10.00", "USD"),
      rail: "ach" as const,
    };
    const morning = client.createPaymentRequest({ ...input, now: new Date("2026-06-29T08:00:00.000Z") });
    const evening = client.createPaymentRequest({ ...input, now: new Date("2026-06-29T20:00:00.000Z") });

    // The intent's own id and idempotencyKey derive from the payload seed (no `now`),
    // so they are stable across time.
    expect(morning.intent.id).toBe(evening.intent.id);
    expect(morning.intent.idempotencyKey).toBe(evening.intent.idempotencyKey);
    // createdAt is injected from `now`, so it moves.
    expect(morning.intent.createdAt).not.toBe(evening.intent.createdAt);
    // The envelope fingerprint covers the canonical intent payload INCLUDING createdAt,
    // so two time-separated instances of the same logical payment produce different
    // fingerprints — the fingerprint binds the exact intent snapshot, not the logical
    // payment. This is the fail-closed reading of the design and is pinned here so a
    // change to time-stable fingerprinting is a deliberate, reviewed change.
    expect(morning.fingerprint.payloadHash).not.toBe(evening.fingerprint.payloadHash);
    expect(morning.fingerprint.key).not.toBe(evening.fingerprint.key);
  });

  test("a changed field produces a different id and fingerprint", () => {
    const client = createBankingClient();
    const base = {
      providerId: "mercury" as const,
      requester,
      reason: "determinism",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("10.00", "USD"),
      rail: "ach" as const,
      now: new Date("2026-06-29T10:00:00.000Z"),
    };
    const original = client.createPaymentRequest(base);
    const changed = client.createPaymentRequest({ ...base, counterparty: { name: "Different Vendor" } });
    expect(original.intent.id).not.toBe(changed.intent.id);
    expect(original.fingerprint.payloadHash).not.toBe(changed.fingerprint.payloadHash);
  });

  test("envelopes bind the intent to its own fingerprint and policy decision", () => {
    const client = createBankingClient();
    const envelope = client.createPaymentRequest({
      providerId: "mercury",
      requester,
      reason: "envelope",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("10.00", "USD"),
      rail: "ach",
      now: new Date("2026-06-29T10:00:00.000Z"),
    });
    expect(envelope.fingerprint.payloadHash).toBe(createIntentFingerprint(envelope.intent).payloadHash);
    expect(envelope.policyDecision.snapshot.intentType).toBe("payment.request");
    expect(envelope.policyDecision.snapshot.providerId).toBe("mercury");
  });

  test("client envelope factories accept an explicit policy override", () => {
    const client = createBankingClient();
    const envelope = client.createPaymentRequest({
      providerId: "mercury",
      requester,
      reason: "policy override",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("10.00", "USD"),
      rail: "ach",
      now: new Date("2026-06-29T10:00:00.000Z"),
    }, {
      liveMode: true,
      environment: "production",
      requireApprovalForProviderSideEffects: false,
      allowSensitiveCardData: false,
    });
    expect(envelope.policyDecision.snapshot.liveMode).toBe(true);
    expect(envelope.policyDecision.snapshot.environment).toBe("production");
  });
});
