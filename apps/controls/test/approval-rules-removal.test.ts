// Sol-guided coverage (tests-coverage-sol workflow, lane controls) — Priority 3:
// approval-rule deletion scope (src/services/approval-rules.ts). The existing
// approval-tiers.test.ts proves a deleted rule removes the requirement; this
// file pins the SIBLING side: deleting one rule leaves the others' thresholds
// and counts intact, and the list reflects exactly the surviving rules.
import { describe, expect, it } from "bun:test";
import { memoryDb, SYS } from "./helpers/db.js";
import { createPolicy } from "../src/services/policies.js";
import { allowCounterparty } from "../src/services/allowlists.js";
import {
  createApprovalRule,
  deleteApprovalRule,
  listApprovalRules,
  requiredApprovalsFor,
} from "../src/services/approval-rules.js";

function entity(): string {
  return crypto.randomUUID();
}

function seed(db: ReturnType<typeof memoryDb>, e: string): void {
  createPolicy(db, { entity_id: e, window: "day", amount_limit: 1_000_000, currency: "USD" }, SYS);
  allowCounterparty(db, { entity_id: e, counterparty_id: "cp-1" }, SYS);
}

describe("approval rules: deletion removes only the selected rule", () => {
  it("sibling thresholds and counts survive; the list shows exactly the remainder (two-sided)", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const low = createApprovalRule(db, { entity_id: e, tier: "low", threshold_amount: 10_000, currency: "USD", required_approvals: 1 }, SYS);
    const high = createApprovalRule(db, { entity_id: e, tier: "high", threshold_amount: 50_000, currency: "USD", required_approvals: 3 }, SYS);

    // Two different thresholds → the maximum required count wins per amount.
    expect(requiredApprovalsFor(db, e, 20_000, "USD")).toBe(1);
    expect(requiredApprovalsFor(db, e, 60_000, "USD")).toBe(3);

    // List order is by threshold_amount, ascending.
    expect(listApprovalRules(db, { entity_id: e }, SYS).map((r) => r.id)).toEqual([low.id, high.id]);

    const deleted = deleteApprovalRule(db, { entity_id: e, id: high.id }, SYS);
    expect(deleted).toEqual({ id: high.id, deleted: true });

    // The low tier survives: the requirement for large amounts drops to 1, not 0.
    expect(requiredApprovalsFor(db, e, 60_000, "USD")).toBe(1);
    const remaining = listApprovalRules(db, { entity_id: e }, SYS);
    expect(remaining.map((r) => r.id)).toEqual([low.id]);
    expect(remaining.map((r) => r.id)).not.toContain(high.id);

    // Deleting the last rule removes the requirement entirely.
    deleteApprovalRule(db, { entity_id: e, id: low.id }, SYS);
    expect(requiredApprovalsFor(db, e, 1_000_000, "USD")).toBe(0);
    expect(listApprovalRules(db, { entity_id: e }, SYS)).toEqual([]);
  });
});
