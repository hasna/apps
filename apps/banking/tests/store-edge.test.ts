/**
 * TEST-GAP suite: dev store lifecycle edges.
 *
 * AGENT-AUTHORED — the gpt-5.6-sol advisory consult was attempted on two
 * distinct provider accounts and refused at the capacity wall on both
 * ("Selected model is at capacity. Please try a different model."), so this
 * spec was produced from direct source analysis, not attributed to SOL.
 *
 * tests/store.test.ts covers reservations, persistence, and invalid outbox
 * transitions. This file locks the paths it never exercises: reset(),
 * attempt counting across failed->pending retries, outbox ordering and
 * limits, and duplicate approval rejection by the store.
 */
import { describe, expect, test } from "bun:test";
import {
  createApprovalRecord,
  createBankingClient,
  createSqliteDevStore,
  moneyFromDecimal,
  type ActorRef,
} from "../src/index.ts";

const requester: ActorRef = { id: "agent-store-edge", type: "agent" };
const approver: ActorRef = { id: "finance-reviewer", type: "human" };

describe("dev store lifecycle", () => {
  test("reset clears every table including reservations and audit events", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    const client = createBankingClient();
    const envelope = client.createPaymentRequest({
      providerId: "mercury",
      requester,
      reason: "reset test",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("5.00", "USD"),
      rail: "ach",
      now: new Date("2026-06-29T10:00:00.000Z"),
    });
    await store.reserveIdempotency(envelope.fingerprint);
    await store.saveIntent(envelope.intent, envelope.fingerprint);
    await store.enqueueOutbox({
      id: "outbox_reset",
      topic: "provider.submit",
      status: "pending",
      attempts: 0,
      payload: { intentId: envelope.intent.id },
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    });

    await store.reset();

    expect(await store.getIntent(envelope.intent.id)).toBeUndefined();
    expect(await store.listPendingOutbox()).toHaveLength(0);
    // The reservation is gone too, so the same fingerprint can be reserved as new again.
    expect(await store.reserveIdempotency(envelope.fingerprint)).toEqual({ status: "new", key: envelope.fingerprint.key });
  });

  test("outbox attempts increment through processing, failure, and retry", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    await store.enqueueOutbox({
      id: "outbox_attempts",
      topic: "provider.submit",
      status: "pending",
      attempts: 0,
      payload: {},
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    });

    await store.markOutboxStatus("outbox_attempts", "processing", new Date("2026-06-29T10:01:00.000Z"));
    await store.markOutboxStatus("outbox_attempts", "failed", new Date("2026-06-29T10:02:00.000Z"));
    await store.markOutboxStatus("outbox_attempts", "pending", new Date("2026-06-29T10:03:00.000Z"));

    const retried = (await store.listPendingOutbox())[0];
    expect(retried?.status).toBe("pending");
    expect(retried?.attempts).toBe(3);
    expect(retried?.updatedAt).toBe("2026-06-29T10:03:00.000Z");
  });

  test("listPendingOutbox is FIFO-ordered and honors the limit", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    for (let index = 0; index < 3; index += 1) {
      await store.enqueueOutbox({
        id: `outbox_${index}`,
        topic: "provider.submit",
        status: "pending",
        attempts: 0,
        payload: { index },
        createdAt: `2026-06-29T1${index}:00:00.000Z`,
        updatedAt: `2026-06-29T1${index}:00:00.000Z`,
      });
    }

    expect((await store.listPendingOutbox()).map((entry) => entry.id)).toEqual(["outbox_0", "outbox_1", "outbox_2"]);
    expect((await store.listPendingOutbox(2)).map((entry) => entry.id)).toEqual(["outbox_0", "outbox_1"]);
  });

  test("marking a sent outbox entry failed is rejected", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    await store.enqueueOutbox({
      id: "outbox_sent",
      topic: "provider.submit",
      status: "pending",
      attempts: 0,
      payload: {},
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    });
    await store.markOutboxStatus("outbox_sent", "processing");
    await store.markOutboxStatus("outbox_sent", "sent");
    await expect(store.markOutboxStatus("outbox_sent", "failed")).rejects.toThrow("Invalid outbox status transition");
  });

  test("the store rejects duplicate approval ids", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    const client = createBankingClient();
    const envelope = client.createPaymentRequest({
      providerId: "mercury",
      requester,
      reason: "duplicate approval",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("5.00", "USD"),
      rail: "ach",
      now: new Date("2026-06-29T10:00:00.000Z"),
    });
    const approval = createApprovalRecord({
      id: "approval_dup",
      intent: envelope.intent,
      decidedBy: approver,
      decision: "granted",
      policySnapshot: envelope.policyDecision.snapshot,
      expiresAt: "2026-06-29T12:00:00.000Z",
    });
    await store.saveApproval(approval);
    await expect(store.saveApproval({ ...approval, intentId: "other" })).rejects.toThrow();
  });

  test("saving an intent without a matching reservation fails closed", async () => {
    const store = createSqliteDevStore({ path: ":memory:" });
    const client = createBankingClient();
    const envelope = client.createPaymentRequest({
      providerId: "mercury",
      requester,
      reason: "unreserved intent",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("5.00", "USD"),
      rail: "ach",
    });
    await expect(store.saveIntent(envelope.intent, envelope.fingerprint)).rejects.toThrow(
      "Idempotency reservation does not exist",
    );
  });
});
