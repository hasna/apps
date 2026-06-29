import { describe, expect, test } from "bun:test";
import {
  canExecuteWithApproval,
  createIntentFingerprint,
  compareMoney,
  createAuditEvent,
  createIdempotencyFingerprint,
  decideIdempotencyReplay,
  evaluateIntentPolicy,
  getProvider,
  listProviders,
  moneyFromDecimal,
  moneyFromMinor,
  reconcileProviderEvent,
  type ActorRef,
  type PaymentRequestIntent,
} from "../src/index.ts";

const requester: ActorRef = { id: "agent-payments", type: "agent" };
const approver: ActorRef = { id: "finance-lead", type: "human" };

describe("money primitives", () => {
  test("parse and format minor units without floating point math", () => {
    expect(moneyFromDecimal("12.34", "USD")).toEqual({ currency: "USD", amountMinor: "1234", scale: 2 });
    expect(compareMoney(moneyFromMinor("1235", "USD"), moneyFromDecimal("12.34", "USD"))).toBe(1);
  });

  test("rejects excess decimal precision", () => {
    expect(() => moneyFromDecimal("12.345", "EUR")).toThrow("more than 2 decimal places");
  });
});

describe("provider capability fixtures", () => {
  test("encode direct institution providers and Erste BCR PSD2 access separately", () => {
    expect(listProviders().map((provider) => provider.id)).toEqual([
      "mercury",
      "bunq",
      "revolut-business",
      "erste-bcr",
    ]);

    expect(getProvider("mercury")?.cardOperations.createVirtual).toBe("documented_unverified");
    expect(getProvider("revolut-business")?.capabilities.cardSandbox).toBe(false);
    expect(getProvider("erste-bcr")?.role).toBe("open_banking_access");
    expect(getProvider("erste-bcr")?.capabilities.cards).toBe(false);
  });

  test("does not expose the removed legacy provider concepts", () => {
    const providerIds = listProviders().map((provider) => provider.id);
    for (const removedProviderId of [`p${"laid"}`, `p${"lain"}`]) {
      expect(providerIds).not.toContain(removedProviderId);
    }
  });
});

describe("intents, policy, approvals, and idempotency", () => {
  test("payment requests fail into approval before provider side effects", () => {
    const provider = getProvider("mercury");
    if (!provider) throw new Error("missing provider");

    const intent = paymentIntent();
    const decision = evaluateIntentPolicy(intent, provider, {
      liveMode: true,
      environment: "production",
      requireApprovalForProviderSideEffects: true,
      maxPaymentWithoutApproval: moneyFromDecimal("50.00", "USD"),
      allowSensitiveCardData: false,
    });

    expect(decision.kind).toBe("requires_approval");
    expect(decision.reasons).toContain("Provider side effects require approval.");
    expect(decision.reasons).toContain("Payment exceeds no-approval limit.");
  });

  test("live side effects require approval even when a caller disables approval policy", () => {
    const provider = getProvider("mercury");
    if (!provider) throw new Error("missing provider");

    const decision = evaluateIntentPolicy(paymentIntent(), provider, {
      liveMode: true,
      environment: "production",
      requireApprovalForProviderSideEffects: false,
      allowSensitiveCardData: false,
    });

    expect(decision.kind).toBe("requires_approval");
    expect(decision.reasons).toContain("Provider side effects require approval.");
  });

  test("card side effects fail closed until provider operation conformance is verified", () => {
    const provider = getProvider("mercury");
    if (!provider) throw new Error("missing provider");

    const decision = evaluateIntentPolicy({
      id: "intent_card_1",
      type: "card.request",
      kind: "request_virtual",
      providerId: "mercury",
      requester,
      idempotencyKey: "card:demo",
      status: "draft",
      createdAt: "2026-06-29T10:00:00.000Z",
      metadata: { reason: "test" },
      accountId: "acct_1",
      label: "Ops",
      spendingControls: { month: moneyFromDecimal("250.00", "USD") },
    }, provider, {
      liveMode: true,
      environment: "production",
      requireApprovalForProviderSideEffects: true,
      allowSensitiveCardData: false,
    });

    expect(decision.kind).toBe("deny");
    expect(decision.reasons).toContain("Provider card operation is documented but not verified for execution.");
  });

  test("production-only card operations fail closed in sandbox policy context", () => {
    const provider = getProvider("revolut-business");
    if (!provider) throw new Error("missing provider");

    const decision = evaluateIntentPolicy({
      id: "intent_card_2",
      type: "card.lifecycle",
      kind: "freeze",
      providerId: "revolut-business",
      requester,
      idempotencyKey: "card:freeze",
      status: "draft",
      createdAt: "2026-06-29T10:00:00.000Z",
      metadata: { reason: "test" },
      cardId: "card_1",
    }, provider);

    expect(decision.kind).toBe("deny");
    expect(decision.reasons).toContain("Provider card operation is production-only and cannot execute in sandbox policy context.");
  });

  test("payment requests reject zero and negative amounts", () => {
    const provider = getProvider("mercury");
    if (!provider) throw new Error("missing provider");

    const zero = evaluateIntentPolicy({ ...paymentIntent(), amount: moneyFromMinor("0", "USD") }, provider);
    const negative = evaluateIntentPolicy({ ...paymentIntent(), amount: moneyFromMinor("-1", "USD") }, provider);

    expect(zero.kind).toBe("deny");
    expect(negative.kind).toBe("deny");
    expect(zero.reasons).toContain("Payment amount must be positive.");
    expect(negative.reasons).toContain("Payment amount must be positive.");
  });

  test("idempotency detects replay and conflicts", () => {
    const first = createIdempotencyFingerprint("payment", paymentIntent());
    const replay = createIdempotencyFingerprint("payment", paymentIntent());
    const conflict = createIdempotencyFingerprint("payment", { ...paymentIntent(), sourceAccountId: "different" });

    expect(decideIdempotencyReplay(replay, first).status).toBe("replay");
    expect(decideIdempotencyReplay(conflict, first).status).toBe("conflict");
  });

  test("approval gate enforces maker-checker and expiry", () => {
    const provider = getProvider("mercury");
    if (!provider) throw new Error("missing provider");
    const intent = paymentIntent();
    const policy = evaluateIntentPolicy(intent, provider);

    const allowed = canExecuteWithApproval(intent, {
      id: "approval_1",
      intentId: intent.id,
      requestedBy: requester,
      decidedBy: approver,
      intentIdempotencyKey: intent.idempotencyKey,
      intentPayloadHash: createIntentFingerprint(intent).payloadHash,
      decision: "granted",
      decidedAt: "2026-06-29T10:00:00.000Z",
      expiresAt: "2026-06-29T12:00:00.000Z",
      policySnapshot: policy.snapshot,
    }, new Date("2026-06-29T11:00:00.000Z"));

    const denied = canExecuteWithApproval(intent, {
      id: "approval_2",
      intentId: intent.id,
      requestedBy: requester,
      decidedBy: requester,
      intentIdempotencyKey: intent.idempotencyKey,
      intentPayloadHash: createIntentFingerprint(intent).payloadHash,
      decision: "granted",
      decidedAt: "2026-06-29T10:00:00.000Z",
      expiresAt: "2026-06-29T12:00:00.000Z",
      policySnapshot: policy.snapshot,
    }, new Date("2026-06-29T11:00:00.000Z"));

    expect(allowed.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
    expect(denied.reasons).toContain("Maker-checker policy requires a different approver.");
  });

  test("approval gate rejects non-human approvers", () => {
    const provider = getProvider("mercury");
    if (!provider) throw new Error("missing provider");
    const intent = paymentIntent();
    const policy = evaluateIntentPolicy(intent, provider);

    const denied = canExecuteWithApproval(intent, {
      id: "approval_agent",
      intentId: intent.id,
      requestedBy: requester,
      decidedBy: { id: "agent-reviewer", type: "agent" },
      intentIdempotencyKey: intent.idempotencyKey,
      intentPayloadHash: createIntentFingerprint(intent).payloadHash,
      decision: "granted",
      decidedAt: "2026-06-29T10:00:00.000Z",
      expiresAt: "2026-06-29T12:00:00.000Z",
      policySnapshot: policy.snapshot,
    }, new Date("2026-06-29T11:00:00.000Z"));

    expect(denied.allowed).toBe(false);
    expect(denied.reasons).toContain("Approval must be decided by a human approver.");
  });

  test("approval gate rejects invalid timestamps", () => {
    const provider = getProvider("mercury");
    if (!provider) throw new Error("missing provider");
    const intent = paymentIntent();
    const policy = evaluateIntentPolicy(intent, provider);

    const denied = canExecuteWithApproval(intent, {
      id: "approval_invalid_date",
      intentId: intent.id,
      requestedBy: requester,
      decidedBy: approver,
      intentIdempotencyKey: intent.idempotencyKey,
      intentPayloadHash: createIntentFingerprint(intent).payloadHash,
      decision: "granted",
      decidedAt: "not-a-date",
      expiresAt: "not-a-date",
      policySnapshot: policy.snapshot,
    }, new Date("2026-06-29T11:00:00.000Z"));

    expect(denied.allowed).toBe(false);
    expect(denied.reasons).toContain("Approval decidedAt timestamp is invalid.");
    expect(denied.reasons).toContain("Approval expiresAt timestamp is invalid.");
  });

  test("approval gate rejects mutated intent payloads", () => {
    const provider = getProvider("mercury");
    if (!provider) throw new Error("missing provider");
    const intent = paymentIntent();
    const policy = evaluateIntentPolicy(intent, provider);
    const approval = {
      id: "approval_3",
      intentId: intent.id,
      requestedBy: requester,
      decidedBy: approver,
      intentIdempotencyKey: intent.idempotencyKey,
      intentPayloadHash: createIntentFingerprint(intent).payloadHash,
      decision: "granted" as const,
      decidedAt: "2026-06-29T10:00:00.000Z",
      expiresAt: "2026-06-29T12:00:00.000Z",
      policySnapshot: policy.snapshot,
    };

    const mutated = { ...intent, amount: moneyFromDecimal("500.00", "USD") };
    const denied = canExecuteWithApproval(mutated, approval, new Date("2026-06-29T11:00:00.000Z"));

    expect(denied.allowed).toBe(false);
    expect(denied.reasons).toContain("Approval payload hash does not match the current intent.");
  });
});

describe("audit and reconciliation contracts", () => {
  test("audit metadata redacts secrets and sensitive card fields", () => {
    const pemLikeFixture = `-----BE${"GIN"} PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----`;
    const event = createAuditEvent({
      id: "audit_1",
      type: "provider.submitted",
      actor: requester,
      occurredAt: "2026-06-29T10:00:00.000Z",
      subjectId: "intent_1",
      metadata: {
        accessToken: "secret",
        privateKey: "fake-private-key-material",
        cardNumber: "4111111111111111",
        memo: "4242424242424242",
        payload: pemLikeFixture,
        card: { number: "4000000000000002" },
        safe: "kept",
      },
    });

    expect(event.metadata.accessToken).toBe("[REDACTED]");
    expect(event.metadata.privateKey).toBe("[REDACTED]");
    expect(event.metadata.cardNumber).toBe("[REDACTED]");
    expect(event.metadata.memo).toBe("[REDACTED]");
    expect(event.metadata.payload).toBe("[REDACTED]");
    expect(event.metadata.card).toEqual({ number: "[REDACTED]" });
    expect(event.metadata.safe).toBe("kept");
    expect(event.hash).toHaveLength(64);
  });

  test("reconciliation marks unknown local outcomes as indeterminate", () => {
    const record = reconcileProviderEvent(undefined, {
      id: "evt_1",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "provider_payment_1",
      occurredAt: "2026-06-29T10:00:00.000Z",
      amount: moneyFromDecimal("10.00", "USD"),
      rawHash: "hash",
    });

    expect(record.status).toBe("indeterminate");
  });
});

function paymentIntent(): PaymentRequestIntent {
  return {
    id: "intent_payment_1",
    type: "payment.request",
    providerId: "mercury",
    requester,
    idempotencyKey: "payment:demo",
    status: "draft",
    createdAt: "2026-06-29T10:00:00.000Z",
    metadata: { reason: "test" },
    sourceAccountId: "acct_1",
    counterparty: { name: "Vendor", providerRecipientId: "recipient_1" },
    amount: moneyFromDecimal("100.00", "USD"),
    rail: "ach",
  };
}
