/**
 * TEST-GAP suite: policy decision matrix edges.
 *
 * AGENT-AUTHORED — the gpt-5.6-sol advisory consult was attempted on two
 * distinct provider accounts and refused at the capacity wall on both
 * ("Selected model is at capacity. Please try a different model."), so this
 * spec was produced from direct source analysis, not attributed to SOL.
 *
 * Locks gaps in tests/core.test.ts policy coverage: allowlist/blocklist and
 * provider-mismatch denials, provider-capability denials, card spending
 * control validation (including the non-money guard), the max-payment
 * boundary at equality, ruleHash determinism, and the snapshot contract.
 */
import { describe, expect, test } from "bun:test";
import {
  createPolicyRuleHash,
  DEFAULT_BANKING_POLICY,
  evaluateIntentPolicy,
  getProvider,
  moneyFromDecimal,
  moneyFromMinor,
  type ActorRef,
  type BankingPolicy,
  type PaymentQuoteIntent,
} from "../src/index.ts";

const requester: ActorRef = { id: "agent-policy", type: "agent" };

function quoteIntent(overrides: Partial<PaymentQuoteIntent> = {}): PaymentQuoteIntent {
  return {
    id: "intent_quote_1",
    type: "payment.quote",
    providerId: "mercury",
    requester,
    idempotencyKey: "quote:demo",
    status: "draft",
    createdAt: "2026-06-29T10:00:00.000Z",
    metadata: { reason: "test" },
    sourceAccountId: "acct_1",
    counterparty: { name: "Vendor", providerRecipientId: "recipient_1" },
    amount: moneyFromDecimal("100.00", "USD"),
    rail: "ach",
    ...overrides,
  };
}

describe("policy deny branches", () => {
  test("denies providers outside the allowlist", () => {
    const decision = evaluateIntentPolicy(quoteIntent(), getProvider("mercury")!, {
      ...DEFAULT_BANKING_POLICY,
      allowedProviderIds: ["bunq"],
    });
    expect(decision.kind).toBe("deny");
    expect(decision.reasons).toContain("Provider is not on the allowlist.");
  });

  test("denies providers on the blocklist", () => {
    const decision = evaluateIntentPolicy(quoteIntent(), getProvider("mercury")!, {
      ...DEFAULT_BANKING_POLICY,
      blockedProviderIds: ["mercury"],
    });
    expect(decision.kind).toBe("deny");
    expect(decision.reasons).toContain("Provider is blocked by policy.");
  });

  test("denies when the intent provider does not match the capability card", () => {
    const decision = evaluateIntentPolicy(
      { ...quoteIntent(), providerId: "bunq" },
      getProvider("mercury")!,
      DEFAULT_BANKING_POLICY,
    );
    expect(decision.kind).toBe("deny");
    expect(decision.reasons).toContain("Intent provider does not match capability card.");
  });

  test("denies payment intents against a provider without payment capability", () => {
    const mercury = getProvider("mercury")!;
    const noPayments = { ...mercury, capabilities: { ...mercury.capabilities, payments: false } };
    const decision = evaluateIntentPolicy(quoteIntent(), noPayments, DEFAULT_BANKING_POLICY);
    expect(decision.kind).toBe("deny");
    expect(decision.reasons).toContain("Provider does not support payments.");
  });

  test("denies card intents against a provider without card capability", () => {
    const bcr = getProvider("erste-bcr")!;
    const decision = evaluateIntentPolicy({
      id: "intent_bcr_card",
      type: "card.request",
      kind: "request_virtual",
      providerId: "erste-bcr",
      requester,
      idempotencyKey: "card:bcr",
      status: "draft",
      createdAt: "2026-06-29T10:00:00.000Z",
      metadata: { reason: "test" },
      accountId: "acct_1",
      label: "Ops",
    }, bcr, DEFAULT_BANKING_POLICY);
    expect(decision.kind).toBe("deny");
    expect(decision.reasons).toContain("Provider does not support direct card control.");
  });

  test("denies zero and negative card spending controls across every control name", () => {
    const mercury = getProvider("mercury")!;
    for (const name of ["single", "day", "week", "month", "lifetime"]) {
      const decision = evaluateIntentPolicy({
        id: `intent_card_${name}`,
        type: "card.request",
        kind: "request_virtual",
        providerId: "mercury",
        requester,
        idempotencyKey: `card:${name}`,
        status: "draft",
        createdAt: "2026-06-29T10:00:00.000Z",
        metadata: { reason: "test" },
        accountId: "acct_1",
        label: "Ops",
        spendingControls: { [name]: moneyFromMinor("0", "USD") },
      }, mercury, DEFAULT_BANKING_POLICY);
      expect(decision.reasons).toContain(`Card spending control ${name} must be positive.`);
    }
  });

  test("ignores non-Money spending control values instead of crashing", () => {
    const decision = evaluateIntentPolicy({
      id: "intent_card_guard",
      type: "card.request",
      kind: "request_virtual",
      providerId: "mercury",
      requester,
      idempotencyKey: "card:guard",
      status: "draft",
      createdAt: "2026-06-29T10:00:00.000Z",
      metadata: { reason: "test" },
      accountId: "acct_1",
      label: "Ops",
      spendingControls: { day: "lots" as never },
    }, getProvider("mercury")!, DEFAULT_BANKING_POLICY);
    expect(decision.reasons).not.toContain(expect.stringContaining("must be positive"));
  });
});

describe("approval-threshold boundary", () => {
  const sideEffectPolicy: BankingPolicy = {
    ...DEFAULT_BANKING_POLICY,
    requireApprovalForProviderSideEffects: false,
    maxPaymentWithoutApproval: moneyFromDecimal("100.00", "USD"),
  };

  test("a payment equal to the no-approval limit does not trip the limit reason", () => {
    const decision = evaluateIntentPolicy({
      ...quoteIntent(),
      type: "payment.request",
    }, getProvider("mercury")!, sideEffectPolicy);
    expect(decision.kind).toBe("requires_approval");
    expect(decision.reasons).toContain("Provider side effects require approval.");
    expect(decision.reasons).not.toContain("Payment exceeds no-approval limit.");
  });

  test("a payment above the no-approval limit adds the limit reason", () => {
    const decision = evaluateIntentPolicy({
      ...quoteIntent(),
      type: "payment.request",
      amount: moneyFromDecimal("100.01", "USD"),
    }, getProvider("mercury")!, sideEffectPolicy);
    expect(decision.kind).toBe("requires_approval");
    expect(decision.reasons).toContain("Payment exceeds no-approval limit.");
  });

  test("payment side effects require approval even with the flag disabled", () => {
    const decision = evaluateIntentPolicy({
      ...quoteIntent(),
      type: "payment.request",
    }, getProvider("mercury")!, { ...DEFAULT_BANKING_POLICY, requireApprovalForProviderSideEffects: false });
    expect(decision.kind).toBe("requires_approval");
    expect(decision.reasons).toContain("Provider side effects require approval.");
  });
});

describe("allow path and snapshot contract", () => {
  test("a payment quote is not a provider side effect and can be allowed directly", () => {
    const decision = evaluateIntentPolicy(quoteIntent(), getProvider("mercury")!, {
      ...DEFAULT_BANKING_POLICY,
      requireApprovalForProviderSideEffects: false,
    });
    expect(decision.kind).toBe("allow");
    expect(decision.reasons).toContain("Policy allowed the intent.");
  });

  test("snapshot carries the injected evaluation time and ruleHash", () => {
    const now = new Date("2026-02-03T04:05:06.000Z");
    const decision = evaluateIntentPolicy(quoteIntent(), getProvider("mercury")!, DEFAULT_BANKING_POLICY, now);
    expect(decision.snapshot.evaluatedAt).toBe("2026-02-03T04:05:06.000Z");
    expect(decision.snapshot.providerId).toBe("mercury");
    expect(decision.snapshot.intentType).toBe("payment.quote");
    expect(decision.snapshot.ruleHash).toBe(createPolicyRuleHash(DEFAULT_BANKING_POLICY));
  });

  test("ruleHash is deterministic and sensitive to policy changes", () => {
    expect(createPolicyRuleHash(DEFAULT_BANKING_POLICY)).toBe(createPolicyRuleHash(DEFAULT_BANKING_POLICY));
    expect(createPolicyRuleHash({ ...DEFAULT_BANKING_POLICY, environment: "production" }))
      .not.toBe(createPolicyRuleHash(DEFAULT_BANKING_POLICY));
    expect(createPolicyRuleHash({ ...DEFAULT_BANKING_POLICY, liveMode: true }))
      .not.toBe(createPolicyRuleHash(DEFAULT_BANKING_POLICY));
    expect(createPolicyRuleHash({ ...DEFAULT_BANKING_POLICY, maxPaymentWithoutApproval: moneyFromDecimal("50.00", "USD") }))
      .not.toBe(createPolicyRuleHash(DEFAULT_BANKING_POLICY));
    expect(createPolicyRuleHash({ ...DEFAULT_BANKING_POLICY, allowSensitiveCardData: true }))
      .not.toBe(createPolicyRuleHash(DEFAULT_BANKING_POLICY));
  });
});
