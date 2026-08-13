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
} from "../src/index.ts";

const requester: ActorRef = { id: "agent-banking", type: "agent" };
const approver: ActorRef = { id: "finance-approver", type: "human" };

function paymentEnvelope() {
  return createBankingClient().createPaymentRequest({
    providerId: "mercury",
    requester,
    reason: "workflow test",
    sourceAccountId: "acct_1",
    counterparty: { name: "Vendor", providerRecipientId: "recipient_1" },
    amount: moneyFromDecimal("25.00", "USD"),
    rail: "ach",
    now: new Date("2026-07-06T10:00:00.000Z"),
  });
}

describe("execution safety workflow", () => {
  test("submit persists the request and stops at approval_required before side effects", async () => {
    const store = createSqliteDevStore();
    const envelope = paymentEnvelope();
    const result = await submitExecutionRequest({ store, envelope, actor: requester, now: new Date("2026-07-06T10:00:00.000Z") });

    expect(result.status).toBe("approval_required");
    expect(result.outboxId).toBeUndefined();
    expect((await store.getIntent(envelope.intent.id))?.id).toBe(envelope.intent.id);
    expect(await store.listPendingOutbox()).toHaveLength(0);
  });

  test("approval queues only a dry-run provider plan with side effects disabled", async () => {
    const store = createSqliteDevStore();
    const envelope = paymentEnvelope();
    await submitExecutionRequest({ store, envelope, actor: requester });

    const approved = await approveExecutionRequest({
      store,
      intentId: envelope.intent.id,
      decidedBy: approver,
      decision: "granted",
      expiresAt: "2026-07-06T12:00:00.000Z",
      now: new Date("2026-07-06T10:30:00.000Z"),
    });

    expect(approved.status).toBe("dry_run_ready");
    const [outbox] = await store.listPendingOutbox();
    expect(outbox?.topic).toBe("provider.dry_run");
    expect(outbox?.payload.providerSideEffectsEnabled).toBe(false);
    expect(outbox?.payload.releaseGates).toContain("provider_sandbox");
  });

  test("execute marks the dry-run outbox sent without provider movement", async () => {
    const store = createSqliteDevStore();
    const envelope = paymentEnvelope();
    await submitExecutionRequest({ store, envelope, actor: requester });
    const approved = await approveExecutionRequest({
      store,
      intentId: envelope.intent.id,
      decidedBy: approver,
      decision: "granted",
      expiresAt: "2026-07-06T12:00:00.000Z",
      now: new Date("2026-07-06T10:30:00.000Z"),
    });
    if (!approved.outboxId) throw new Error("missing outbox");

    const executed = await executeDryRunOutbox({ store, outboxId: approved.outboxId, actor: requester });

    expect(executed.status).toBe("dry_run_sent");
    expect(await store.listPendingOutbox()).toHaveLength(0);
  });

  test("cancel, retry, and reconcile produce explicit workflow states", async () => {
    const store = createSqliteDevStore();
    const envelope = paymentEnvelope();
    await submitExecutionRequest({ store, envelope, actor: requester });
    const approved = await approveExecutionRequest({
      store,
      intentId: envelope.intent.id,
      decidedBy: approver,
      decision: "granted",
      expiresAt: "2026-07-06T12:00:00.000Z",
      now: new Date("2026-07-06T10:30:00.000Z"),
    });
    if (!approved.outboxId) throw new Error("missing outbox");
    await store.markOutboxStatus(approved.outboxId, "processing");
    await store.markOutboxStatus(approved.outboxId, "failed");

    const retried = await retryExecutionOutbox({ store, outboxId: approved.outboxId, actor: requester, reason: "transient provider health" });
    const cancelled = await cancelExecutionRequest({ store, intentId: envelope.intent.id, actor: requester, reason: "operator cancelled" });
    const providerEvent = normalizeProviderWebhookEvent({
      id: "evt_workflow_1",
      providerId: "mercury",
      kind: "payment",
      providerObjectId: "payment_1",
      occurredAt: "2026-07-06T11:00:00.000Z",
      amount: moneyFromDecimal("25.00", "USD"),
      rawPayload: { id: "payment_1", amount: "25.00" },
    });
    const reconciled = await reconcileExecution({ store, intentId: envelope.intent.id, expectedIntent: envelope.intent, providerEvent, actor: requester });

    expect(retried.status).toBe("retry_pending");
    expect(cancelled.status).toBe("cancelled");
    expect(reconciled.status).toBe("reconciled");
    expect(reconciled.reasons).toContain("Provider event matched local expectation.");
  });
});
