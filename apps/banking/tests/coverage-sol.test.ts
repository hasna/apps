// Sol-guided coverage lane (tests-coverage-sol workflow, banking app).
// Every case is two-sided: a positive arm asserting real behavior and a
// negative arm asserting the exact rejection, so each test can both pass and
// fail against the code it guards.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addMoney,
  appendAuditLedgerEvent,
  approveExecutionRequest,
  assertProviderCapabilityCard,
  cancelExecutionRequest,
  compareMoney,
  createAuditEvent,
  createBankingClient,
  createIdempotencyFingerprint,
  createPolicyRuleHash,
  createSqliteDevStore,
  decideIdempotencyReplay,
  evaluateIntentPolicy,
  executeDryRunOutbox,
  formatMoney,
  hashPayload,
  moneyFromDecimal,
  moneyFromMinor,
  normalizeProviderWebhookEvent,
  reconcileExecution,
  reconcileProviderEvent,
  retryExecutionOutbox,
  stableStringify,
  submitExecutionRequest,
  verifyAuditLedger,
  type ActorRef,
  type BankingIntent,
  type BankingPolicy,
  type CardRequestIntent,
  type PaymentRequestIntent,
  type ProviderCapabilityCard,
  type ProviderEvent,
} from "../src/index.ts";
import { runCli } from "../src/cli/index.ts";
import { listPlannedMcpTools, runMcp, runMcpTool } from "../src/mcp/index.ts";

const requester: ActorRef = { id: "agent-coverage", type: "agent" };

// ---------------------------------------------------------------------------
// Priority 1 — money and idempotency fingerprints
// ---------------------------------------------------------------------------

describe("money: moneyFromMinor input matrix", () => {
  test("accepts positive, negative, zero, and bigint minor units", () => {
    expect(moneyFromMinor("123", "USD")).toEqual({ currency: "USD", amountMinor: "123", scale: 2 });
    expect(moneyFromMinor("-123", "USD")).toEqual({ currency: "USD", amountMinor: "-123", scale: 2 });
    expect(moneyFromMinor("0", "USD")).toEqual({ currency: "USD", amountMinor: "0", scale: 2 });
    expect(moneyFromMinor(456n, "USD")).toEqual({ currency: "USD", amountMinor: "456", scale: 2 });
    expect(moneyFromMinor(789, "USD")).toEqual({ currency: "USD", amountMinor: "789", scale: 2 });
  });

  test("rejects non-integer minor units with the exact message", () => {
    expect(() => moneyFromMinor("12.5", "USD")).toThrow("Money minor units must be an integer string.");
    expect(() => moneyFromMinor("12,5", "USD")).toThrow("Money minor units must be an integer string.");
    expect(() => moneyFromMinor("", "USD")).toThrow("Money minor units must be an integer string.");
  });

  test("rejects negative and non-integer scales with the exact message", () => {
    expect(() => moneyFromMinor("10", "USD", -1)).toThrow("Money scale must be a non-negative integer.");
    expect(() => moneyFromMinor("10", "USD", 2.5)).toThrow("Money scale must be a non-negative integer.");
    expect(() => moneyFromMinor("10", "USD", Number.NaN)).toThrow("Money scale must be a non-negative integer.");
  });
});

describe("money: moneyFromDecimal input matrix", () => {
  test("rejects bare-dot and trailing-dot forms with the exact message", () => {
    expect(() => moneyFromDecimal(".5", "USD")).toThrow("Money amount must be a decimal string.");
    expect(() => moneyFromDecimal("5.", "USD")).toThrow("Money amount must be a decimal string.");
  });

  test("normalizes leading zeros without changing value", () => {
    expect(moneyFromDecimal("0005.50", "USD")).toEqual({ currency: "USD", amountMinor: "550", scale: 2 });
    expect(moneyFromDecimal("0.50", "USD")).toEqual({ currency: "USD", amountMinor: "50", scale: 2 });
    expect(moneyFromDecimal("00.05", "USD")).toEqual({ currency: "USD", amountMinor: "5", scale: 2 });
  });

  test("negative zero normalizes to zero and loses the sign", () => {
    expect(moneyFromDecimal("-0.00", "USD")).toEqual({ currency: "USD", amountMinor: "0", scale: 2 });
    expect(moneyFromDecimal("-0.50", "USD")).toEqual({ currency: "USD", amountMinor: "-50", scale: 2 });
  });

  test("scale-zero decimals reject fractional input and accept integers", () => {
    expect(moneyFromDecimal("12", "USD", 0)).toEqual({ currency: "USD", amountMinor: "12", scale: 0 });
    expect(() => moneyFromDecimal("12.34", "USD", 0)).toThrow("Money amount has more than 0 decimal places for USD.");
  });

  test("exact-scale input is accepted and excess precision is rejected with the exact message", () => {
    expect(moneyFromDecimal("12.34", "EUR")).toEqual({ currency: "EUR", amountMinor: "1234", scale: 2 });
    expect(() => moneyFromDecimal("12.345", "EUR")).toThrow("Money amount has more than 2 decimal places for EUR.");
  });
});

describe("money: formatMoney output forms", () => {
  test("formats zero and fractional amounts with explicit scale", () => {
    expect(formatMoney(moneyFromMinor("50", "USD"))).toBe("0.50 USD");
    expect(formatMoney(moneyFromMinor("0", "USD"))).toBe("0.00 USD");
    expect(formatMoney(moneyFromDecimal("-12.34", "EUR"))).toBe("-12.34 EUR");
  });

  test("formats scale-zero money without a fraction and pads smaller values", () => {
    expect(formatMoney(moneyFromMinor("1234", "USD", 0))).toBe("1234 USD");
    expect(formatMoney(moneyFromMinor("5", "RON"))).toBe("0.05 RON");
    expect(formatMoney(moneyFromMinor("-5", "RON"))).toBe("-0.05 RON");
  });
});

describe("money: addMoney and compareMoney", () => {
  test("addMoney sums in BigInt across very large magnitudes without precision loss", () => {
    const huge = 10n ** 30n;
    const left = moneyFromMinor(huge, "USD");
    const right = moneyFromMinor(10n, "USD");
    expect(addMoney(left, right).amountMinor).toBe(String(huge + 10n));
    expect(addMoney(left, right).scale).toBe(2);
    expect(addMoney(moneyFromMinor("-1", "USD"), moneyFromMinor("1", "USD")).amountMinor).toBe("0");
  });

  test("addMoney rejects currency mismatch and scale mismatch with the exact message", () => {
    expect(() => addMoney(moneyFromMinor("10", "USD"), moneyFromMinor("10", "EUR"))).toThrow(
      "Money values must use the same currency and scale.",
    );
    expect(() => addMoney(moneyFromMinor("10", "USD", 2), moneyFromMinor("10", "USD", 3))).toThrow(
      "Money values must use the same currency and scale.",
    );
  });

  test("compareMoney distinguishes less, equal, and greater", () => {
    const base = moneyFromMinor("100", "USD");
    expect(compareMoney(moneyFromMinor("99", "USD"), base)).toBe(-1);
    expect(compareMoney(base, base)).toBe(0);
    expect(compareMoney(moneyFromMinor("101", "USD"), base)).toBe(1);
    expect(compareMoney(moneyFromMinor("-100", "USD"), base)).toBe(-1);
  });
});

describe("idempotency: stableStringify canonicalization", () => {
  test("equal canonical strings for objects whose keys were inserted in different order", () => {
    const first = stableStringify({ amount: "1000", currency: "USD", sourceAccountId: "acct_1" });
    const second = stableStringify({ sourceAccountId: "acct_1", currency: "USD", amount: "1000" });
    expect(first).toBe(second);
    expect(first).toBe('{"amount":"1000","currency":"USD","sourceAccountId":"acct_1"}');
  });

  test("undefined object properties are dropped; one-field mutation changes the string", () => {
    expect(stableStringify({ b: 1, a: undefined })).toBe('{"b":1}');
    expect(stableStringify({ a: 1, b: undefined })).not.toBe('{"b":1}');
  });

  test("array order remains significant in the canonical string", () => {
    expect(stableStringify(["a", "b"])).toBe('["a","b"]');
    expect(stableStringify(["b", "a"])).not.toBe(stableStringify(["a", "b"]));
  });

  test("nested objects canonicalize recursively", () => {
    const nested = { outer: { z: 1, a: [3, { y: 2, x: 1 }] }, inner: 1 };
    const reordered = { inner: 1, outer: { a: [3, { x: 1, y: 2 }], z: 1 } };
    expect(stableStringify(nested)).toBe(stableStringify(reordered));
    expect(stableStringify({ ...nested, inner: 2 })).not.toBe(stableStringify(nested));
  });
});

describe("idempotency: hashPayload contract", () => {
  test("equal hashes for semantically equal objects regardless of key insertion order", () => {
    const payload = { amount: "2500", currency: "USD", counterparty: { name: "Vendor" } };
    const reordered = { counterparty: { name: "Vendor" }, currency: "USD", amount: "2500" };
    expect(hashPayload(payload)).toBe(hashPayload(reordered));
    expect(hashPayload(payload)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a one-field payload mutation produces a different hash", () => {
    const base = hashPayload({ amount: "2500", currency: "USD" });
    expect(hashPayload({ amount: "2501", currency: "USD" })).not.toBe(base);
    expect(hashPayload({ amount: "2500", currency: "EUR" })).not.toBe(base);
  });

  test("hash equality is preserved under stableStringify's undefined-property filtering", () => {
    expect(hashPayload({ a: undefined, b: 1 })).toBe(hashPayload({ b: 1 }));
  });

  test("fingerprints bind namespace plus payload and replay decisions distinguish new, replay, conflict", () => {
    const payload = { amount: "100", currency: "USD" };
    const first = createIdempotencyFingerprint("payment", payload);
    const same = createIdempotencyFingerprint("payment", { currency: "USD", amount: "100" });
    const changed = createIdempotencyFingerprint("payment", { ...payload, amount: "101" });

    expect(decideIdempotencyReplay(first)).toEqual({ status: "new", key: first.key });
    expect(decideIdempotencyReplay(same, first).status).toBe("replay");
    const conflict = decideIdempotencyReplay(changed, first);
    expect(conflict.status).toBe("conflict");
    expect(conflict.reason).toBe("Idempotency key already exists with a different payload.");
  });
});

// ---------------------------------------------------------------------------
// Priority 2 — provider capability and policy denials
// ---------------------------------------------------------------------------

function syntheticProvider(overrides: Partial<ProviderCapabilityCard> = {}): ProviderCapabilityCard {
  return {
    id: "mercury",
    displayName: "Synthetic Bank",
    role: "institution",
    capabilities: {
      accounts: true,
      attachments: false,
      balances: true,
      categories: false,
      credit: false,
      customers: false,
      events: false,
      invoices: false,
      transactions: true,
      counterparties: false,
      oauth: false,
      onboarding: false,
      organization: false,
      payments: true,
      paymentDrafts: false,
      internalTransfers: false,
      safes: false,
      statements: false,
      treasury: false,
      users: false,
      cards: true,
      webhooks: false,
      sandbox: true,
      cardSandbox: true,
      requiresTpp: false,
      requiresBusinessAccount: true,
      sensitiveCardData: false,
    },
    scopes: {
      read: ["accounts:read"],
      payments: ["payments:write"],
      cards: ["cards:write"],
      sensitiveCardData: [],
    },
    cardOperations: {
      createVirtual: "documented_unverified",
      updateSettings: "unsupported",
      freeze: "unsupported",
      unfreeze: "unsupported",
      terminate: "unsupported",
      revealSensitiveData: "unsupported",
      productionOnly: false,
    },
    environments: ["sandbox", "production"],
    docs: [],
    releaseGate: "synthetic",
    limitations: [],
    ...overrides,
  };
}

describe("provider capability card validation", () => {
  test("a well-formed synthetic card is accepted", () => {
    expect(() => assertProviderCapabilityCard(syntheticProvider())).not.toThrow();
  });

  test("open-banking access providers cannot expose direct card control", () => {
    const card = syntheticProvider({ role: "open_banking_access" });
    expect(() => assertProviderCapabilityCard(card)).toThrow(
      "mercury cannot expose direct card control as an open-banking access provider.",
    );
  });

  test("production-only card operations cannot claim sandbox support", () => {
    const card = syntheticProvider({ cardOperations: { ...syntheticProvider().cardOperations, productionOnly: true } });
    expect(() => assertProviderCapabilityCard(card)).toThrow(
      "mercury cannot mark production-only card operations as sandbox-supported.",
    );
  });

  test("sensitive card data capability requires a sensitive-card scope", () => {
    const card = syntheticProvider({ capabilities: { ...syntheticProvider().capabilities, sensitiveCardData: true } });
    expect(() => assertProviderCapabilityCard(card)).toThrow(
      "mercury must declare sensitive-card-data scope requirements.",
    );
  });

  test("a card operation without the cards capability is rejected", () => {
    const capabilities = { ...syntheticProvider().capabilities, cards: false };
    const card = syntheticProvider({ capabilities });
    expect(() => assertProviderCapabilityCard(card)).toThrow(
      "mercury cannot declare card operations without card capability.",
    );
  });

  test("card operations may be declared unsupported without card capability", () => {
    const capabilities = { ...syntheticProvider().capabilities, cards: false };
    const cardOperations = {
      createVirtual: "unsupported" as const,
      updateSettings: "unsupported" as const,
      freeze: "unsupported" as const,
      unfreeze: "unsupported" as const,
      terminate: "unsupported" as const,
      revealSensitiveData: "unsupported" as const,
      productionOnly: false,
    };
    expect(() => assertProviderCapabilityCard(syntheticProvider({ capabilities, cardOperations }))).not.toThrow();
  });
});

describe("policy: allowlist, blocklist, and mismatch denials", () => {
  const policy = (overrides: Partial<BankingPolicy> = {}): BankingPolicy => ({
    liveMode: false,
    environment: "sandbox",
    requireApprovalForProviderSideEffects: false,
    allowSensitiveCardData: false,
    ...overrides,
  });

  function paymentIntent(): BankingIntent {
    return {
      id: "intent_policy_1",
      type: "payment.quote",
      providerId: "mercury",
      requester,
      idempotencyKey: "policy:quote",
      status: "draft",
      createdAt: "2026-07-10T10:00:00.000Z",
      metadata: { reason: "coverage" },
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("10.00", "USD"),
      rail: "ach",
    };
  }

  test("a provider outside the allowlist is denied with the exact message", () => {
    const decision = evaluateIntentPolicy(paymentIntent(), syntheticProvider({ id: "mercury" }), policy({ allowedProviderIds: ["bunq"] }));
    expect(decision.kind).toBe("deny");
    expect(decision.reasons).toContain("Provider is not on the allowlist.");

    const allowed = evaluateIntentPolicy(paymentIntent(), syntheticProvider({ id: "mercury" }), policy({ allowedProviderIds: ["mercury"] }));
    expect(allowed.kind).toBe("allow");
  });

  test("a blocked provider is denied with the exact message", () => {
    const decision = evaluateIntentPolicy(paymentIntent(), syntheticProvider({ id: "mercury" }), policy({ blockedProviderIds: ["mercury"] }));
    expect(decision.kind).toBe("deny");
    expect(decision.reasons).toContain("Provider is blocked by policy.");

    const allowed = evaluateIntentPolicy(paymentIntent(), syntheticProvider({ id: "mercury" }), policy({ blockedProviderIds: ["bunq"] }));
    expect(allowed.kind).toBe("allow");
  });

  test("an intent whose provider mismatches the capability card is denied", () => {
    const provider = syntheticProvider({ id: "mercury" });
    const mismatched = evaluateIntentPolicy({ ...paymentIntent(), providerId: "bunq" }, provider, policy());
    expect(mismatched.kind).toBe("deny");
    expect(mismatched.reasons).toContain("Intent provider does not match capability card.");
  });

  test("non-positive card spending controls are denied with the exact message", () => {
    // The positive control needs a verified card operation; otherwise the
    // documented-but-unverified rule denies both arms and the control cannot fire.
    const provider = syntheticProvider({ id: "mercury", cardOperations: { ...syntheticProvider().cardOperations, createVirtual: "verified" } });
    const cardIntent: CardRequestIntent = {
      id: "intent_card_ctl",
      type: "card.request",
      kind: "request_virtual",
      providerId: "mercury",
      requester,
      idempotencyKey: "policy:card",
      status: "draft",
      createdAt: "2026-07-10T10:00:00.000Z",
      metadata: { reason: "coverage" },
      accountId: "acct_1",
      label: "Ops",
      spendingControls: { month: moneyFromMinor("0", "USD") },
    };
    const zero = evaluateIntentPolicy(cardIntent, provider, policy());
    expect(zero.kind).toBe("deny");
    expect(zero.reasons).toContain("Card spending control month must be positive.");

    // Card intents are provider side effects and are unconditionally approval-gated,
    // so the positive arm is requires_approval WITHOUT the spending-control denial.
    const positive = evaluateIntentPolicy(
      { ...cardIntent, spendingControls: { month: moneyFromMinor("100", "USD") } },
      provider,
      policy(),
    );
    expect(positive.kind).toBe("requires_approval");
    expect(positive.reasons).not.toContain("Card spending control month must be positive.");
    expect(positive.reasons).toContain("Provider side effects require approval.");
  });

  test("maxPaymentWithoutApproval: amount at the limit is not an approval case, one unit above is", () => {
    const provider = syntheticProvider({ id: "mercury" });
    const limitPolicy = policy({ maxPaymentWithoutApproval: moneyFromDecimal("50.00", "USD") });
    // The limit check applies to payment.request (money movement), not to a quote.
    const requestIntent: PaymentRequestIntent = {
      id: "intent_policy_req",
      type: "payment.request",
      providerId: "mercury",
      requester,
      idempotencyKey: "policy:request",
      status: "draft",
      createdAt: "2026-07-10T10:00:00.000Z",
      metadata: { reason: "coverage" },
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("10.00", "USD"),
      rail: "ach",
    };

    const atLimit = evaluateIntentPolicy({ ...requestIntent, amount: moneyFromMinor("5000", "USD") }, provider, limitPolicy);
    expect(atLimit.reasons).not.toContain("Payment exceeds no-approval limit.");

    const above = evaluateIntentPolicy({ ...requestIntent, amount: moneyFromMinor("5001", "USD") }, provider, limitPolicy);
    expect(above.reasons).toContain("Payment exceeds no-approval limit.");
    expect(above.reasons).toContain("Provider side effects require approval.");

    const withoutLimit = evaluateIntentPolicy(requestIntent, provider, policy());
    expect(withoutLimit.reasons).not.toContain("Payment exceeds no-approval limit.");
  });
});

describe("policy: rule hash stability", () => {
  test("hashing the same policy twice is stable; mutating one field changes the hash", () => {
    const basePolicy: BankingPolicy = {
      liveMode: false,
      environment: "sandbox",
      requireApprovalForProviderSideEffects: true,
      maxPaymentWithoutApproval: moneyFromDecimal("50.00", "USD"),
      allowedProviderIds: ["mercury", "bunq"],
      blockedProviderIds: ["erste-bcr"],
      allowSensitiveCardData: false,
    };
    const cloned: BankingPolicy = {
      liveMode: false,
      environment: "sandbox",
      requireApprovalForProviderSideEffects: true,
      maxPaymentWithoutApproval: moneyFromDecimal("50.00", "USD"),
      allowedProviderIds: ["bunq", "mercury"],
      blockedProviderIds: ["erste-bcr"],
      allowSensitiveCardData: false,
    };
    expect(createPolicyRuleHash(basePolicy)).toBe(createPolicyRuleHash(cloned));
    expect(createPolicyRuleHash(basePolicy)).not.toBe(createPolicyRuleHash({ ...basePolicy, allowSensitiveCardData: true }));
    expect(createPolicyRuleHash(basePolicy)).not.toBe(
      createPolicyRuleHash({ ...basePolicy, maxPaymentWithoutApproval: moneyFromDecimal("51.00", "USD") }),
    );
  });
});

// ---------------------------------------------------------------------------
// Priority 3 — execution, replay, and reconciliation
// ---------------------------------------------------------------------------

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "banking-coverage-"));
  return join(dir, "banking.db");
}

function paymentEnvelope(now = new Date("2026-07-10T10:00:00.000Z")) {
  return createBankingClient().createPaymentQuote({
    providerId: "mercury",
    requester,
    reason: "coverage replay",
    sourceAccountId: "acct_1",
    counterparty: { name: "Vendor" },
    amount: moneyFromDecimal("25.00", "USD"),
    rail: "ach",
    now,
  });
}

describe("execution workflow: replay and conflict", () => {
  test("submitting the identical envelope replays without a second execution", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    const envelope = paymentEnvelope();

    const first = await submitExecutionRequest({ store, envelope, actor: requester });
    expect(first.status).toBe("dry_run_ready");
    expect(first.outboxId).toBeDefined();
    expect(await store.listPendingOutbox()).toHaveLength(1);

    const second = await submitExecutionRequest({ store, envelope, actor: requester });
    expect(second.status).toBe("replay");
    expect(second.reasons).toContain("Existing idempotency reservation matches this request.");
    expect(await store.listPendingOutbox()).toHaveLength(1);
    expect((await store.listPendingOutbox())[0]?.attempts).toBe(0);
  });

  test("reusing the same idempotency key with a changed payload is a conflict", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    const envelope = paymentEnvelope();
    await submitExecutionRequest({ store, envelope, actor: requester });

    const conflicting = await submitExecutionRequest({
      store,
      envelope: { ...envelope, fingerprint: { key: envelope.fingerprint.key, payloadHash: hashPayload({ mutated: true }) } },
      actor: requester,
    });
    expect(conflicting.status).toBe("conflict");
    expect(conflicting.reasons).toContain("Idempotency key already exists with a different payload.");
  });

  test("approving a nonexistent intent throws the exact error", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    await expect(
      approveExecutionRequest({
        store,
        intentId: "intent_missing",
        decidedBy: { id: "finance-lead", type: "human" },
        decision: "granted",
        expiresAt: "2026-07-10T12:00:00.000Z",
      }),
    ).rejects.toThrow("Intent does not exist: intent_missing");
  });

  test("missing execution and outbox ids reject for dry-run, retry, and cancel", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    await expect(executeDryRunOutbox({ store, outboxId: "outbox_missing", actor: requester })).rejects.toThrow(
      "Outbox entry does not exist: outbox_missing",
    );
    await expect(retryExecutionOutbox({ store, outboxId: "outbox_missing", actor: requester, reason: "retry" })).rejects.toThrow(
      "Outbox entry does not exist: outbox_missing",
    );
    await expect(cancelExecutionRequest({ store, intentId: "intent_missing", actor: requester, reason: "cancel" })).rejects.toThrow(
      "Intent does not exist: intent_missing",
    );
  });
});

describe("reconciliation: matched, mismatch, indeterminate", () => {
  function event(overrides: Partial<ProviderEvent> = {}): ProviderEvent {
    return {
      id: "evt_payment_1",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "provider_payment_1",
      occurredAt: "2026-07-10T11:00:00.000Z",
      amount: moneyFromDecimal("25.00", "USD"),
      rawHash: "raw",
      ...overrides,
    };
  }

  test("a matching amount reconciles as matched with the recon_ id format", () => {
    const record = reconcileProviderEvent("intent_1", event(), moneyFromDecimal("25.00", "USD"));
    expect(record.status).toBe("matched");
    expect(record.id).toBe(`recon_${event().id}`);
    expect(record.reasons).toContain("Provider event matched local expectation.");
  });

  test("an expected amount differing from the provider amount is a mismatch with the exact reason", () => {
    const record = reconcileProviderEvent("intent_1", event(), moneyFromDecimal("24.99", "USD"));
    expect(record.status).toBe("mismatch");
    expect(record.reasons).toContain("Provider event amount does not match the expected intent amount.");

    const currencyMismatch = reconcileProviderEvent("intent_1", event({ amount: moneyFromDecimal("25.00", "EUR") }), moneyFromDecimal("25.00", "USD"));
    expect(currencyMismatch.status).toBe("mismatch");
  });

  test("an expected amount with no provider amount is indeterminate with the exact reason", () => {
    const { amount: _omitted, ...withoutAmount } = event();
    const record = reconcileProviderEvent("intent_1", withoutAmount, moneyFromDecimal("25.00", "USD"));
    expect(record.status).toBe("indeterminate");
    expect(record.reasons).toContain("Provider event omitted an amount needed for reconciliation.");
  });

  test("an event with no known local intent is indeterminate with the exact reason", () => {
    const record = reconcileProviderEvent(undefined, event(), moneyFromDecimal("25.00", "USD"));
    expect(record.status).toBe("indeterminate");
    expect(record.reasons).toContain("Provider event has no known local intent.");
  });

  test("workflow reconcileExecution persists a record keyed by the provider event", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    const providerEvent = normalizeProviderWebhookEvent({
      id: "evt_payment_1",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "provider_payment_1",
      occurredAt: "2026-07-10T11:00:00.000Z",
      amount: moneyFromDecimal("25.00", "USD"),
      rawPayload: { id: "provider_payment_1", amount: "25.00" },
    });
    const expectedIntent = paymentEnvelope().intent;

    const result = await reconcileExecution({ store, intentId: "intent_1", providerEvent, expectedIntent, actor: requester });
    expect(result.status).toBe("reconciled");
    expect(result.reconciliationId).toBe("recon_evt_payment_1");
    expect(result.reasons).toContain("Provider event matched local expectation.");
  });

  test("webhook normalization hashes canonical payloads: key order is neutral, mutation is not", () => {
    const first = normalizeProviderWebhookEvent({
      id: "evt_h",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "p_1",
      occurredAt: "2026-07-10T11:00:00.000Z",
      rawPayload: { id: "p_1", amount: "5.00" },
    });
    const reordered = normalizeProviderWebhookEvent({
      id: "evt_h",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "p_1",
      occurredAt: "2026-07-10T11:00:00.000Z",
      rawPayload: { amount: "5.00", id: "p_1" },
    });
    const mutated = normalizeProviderWebhookEvent({
      id: "evt_h",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "p_1",
      occurredAt: "2026-07-10T11:00:00.000Z",
      rawPayload: { id: "p_1", amount: "6.00" },
    });
    expect(first.rawHash).toBe(reordered.rawHash);
    expect(first.rawHash).not.toBe(mutated.rawHash);
  });
});

// ---------------------------------------------------------------------------
// Priority 4 — durable SQLite state
// ---------------------------------------------------------------------------

describe("durable sqlite store: file-backed persistence", () => {
  test("records written through one store are readable through a fresh store on the same file", async () => {
    const dbPath = tempDbPath();
    try {
      const firstStore = createSqliteDevStore({ path: dbPath });
      const envelope = paymentEnvelope();
      await firstStore.reserveIdempotency(envelope.fingerprint);
      await firstStore.saveIntent(envelope.intent, envelope.fingerprint);
      await firstStore.enqueueOutbox({
        id: "outbox_persist_1",
        topic: "provider.dry_run",
        status: "pending",
        attempts: 0,
        payload: { intentId: envelope.intent.id },
        createdAt: "2026-07-10T10:00:00.000Z",
        updatedAt: "2026-07-10T10:00:00.000Z",
      });

      const reopened = createSqliteDevStore({ path: dbPath });
      expect((await reopened.getIntent(envelope.intent.id))?.id).toBe(envelope.intent.id);
      expect((await reopened.getIntentFingerprint(envelope.intent.id))?.payloadHash).toBe(envelope.fingerprint.payloadHash);
      expect((await reopened.listPendingOutbox())[0]?.id).toBe("outbox_persist_1");
      expect((await reopened.reserveIdempotency(envelope.fingerprint)).status).toBe("replay");
    } finally {
      rmSync(join(dbPath, ".."), { recursive: true, force: true });
    }
  });

  test("reset clears the intended data and leaves the store usable", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    const envelope = paymentEnvelope();
    await submitExecutionRequest({ store, envelope, actor: requester });
    expect(await store.listPendingOutbox()).toHaveLength(1);

    await store.reset();
    expect(await store.listPendingOutbox()).toHaveLength(0);
    expect((await store.getIntent(envelope.intent.id))?.id).toBeUndefined();

    expect((await store.reserveIdempotency(envelope.fingerprint)).status).toBe("new");
    await store.saveIntent(envelope.intent, envelope.fingerprint);
    expect((await store.getIntent(envelope.intent.id))?.id).toBe(envelope.intent.id);
  });

  test("markOutboxStatus increments attempts across transitions and retry restores pending", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    await store.enqueueOutbox({
      id: "outbox_attempts_1",
      topic: "provider.dry_run",
      status: "pending",
      attempts: 0,
      payload: { intentId: "intent_1" },
      createdAt: "2026-07-10T10:00:00.000Z",
      updatedAt: "2026-07-10T10:00:00.000Z",
    });

    await store.markOutboxStatus("outbox_attempts_1", "processing");
    await store.markOutboxStatus("outbox_attempts_1", "failed");
    await store.markOutboxStatus("outbox_attempts_1", "pending");

    const [entry] = await store.listPendingOutbox();
    expect(entry?.attempts).toBe(3);
  });

  test("listPendingOutbox honors a non-default limit", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    for (let index = 1; index <= 3; index += 1) {
      await store.enqueueOutbox({
        id: `outbox_limit_${index}`,
        topic: "provider.dry_run",
        status: "pending",
        attempts: 0,
        payload: { intentId: `intent_${index}` },
        createdAt: `2026-07-10T10:0${index}:00.000Z`,
        updatedAt: `2026-07-10T10:0${index}:00.000Z`,
      });
    }
    expect(await store.listPendingOutbox()).toHaveLength(3);
    expect(await store.listPendingOutbox(2)).toHaveLength(2);
    expect((await store.listPendingOutbox(2))[0]?.id).toBe("outbox_limit_1");
  });

  test("sent-to-pending is rejected as an invalid transition", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    await store.enqueueOutbox({
      id: "outbox_sent_1",
      topic: "provider.dry_run",
      status: "pending",
      attempts: 0,
      payload: { intentId: "intent_1" },
      createdAt: "2026-07-10T10:00:00.000Z",
      updatedAt: "2026-07-10T10:00:00.000Z",
    });
    await store.markOutboxStatus("outbox_sent_1", "processing");
    await store.markOutboxStatus("outbox_sent_1", "sent");
    await expect(store.markOutboxStatus("outbox_sent_1", "pending")).rejects.toThrow(
      "Invalid outbox status transition: sent -> pending",
    );
  });
});

// ---------------------------------------------------------------------------
// Priority 5 — CLI, MCP, and audit safety
// ---------------------------------------------------------------------------

describe("cli: validation failures return non-zero with exact wording", () => {
  async function runCliCaptured(
    argv: readonly string[],
    runtime: { readonly readSecret?: (key: string) => string | undefined; readonly fetch?: typeof fetch } = {},
  ): Promise<{ readonly code: number; readonly stderr: string }> {
    const originalError = console.error;
    let stderr = "";
    console.error = (...args: unknown[]) => {
      stderr += args.join(" ");
    };
    try {
      const code = await runCli(argv, { readSecret: () => "test-token", ...runtime });
      return { code, stderr };
    } finally {
      console.error = originalError;
    }
  }

  test("--limit below 1 and above 1000 both fail with the exact message", async () => {
    const below = await runCliCaptured(["accounts", "list", "--provider", "mercury", "--live", "true", "--environment", "sandbox", "--secret-key", "fixture-secret-key", "--limit", "0"]);
    expect(below.code).not.toBe(0);
    expect(below.stderr).toContain("--limit must be between 1 and 1000.");

    const above = await runCliCaptured(["accounts", "list", "--provider", "mercury", "--live", "true", "--environment", "sandbox", "--secret-key", "fixture-secret-key", "--limit", "1001"]);
    expect(above.code).not.toBe(0);
    expect(above.stderr).toContain("--limit must be between 1 and 1000.");
  });

  test("an invalid asc/desc order fails with the exact message", async () => {
    const result = await runCliCaptured(["accounts", "list", "--provider", "mercury", "--live", "true", "--environment", "sandbox", "--secret-key", "fixture-secret-key", "--order", "sideways"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("--order must be asc or desc.");
  });

  test("an unknown safety class fails with the exact message", async () => {
    const result = await runCliCaptured(["ops", "list", "--safety", "bogus-class"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Unknown safety class: bogus-class");
  });

  test("--start-at on the wrong command fails with the exact message", async () => {
    const result = await runCliCaptured(["accounts", "list", "--provider", "mercury", "--live", "true", "--environment", "sandbox", "--secret-key", "fixture-secret-key", "--start-at", "x"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("--start-at is only supported for transactions list.");

    const allowed = await runCliCaptured(["transactions", "list", "--provider", "mercury", "--live", "true", "--environment", "sandbox", "--secret-key", "fixture-secret-key", "--start-at", "x"]);
    expect(allowed.code).toBe(1);
    expect(allowed.stderr).not.toContain("--start-at is only supported for transactions list.");
  });

  test("valid limit and order values are accepted", async () => {
    const originalError = console.error;
    const originalLog = console.log;
    let stderr = "";
    console.error = (...args: unknown[]) => {
      stderr += args.join(" ");
    };
    try {
      const code = await runCli(["accounts", "list", "--provider", "mercury", "--live", "true", "--environment", "sandbox", "--secret-key", "fixture-secret-key", "--limit", "50", "--order", "asc"], {
        readSecret: () => "test-token",
        fetch: async () => new Response(JSON.stringify({ accounts: [], page: {} })),
      });
      expect(code).toBe(0);
    } finally {
      console.error = originalError;
      console.log = originalLog;
    }
    expect(stderr).toBe("");
  });
});

describe("mcp: bare run and unknown tools fail closed", () => {
  test("runMcp() with no recognized flags exits 1 with the exact message", () => {
    expect(runMcp([])).toBe(1);
    expect(runMcp(["--help"])).toBe(0);
    expect(runMcp(["--version"])).toBe(0);
    expect(runMcp(["--list-tools"])).toBe(0);
  });

  test("an unknown MCP tool returns the default not_implemented object", () => {
    const result = runMcpTool("banking_totally_unknown_tool", {}) as {
      readonly status: string;
      readonly tool: string;
      readonly message: string;
    };
    expect(result).toEqual({
      status: "not_implemented",
      tool: "banking_totally_unknown_tool",
      message: "This MCP tool is provider-backed, admin-gated, or not implemented yet.",
    });
  });

  test("listPlannedMcpTools marks implemented and pending tools distinctly", () => {
    const planned = listPlannedMcpTools();
    expect(planned.find((tool) => tool.name === "banking_ops_list")?.status).toBe("implemented");
    expect(planned.find((tool) => tool.name === "banking_accounts_list")?.status).toBe("provider_backed_pending");
    expect(planned.find((tool) => tool.name === "banking_admin_provider_verify_operation")?.status).toBe("admin_gated");
  });
});

describe("audit: chain integrity and redaction", () => {
  test("the first audit event must not carry previousHash", () => {
    const first = appendAuditLedgerEvent({
      id: "audit_first",
      type: "intent.created",
      actor: requester,
      occurredAt: "2026-07-10T10:00:00.000Z",
      subjectId: "intent_1",
      metadata: { ok: true },
    });
    expect(verifyAuditLedger([first]).valid).toBe(true);

    const poisoned = verifyAuditLedger([{ ...first, previousHash: "not-linked" }]);
    expect(poisoned.valid).toBe(false);
    expect(poisoned.invalidEventId).toBe("audit_first");
    expect(poisoned.reasons).toContain("First audit event must not have previousHash.");
  });

  test("a tampered event hash is detected on recomputation", () => {
    const event = appendAuditLedgerEvent({
      id: "audit_tampered",
      type: "approval.decided",
      actor: requester,
      occurredAt: "2026-07-10T10:00:00.000Z",
      subjectId: "intent_1",
      metadata: { decision: "granted" },
    });
    expect(verifyAuditLedger([event]).valid).toBe(true);

    const tampered = verifyAuditLedger([{ ...event, metadata: { ...event.metadata, decision: "rejected" } }]);
    expect(tampered.valid).toBe(false);
    expect(tampered.reasons).toContain("Audit event hash does not match its canonical payload.");
  });

  test("redacts token-shaped values as scalars and array members while preserving benign text", () => {
    // Fixture token shapes are assembled at runtime (same convention as the
    // redactor source) so the literal prefixes never appear in the file.
    const anthropicShaped = ["sk", "-test-value-123"].join("");
    const patShaped = ["gh", "p_synthetic123"].join("");
    const oauthShaped = ["gh", "o_synthetic123"].join("");
    const registryShaped = ["np", "m_synthetic123"].join("");
    const jwtHeader = ["eyJhbGciOiJIUzI1NiJ9", ".abc"].join("");
    const jwtSubject = ["eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".abc"].join("");
    const nestedBearer = ["Bearer ", "sk", "-other"].join("");

    const event = createAuditEvent({
      id: "audit_redact",
      type: "provider.submitted",
      actor: requester,
      occurredAt: "2026-07-10T10:00:00.000Z",
      subjectId: "intent_1",
      metadata: {
        values: [anthropicShaped, "benign-token-value", patShaped],
        authorization: ["Bearer ", jwtHeader].join(""),
        legacyPat: ["gh", "p_synthetic456"].join(""),
        orgToken: oauthShaped,
        registryToken: registryShaped,
        jwt: jwtSubject,
        note: "keep this plain text",
        nested: { authorization: nestedBearer, ok: true },
      },
    });

    // Value-based redaction redacts each array member, preserving benign entries.
    expect(event.metadata.values).toEqual(["[REDACTED]", "benign-token-value", "[REDACTED]"]);
    expect(event.metadata.authorization).toBe("[REDACTED]");
    expect(event.metadata.legacyPat).toBe("[REDACTED]");
    expect(event.metadata.orgToken).toBe("[REDACTED]");
    expect(event.metadata.registryToken).toBe("[REDACTED]");
    expect(event.metadata.jwt).toBe("[REDACTED]");
    expect(event.metadata.note).toBe("keep this plain text");
    expect(event.metadata.nested).toEqual({ authorization: "[REDACTED]", ok: true });
    expect(verifyAuditLedger([event]).valid).toBe(true);
  });

  test("a key that names a secret redacts the whole value regardless of its members", () => {
    const event = createAuditEvent({
      id: "audit_redact_key",
      type: "provider.submitted",
      actor: requester,
      occurredAt: "2026-07-10T10:00:00.000Z",
      subjectId: "intent_1",
      metadata: {
        tokens: ["benign-token-value"],
        headers: { authorization: "Bearer sk-other", "x-request-id": "req-1" },
      },
    });

    expect(event.metadata.tokens).toBe("[REDACTED]");
    expect(event.metadata.headers).toEqual({ authorization: "[REDACTED]", "x-request-id": "req-1" });
  });
});
