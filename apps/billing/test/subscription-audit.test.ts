// Sol-guided coverage (tests-coverage-sol workflow, 2026-08-19).
//
// Priority 2 — subscription cancel state machine with a recording Stripe
// adapter: immediate cancellation requires an approval_ref, calls Stripe
// cancelSubscription EXACTLY once, lands status=canceled, and appends the
// approve_cancel_subscription audit entry carrying the approval ref;
// at_period_end sets the flag WITHOUT any Stripe call and WITHOUT approval.
// Audit effects are asserted from the append-only ledger, not just from the
// returned object.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { freshDb, systemContext, TEST_ENTITY_A } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { getOp } from "../src/services/registry.js";
import { runOp, type ServiceContext } from "../src/services/context.js";
import { MockStripeAdapter, setStripeAdapter } from "../src/adapters/stripe.js";
import { listAudit } from "../src/db/audit.js";
import type { AuditRow, SubscriptionRow } from "../src/types/index.js";

/** Mock that records Stripe lifecycle calls so "exactly once" is asserted, not assumed. */
class RecordingStripeAdapter extends MockStripeAdapter {
  cancelCalls: string[] = [];
  planChangeCalls: Array<{ id: string; plan: string }> = [];
  override async cancelSubscription(id: string): Promise<{ id: string; customer: string; status: string; current_period_start: string; current_period_end: string; plan: string }> {
    this.cancelCalls.push(id);
    return super.cancelSubscription(id);
  }
  override async updateSubscriptionPlan(id: string, plan: string): Promise<{ id: string; customer: string; status: string; current_period_start: string; current_period_end: string; plan: string }> {
    this.planChangeCalls.push({ id, plan });
    return super.updateSubscriptionPlan(id, plan);
  }
}

async function call(ctx: ServiceContext, opName: string, input: unknown): Promise<unknown> {
  const op = getOp(opName);
  if (!op) throw new Error(`no op ${opName}`);
  return runOp(op, ctx, input);
}

let ctx: ServiceContext;
let mock: RecordingStripeAdapter;

async function seedSubscription(plan = "pro"): Promise<{ customer: { id: string }; sub: SubscriptionRow }> {
  const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "a@b.com" })) as { id: string };
  const sub = (await call(ctx, "create_subscription", { customer_id: customer.id, plan })) as SubscriptionRow;
  return { customer, sub };
}

function auditActions(actions: string[]): AuditRow[] {
  return listAudit(ctx.db).filter((row) => actions.includes(row.action));
}

beforeEach(() => {
  const db = freshDb();
  mock = new RecordingStripeAdapter();
  setStripeAdapter(mock);
  ctx = systemContext(db);
  ctx.stripe = mock;
});
afterEach(() => {
  setStripeAdapter(null);
  closeDatabase();
});

describe("immediate cancellation", () => {
  it("requires approval_ref, calls Stripe cancel exactly once, lands canceled, and audits the approval", async () => {
    const { sub } = await seedSubscription();
    expect(sub.stripe_subscription_id).toMatch(/^sub_mock_/);

    // Without approval_ref: refused, no Stripe call.
    await expect(call(ctx, "cancel_subscription", { id: sub.id })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    expect(mock.cancelCalls).toEqual([]);

    // With approval_ref: one Stripe call with the Stripe subscription id.
    const canceled = (await call(ctx, "cancel_subscription", { id: sub.id, approval_ref: "approval-imm-1" })) as SubscriptionRow;
    expect(mock.cancelCalls).toEqual([sub.stripe_subscription_id]);
    expect(canceled.status).toBe("canceled");
    expect(canceled.cancel_at_period_end).toBe(0);

    // Audit: the approval decision is recorded with the ref as detail.
    const approvals = auditActions(["approve_cancel_subscription"]);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.resource_id).toBe(sub.id);
    expect(approvals[0]!.detail).toBe("approval-imm-1");
    const cancels = auditActions(["cancel_subscription"]);
    expect(cancels).toHaveLength(1);
    expect(cancels[0]!.detail).toBe("immediate");
  });

  it("rejects an approval_ref shorter than eight characters at the input boundary", async () => {
    const { sub } = await seedSubscription();
    await expect(call(ctx, "cancel_subscription", { id: sub.id, approval_ref: "short" })).rejects.toThrow(/at least 8/i);
    expect(mock.cancelCalls).toEqual([]);
    const unchanged = (await call(ctx, "get_subscription", { id: sub.id })) as SubscriptionRow;
    expect(unchanged.status).toBe("active");
  });
});

describe("at-period-end cancellation", () => {
  it("sets the flag WITHOUT any Stripe call and WITHOUT approval_ref", async () => {
    const { sub } = await seedSubscription();
    const after = (await call(ctx, "cancel_subscription", { id: sub.id, at_period_end: true })) as SubscriptionRow;
    expect(after.status).toBe("active");
    expect(after.cancel_at_period_end).toBe(1);
    expect(mock.cancelCalls).toEqual([]); // no Stripe interaction at all

    const cancels = auditActions(["cancel_subscription"]);
    expect(cancels).toHaveLength(1);
    expect(cancels[0]!.detail).toBe("at_period_end");
    // No approval decision exists because none was needed.
    expect(auditActions(["approve_cancel_subscription"])).toHaveLength(0);
  });
});

describe("plan changes", () => {
  it("calls Stripe updateSubscriptionPlan once and records the approval in audit", async () => {
    const { sub } = await seedSubscription("pro");
    const changed = (await call(ctx, "change_subscription_plan", { id: sub.id, plan: "basic", approval_ref: "approval-plan-1" })) as SubscriptionRow;
    expect(changed.plan).toBe("basic");
    expect(mock.planChangeCalls).toEqual([{ id: sub.stripe_subscription_id, plan: "basic" }]);

    const approvals = auditActions(["change_subscription_plan"]);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.detail).toBe("pro->basic approval=approval-plan-1");
  });

  it("rejects a plan change on a canceled subscription without calling Stripe", async () => {
    const { sub } = await seedSubscription();
    await call(ctx, "cancel_subscription", { id: sub.id, approval_ref: "approval-imm-2" });
    const callsBefore = mock.planChangeCalls.length;
    await expect(
      call(ctx, "change_subscription_plan", { id: sub.id, plan: "basic", approval_ref: "approval-plan-2" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(mock.planChangeCalls).toHaveLength(callsBefore); // no Stripe call on refusal
  });
});

describe("re-cancel guard", () => {
  it("rejects canceling an already-canceled subscription and makes no second Stripe call", async () => {
    const { sub } = await seedSubscription();
    await call(ctx, "cancel_subscription", { id: sub.id, approval_ref: "approval-imm-3" });
    await expect(
      call(ctx, "cancel_subscription", { id: sub.id, approval_ref: "approval-imm-4" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(mock.cancelCalls).toHaveLength(1); // exactly once, never twice
  });
});
