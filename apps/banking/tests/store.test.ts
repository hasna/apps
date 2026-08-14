import { describe, expect, test } from "bun:test";
import {
  appendAuditLedgerEvent,
  createApprovalRecord,
  createBankingClient,
  createIntentFingerprint,
  createReconciliationHook,
  createSqliteDevStore,
  getProvider,
  moneyFromDecimal,
  normalizeProviderWebhookEvent,
  preflightProviderEnv,
  preflightProviderScopes,
  verifyAuditLedger,
  type ActorRef,
} from "../src/index.ts";

const requester: ActorRef = { id: "agent-store", type: "agent" };
const approver: ActorRef = { id: "finance-reviewer", type: "human" };

describe("dev safety store", () => {
  test("reserves idempotency, persists intents, and detects conflicts", async () => {
    const store = createSqliteDevStore();
    const envelope = createBankingClient().createPaymentRequest({
      providerId: "mercury",
      requester,
      reason: "store test",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("10.00", "USD"),
      rail: "ach",
      now: new Date("2026-06-29T10:00:00.000Z"),
    });

    expect(await store.reserveIdempotency(envelope.fingerprint)).toEqual({ status: "new", key: envelope.fingerprint.key });
    expect(await store.reserveIdempotency(envelope.fingerprint)).toEqual({ status: "replay", key: envelope.fingerprint.key });
    expect((await store.reserveIdempotency({ key: envelope.fingerprint.key, payloadHash: "different" })).status).toBe("conflict");
    await expect(store.saveIntent(envelope.intent, { ...envelope.fingerprint, payloadHash: "different" })).rejects.toThrow(
      "Idempotency reservation payload hash does not match",
    );

    await store.saveIntent(envelope.intent, envelope.fingerprint);
    expect((await store.getIntent(envelope.intent.id))?.id).toBe(envelope.intent.id);
    expect((await store.getIntentFingerprint(envelope.intent.id))?.payloadHash).toBe(envelope.fingerprint.payloadHash);
  });

  test("stores approvals, audit events, reconciliation records, and outbox entries", async () => {
    const store = createSqliteDevStore();
    const client = createBankingClient();
    const envelope = client.createPaymentRequest({
      providerId: "mercury",
      requester,
      reason: "outbox test",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("5.00", "USD"),
      rail: "ach",
      now: new Date("2026-06-29T10:00:00.000Z"),
    });
    const approval = createApprovalRecord({
      id: "approval_store_1",
      intent: envelope.intent,
      decidedBy: approver,
      decision: "granted",
      policySnapshot: envelope.policyDecision.snapshot,
      expiresAt: "2026-06-29T12:00:00.000Z",
      decidedAt: "2026-06-29T10:30:00.000Z",
    });
    const audit = appendAuditLedgerEvent({
      id: "audit_store_1",
      type: "approval.decided",
      actor: approver,
      occurredAt: "2026-06-29T10:30:00.000Z",
      subjectId: envelope.intent.id,
      metadata: { decision: "granted" },
    });
    const event = normalizeProviderWebhookEvent({
      id: "evt_store_1",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "provider_payment_1",
      occurredAt: "2026-06-29T10:40:00.000Z",
      amount: moneyFromDecimal("5.00", "USD"),
      rawPayload: { id: "provider_payment_1", amount: "5.00" },
    });
    const reconciliation = createReconciliationHook({
      intentId: envelope.intent.id,
      providerEvent: event,
      expectedAmount: moneyFromDecimal("5.00", "USD"),
    });

    await store.reserveIdempotency(envelope.fingerprint);
    await store.saveIntent(envelope.intent, envelope.fingerprint);
    await store.saveApproval(approval);
    await store.appendAuditEvent(audit);
    await store.saveReconciliation(reconciliation);
    await store.enqueueOutbox({
      id: "outbox_1",
      topic: "provider.submit",
      status: "pending",
      attempts: 0,
      payload: { intentId: envelope.intent.id },
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    });

    expect((await store.listPendingOutbox())[0]?.id).toBe("outbox_1");
    await store.markOutboxStatus("outbox_1", "processing", new Date("2026-06-29T10:30:00.000Z"));
    await store.markOutboxStatus("outbox_1", "sent", new Date("2026-06-29T11:00:00.000Z"));
    expect(await store.listPendingOutbox()).toHaveLength(0);
  });

  test("dev store rejects immutable overwrites and invalid outbox transitions", async () => {
    const store = createSqliteDevStore();
    const envelope = createBankingClient().createPaymentRequest({
      providerId: "mercury",
      requester,
      reason: "immutability test",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("5.00", "USD"),
      rail: "ach",
    });

    await store.reserveIdempotency(envelope.fingerprint);
    await store.saveIntent(envelope.intent, envelope.fingerprint);
    await expect(store.saveIntent(envelope.intent, envelope.fingerprint)).rejects.toThrow();
    await expect(store.saveIntent(envelope.intent, { key: "missing", payloadHash: envelope.fingerprint.payloadHash })).rejects.toThrow(
      "Idempotency reservation does not exist",
    );
    await expect(store.enqueueOutbox({
      id: "outbox_invalid_start",
      topic: "provider.submit",
      status: "processing",
      attempts: 1,
      payload: { intentId: envelope.intent.id },
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    })).rejects.toThrow("Outbox entries must be enqueued with pending status");
    await expect(store.enqueueOutbox({
      id: "outbox_invalid_attempts",
      topic: "provider.submit",
      status: "pending",
      attempts: 1,
      payload: { intentId: envelope.intent.id },
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    })).rejects.toThrow("Outbox entries must be enqueued with zero attempts");
    await store.enqueueOutbox({
      id: "outbox_immutable",
      topic: "provider.submit",
      status: "pending",
      attempts: 0,
      payload: { intentId: envelope.intent.id },
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    });
    await expect(store.markOutboxStatus("outbox_immutable", "sent")).rejects.toThrow("Invalid outbox status transition");
    await expect(store.markOutboxStatus("missing", "sent")).rejects.toThrow("Outbox entry does not exist");
  });
});

describe("safety helpers", () => {
  test("approval helpers bind decisions to intent fingerprints", () => {
    const envelope = createBankingClient().createPaymentRequest({
      providerId: "mercury",
      requester,
      reason: "approval helper test",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("1.00", "USD"),
      rail: "ach",
    });
    const approval = createApprovalRecord({
      id: "approval_1",
      intent: envelope.intent,
      decidedBy: approver,
      decision: "rejected",
      reason: "too broad",
      policySnapshot: envelope.policyDecision.snapshot,
      expiresAt: "2026-06-29T12:00:00.000Z",
    });

    expect(approval.intentPayloadHash).toBe(createIntentFingerprint(envelope.intent).payloadHash);
    expect(approval.decision).toBe("rejected");
  });

  test("audit ledger verifies hash-chain continuity", () => {
    const first = appendAuditLedgerEvent({
      id: "audit_1",
      type: "intent.created",
      actor: requester,
      occurredAt: "2026-06-29T10:00:00.000Z",
      subjectId: "intent_1",
      metadata: { ok: true },
    });
    const second = appendAuditLedgerEvent({
      id: "audit_2",
      type: "policy.evaluated",
      actor: requester,
      occurredAt: "2026-06-29T10:01:00.000Z",
      subjectId: "intent_1",
      metadata: { result: "requires_approval" },
    }, first);

    expect(verifyAuditLedger([first, second]).valid).toBe(true);
    expect(verifyAuditLedger([{ ...second, previousHash: "wrong" }]).valid).toBe(false);
  });

  test("provider env and scope preflights fail closed", () => {
    const provider = getProvider("revolut-business");
    const bcr = getProvider("erste-bcr");
    if (!provider) throw new Error("missing provider");
    if (!bcr) throw new Error("missing provider");

    const env = preflightProviderEnv("revolut-business", {
      REVOLUT_CLIENT_ID: "client",
      UNRELATED_SECRET: "blocked",
    });
    const scopes = preflightProviderScopes(provider, "sensitiveCardData", ["READ"]);

    const unsupported = preflightProviderScopes(bcr, "cards", []);

    expect(env.allowedKeys).toContain("REVOLUT_CLIENT_ID");
    expect(JSON.stringify(env)).not.toContain("client");
    expect(env.rejectedKeys).toContain("UNRELATED_SECRET");
    expect(env.missingRequiredKeys).toContain("REVOLUT_PRIVATE_KEY");
    expect(scopes.allowed).toBe(false);
    expect(scopes.missingScopes).toContain("READ_SENSITIVE_CARD_DATA");
    expect(unsupported.allowed).toBe(false);
    expect(unsupported.unsupportedReason).toBe("Provider does not support card scope operations.");
  });

  test("webhook normalization feeds reconciliation hooks", () => {
    const event = normalizeProviderWebhookEvent({
      id: "evt_1",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "payment_1",
      occurredAt: "2026-06-29T10:00:00.000Z",
      amount: moneyFromDecimal("2.00", "USD"),
      rawPayload: { amount: "2.00", id: "payment_1" },
    });
    const record = createReconciliationHook({
      intentId: "intent_1",
      providerEvent: event,
      expectedAmount: moneyFromDecimal("2.00", "USD"),
    });

    expect(event.rawHash).toHaveLength(64);
    expect(record.status).toBe("matched");
  });
});
