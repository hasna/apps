/**
 * TEST-GAP suite: execution workflow failure paths.
 *
 * AGENT-AUTHORED — the gpt-5.6-sol advisory consult was attempted on two
 * distinct provider accounts and refused at the capacity wall on both
 * ("Selected model is at capacity. Please try a different model."), so this
 * spec was produced from direct source analysis, not attributed to SOL.
 *
 * tests/execution-workflow.test.ts covers the happy paths. This file locks
 * the paths it never exercises: policy-deny submission, idempotency replay
 * and conflict submission, expired approvals, missing intents and outbox
 * entries, and reconciliation mismatch outcomes through the workflow.
 */
import { describe, expect, test } from "bun:test";
import {
  approveExecutionRequest,
  cancelExecutionRequest,
  createBankingClient,
  createSqliteDevStore,
  executeDryRunOutbox,
  moneyFromDecimal,
  normalizeProviderWebhookEvent,
  reconcileExecution,
  retryExecutionOutbox,
  submitExecutionRequest,
  type ActorRef,
  type IntentEnvelope,
} from "../src/index.ts";

const requester: ActorRef = { id: "agent-workflow-edge", type: "agent" };
const approver: ActorRef = { id: "finance-approver", type: "human" };

function paymentEnvelope(overrides: Partial<Parameters<ReturnType<typeof createBankingClient>["createPaymentRequest"]>[0]> = {}): IntentEnvelope {
  return createBankingClient().createPaymentRequest({
    providerId: "mercury",
    requester,
    reason: "workflow edge",
    sourceAccountId: "acct_1",
    counterparty: { name: "Vendor", providerRecipientId: "recipient_1" },
    amount: moneyFromDecimal("25.00", "USD"),
    rail: "ach",
    now: new Date("2026-07-06T10:00:00.000Z"),
    ...overrides,
  });
}

describe("execution workflow failure paths", () => {
  test("policy-denied submissions never reach the outbox", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    const negative = paymentEnvelope({ amount: moneyFromDecimal("-5.00", "USD") });
    const result = await submitExecutionRequest({ store, envelope: negative, actor: requester });

    expect(result.status).toBe("denied");
    expect(result.outboxId).toBeUndefined();
    expect(await store.listPendingOutbox()).toHaveLength(0);
    // The intent itself is persisted for audit, but nothing was queued.
    expect((await store.getIntent(negative.intent.id))?.id).toBe(negative.intent.id);
  });

  test("identical resubmissions are replayed without side effects", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    const envelope = paymentEnvelope();
    const first = await submitExecutionRequest({ store, envelope, actor: requester });
    const replay = await submitExecutionRequest({ store, envelope, actor: requester });

    expect(first.status).toBe("approval_required");
    expect(replay.status).toBe("replay");
    expect(replay.outboxId).toBeUndefined();
    expect(await store.listPendingOutbox()).toHaveLength(0);
  });

  test("same idempotency key with a different payload is a conflict", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    const envelope = paymentEnvelope();
    await submitExecutionRequest({ store, envelope, actor: requester });

    const conflicting = {
      ...envelope,
      fingerprint: { key: envelope.fingerprint.key, payloadHash: "different-payload-hash" },
    };
    const result = await submitExecutionRequest({ store, envelope: conflicting, actor: requester });
    expect(result.status).toBe("conflict");
    expect(result.reasons).toContain("Idempotency key already exists with a different payload.");
    expect(result.outboxId).toBeUndefined();
  });

  test("a granted but expired approval records the decision but queues nothing", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    const envelope = paymentEnvelope();
    await submitExecutionRequest({ store, envelope, actor: requester });

    const result = await approveExecutionRequest({
      store,
      intentId: envelope.intent.id,
      decidedBy: approver,
      decision: "granted",
      expiresAt: "2026-07-06T09:00:00.000Z", // expired before the 10:30 decision time
      now: new Date("2026-07-06T10:30:00.000Z"),
    });

    expect(result.status).toBe("approved");
    expect(result.reasons).toContain("Approval is expired.");
    expect(result.outboxId).toBeUndefined();
    expect(await store.listPendingOutbox()).toHaveLength(0);
  });

  test("approving an unknown intent fails closed", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    await expect(approveExecutionRequest({
      store,
      intentId: "ghost-intent",
      decidedBy: approver,
      decision: "granted",
      expiresAt: "2026-07-06T12:00:00.000Z",
    })).rejects.toThrow("Intent does not exist: ghost-intent");
  });

  test("executing or retrying a missing outbox fails closed", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    await expect(executeDryRunOutbox({ store, outboxId: "missing", actor: requester }))
      .rejects.toThrow("Outbox entry does not exist: missing");
    await expect(retryExecutionOutbox({ store, outboxId: "missing", actor: requester, reason: "why" }))
      .rejects.toThrow("Outbox entry does not exist: missing");
  });

  test("cancelling an unknown intent fails closed", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    await expect(cancelExecutionRequest({ store, intentId: "ghost-intent", actor: requester, reason: "why" }))
      .rejects.toThrow("Intent does not exist: ghost-intent");
  });

  test("reconciliation reports mismatches and missing amounts as explicit outcomes", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    const envelope = paymentEnvelope();
    await submitExecutionRequest({ store, envelope, actor: requester });

    const mismatchedEvent = normalizeProviderWebhookEvent({
      id: "evt_wf_mismatch",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "payment_1",
      occurredAt: "2026-07-06T11:00:00.000Z",
      amount: moneyFromDecimal("99.00", "USD"),
      rawPayload: { id: "payment_1", amount: "99.00" },
    });
    const mismatch = await reconcileExecution({ store, intentId: envelope.intent.id, expectedIntent: envelope.intent, providerEvent: mismatchedEvent, actor: requester });
    expect(mismatch.status).toBe("reconciled");
    expect(mismatch.reasons).toContain("Provider event amount does not match the expected intent amount.");

    const noAmountEvent = normalizeProviderWebhookEvent({
      id: "evt_wf_no_amount",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "payment_2",
      occurredAt: "2026-07-06T11:05:00.000Z",
      rawPayload: { id: "payment_2" },
    });
    const noAmount = await reconcileExecution({ store, intentId: envelope.intent.id, expectedIntent: envelope.intent, providerEvent: noAmountEvent, actor: requester });
    expect(noAmount.status).toBe("reconciled");
    expect(noAmount.reasons).toContain("Provider event omitted an amount needed for reconciliation.");
  });
});
