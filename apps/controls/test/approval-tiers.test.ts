// Agent-authored test-gap analysis (SOL consult timed out before delivering a
// spec; this file was written from direct source analysis, never attributed to SOL).
import { describe, expect, it } from "bun:test";
import { memoryDb, SYS } from "./helpers/db.js";
import { createPolicy } from "../src/services/policies.js";
import { allowCounterparty } from "../src/services/allowlists.js";
import { createApprovalRule, deleteApprovalRule, requiredApprovalsFor } from "../src/services/approval-rules.js";
import { requestAuthorization } from "../src/services/authorizations.js";
import type { Authorization } from "../src/types/index.js";

function entity(): string {
  return crypto.randomUUID();
}

function seed(db: ReturnType<typeof memoryDb>, e: string): void {
  createPolicy(db, { entity_id: e, window: "day", amount_limit: 1_000_000, currency: "USD" }, SYS);
  allowCounterparty(db, { entity_id: e, counterparty_id: "cp-1" }, SYS);
}

describe("approval tiers: threshold semantics", () => {
  it("requiredApprovalsFor takes the max across all matching tiers", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    createApprovalRule(db, { entity_id: e, tier: "low", threshold_amount: 10_000, currency: "USD", required_approvals: 1 }, SYS);
    createApprovalRule(db, { entity_id: e, tier: "high", threshold_amount: 50_000, currency: "USD", required_approvals: 2 }, SYS);
    expect(requiredApprovalsFor(db, e, 9_999, "USD")).toBe(0);
    expect(requiredApprovalsFor(db, e, 10_000, "USD")).toBe(1);
    expect(requiredApprovalsFor(db, e, 49_999, "USD")).toBe(1);
    expect(requiredApprovalsFor(db, e, 50_000, "USD")).toBe(2);
    expect(requiredApprovalsFor(db, e, 1_000_000, "USD")).toBe(2);
  });

  it("rules are currency-scoped", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    createApprovalRule(db, { entity_id: e, tier: "high", threshold_amount: 10_000, currency: "EUR", required_approvals: 2 }, SYS);
    // A USD request sees no matching rule: auto-approved with a token.
    expect(requiredApprovalsFor(db, e, 1_000_000, "USD")).toBe(0);
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 20_000, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(auth.status).toBe("approved");
    expect(auth.token).toBeTruthy();
    // The EUR request requires 2 approvals.
    expect(requiredApprovalsFor(db, e, 20_000, "EUR")).toBe(2);
  });

  it("deleting a rule removes the approval requirement", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const rule = createApprovalRule(db, { entity_id: e, tier: "high", threshold_amount: 10_000, currency: "USD", required_approvals: 1 }, SYS);
    const before = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 20_000, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(before.status).toBe("pending");
    deleteApprovalRule(db, { entity_id: e, id: rule.id }, SYS);
    const after = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 20_000, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(after.status).toBe("approved");
    expect(after.token).toBeTruthy();
  });

  it("clamps a required_approvals below 1 up to 1", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const rule = createApprovalRule(db, { entity_id: e, tier: "high", threshold_amount: 10_000, currency: "USD", required_approvals: 0 }, SYS);
    expect(rule.required_approvals).toBe(1);
  });
});
