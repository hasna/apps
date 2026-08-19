/**
 * TEST-GAP suite: approval gate edge conditions.
 *
 * AGENT-AUTHORED — the gpt-5.6-sol advisory consult was attempted on two
 * distinct provider accounts and refused at the capacity wall on both
 * ("Selected model is at capacity. Please try a different model."), so this
 * spec was produced from direct source analysis, not attributed to SOL.
 *
 * Locks gaps in tests/core.test.ts approval coverage: expiry at the exact
 * boundary, wrong intent id, wrong idempotency key, policy-snapshot
 * mismatch, rejected decisions, and the granted allow path.
 */
import { describe, expect, test } from "bun:test";
import {
  canExecuteWithApproval,
  createApprovalRecord,
  createBankingClient,
  createIntentFingerprint,
  evaluateIntentPolicy,
  moneyFromDecimal,
  type ActorRef,
  type ApprovalRecord,
  type BankingIntent,
} from "../src/index.ts";

const requester: ActorRef = { id: "agent-approvals", type: "agent" };
const approver: ActorRef = { id: "finance-lead", type: "human" };
const NOW = new Date("2026-06-29T11:00:00.000Z");

function grantedApproval(): { intent: BankingIntent; approval: ApprovalRecord } {
  const client = createBankingClient();
  const envelope = client.createPaymentRequest({
    providerId: "mercury",
    requester,
    reason: "approval edge",
    sourceAccountId: "acct_1",
    counterparty: { name: "Vendor", providerRecipientId: "recipient_1" },
    amount: moneyFromDecimal("25.00", "USD"),
    rail: "ach",
    now: new Date("2026-06-29T10:00:00.000Z"),
  });
  const approval = createApprovalRecord({
    id: "approval_edge_ok",
    intent: envelope.intent,
    decidedBy: approver,
    decision: "granted",
    policySnapshot: envelope.policyDecision.snapshot,
    expiresAt: "2026-06-29T12:00:00.000Z",
    decidedAt: "2026-06-29T10:00:00.000Z",
  });
  return { intent: envelope.intent, approval };
}

describe("approval gate", () => {
  test("a granted, unexpired, matching approval permits execution", () => {
    const { intent, approval } = grantedApproval();
    const decision = canExecuteWithApproval(intent, approval, NOW);
    expect(decision).toEqual({ allowed: true, reasons: ["Approval permits execution."] });
  });

  test("an approval expired at the exact boundary is rejected", () => {
    const { intent, approval } = grantedApproval();
    const decision = canExecuteWithApproval(intent, { ...approval, expiresAt: "2026-06-29T11:00:00.000Z" }, NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("Approval is expired.");
  });

  test("an approval for a different intent id is rejected", () => {
    const { intent, approval } = grantedApproval();
    const decision = canExecuteWithApproval({ ...intent, id: "intent_other" }, approval, NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("Approval does not belong to the intent.");
  });

  test("an approval with a different idempotency key is rejected", () => {
    const { intent, approval } = grantedApproval();
    const decision = canExecuteWithApproval({ ...intent, idempotencyKey: "payment:other" }, approval, NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("Approval idempotency key does not match the intent.");
  });

  test("a rejected approval is rejected with its decision named", () => {
    const { intent, approval } = grantedApproval();
    const decision = canExecuteWithApproval(intent, { ...approval, decision: "rejected" }, NOW);
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("Approval is rejected.");
  });

  test("a policy snapshot from a different intent type or provider is rejected", () => {
    const { intent, approval } = grantedApproval();
    const wrongType = canExecuteWithApproval(intent, {
      ...approval,
      policySnapshot: { ...approval.policySnapshot, intentType: "payment.quote" },
    }, NOW);
    expect(wrongType.allowed).toBe(false);
    expect(wrongType.reasons).toContain("Approval policy snapshot does not match the intent.");

    const wrongProvider = canExecuteWithApproval(intent, {
      ...approval,
      policySnapshot: { ...approval.policySnapshot, providerId: "bunq" },
    }, NOW);
    expect(wrongProvider.allowed).toBe(false);
    expect(wrongProvider.reasons).toContain("Approval policy snapshot does not match the intent.");
  });

  test("createApprovalRecord binds the intent payload hash and defaults decidedAt", () => {
    const client = createBankingClient();
    const envelope = client.createPaymentRequest({
      providerId: "mercury",
      requester,
      reason: "approval record",
      sourceAccountId: "acct_1",
      counterparty: { name: "Vendor" },
      amount: moneyFromDecimal("5.00", "USD"),
      rail: "ach",
      now: new Date("2026-06-29T10:00:00.000Z"),
    });
    const approval = createApprovalRecord({
      id: "approval_record_1",
      intent: envelope.intent,
      decidedBy: approver,
      decision: "granted",
      policySnapshot: envelope.policyDecision.snapshot,
      expiresAt: "2026-06-29T12:00:00.000Z",
    });
    expect(approval.intentId).toBe(envelope.intent.id);
    expect(approval.intentIdempotencyKey).toBe(envelope.intent.idempotencyKey);
    expect(approval.intentPayloadHash).toBe(createIntentFingerprint(envelope.intent).payloadHash);
    expect(approval.requestedBy).toEqual(requester);
    expect(approval.decidedAt).toBeDefined();
    expect(Number.isNaN(Date.parse(approval.decidedAt))).toBe(false);
  });
});
