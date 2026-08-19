// Agent-authored (SOL consult refused: "Selected model is at capacity" on two
// distinct healthy Codewith accounts — no SOL opinion was produced for this repo).
//
// Subscription lifecycle edges: at-period-end cancellation semantics, the
// approval_ref guard rails (required length), transition guards (canceled is
// terminal), and not-found paths. A regression here means subscriptions are
// canceled/downgraded without the operator approval the contract demands, or
// money keeps billing after the owner asked to stop it.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { freshDb, systemContext, TEST_ENTITY_A } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { getOp } from "../src/services/registry.js";
import { runOp, type ServiceContext } from "../src/services/context.js";
import { MockStripeAdapter, setStripeAdapter } from "../src/adapters/stripe.js";
import type { SubscriptionRow } from "../src/types/index.js";

async function call(ctx: ServiceContext, opName: string, input: unknown): Promise<unknown> {
  const op = getOp(opName);
  if (!op) throw new Error(`no op ${opName}`);
  return runOp(op, ctx, input);
}

async function seedSubscription(plan = "pro"): Promise<{ customer: { id: string }; sub: SubscriptionRow }> {
  const customer = (await call(ctx, "create_customer", { entity_id: TEST_ENTITY_A, email: "a@b.com" })) as { id: string };
  const sub = (await call(ctx, "create_subscription", { customer_id: customer.id, plan })) as SubscriptionRow;
  return { customer, sub };
}

let ctx: ServiceContext;
let mock: MockStripeAdapter;

beforeEach(() => {
  const db = freshDb();
  mock = new MockStripeAdapter();
  setStripeAdapter(mock);
  ctx = systemContext(db);
  ctx.stripe = mock;
});
afterEach(() => {
  setStripeAdapter(null);
  closeDatabase();
});

describe("cancel at period end", () => {
  it("flags cancel_at_period_end while keeping the subscription active", async () => {
    const { sub } = await seedSubscription();
    const after = (await call(ctx, "cancel_subscription", { id: sub.id, at_period_end: true })) as SubscriptionRow;
    expect(after.status).toBe("active");
    expect(after.cancel_at_period_end).toBe(1);
  });

  it("is idempotent on the flag and allows a later immediate cancel with approval", async () => {
    const { sub } = await seedSubscription();
    await call(ctx, "cancel_subscription", { id: sub.id, at_period_end: true });
    const again = (await call(ctx, "cancel_subscription", { id: sub.id, at_period_end: true })) as SubscriptionRow;
    expect(again.status).toBe("active");
    expect(again.cancel_at_period_end).toBe(1);

    const immediate = (await call(ctx, "cancel_subscription", {
      id: sub.id,
      approval_ref: "approval-123",
    })) as SubscriptionRow;
    expect(immediate.status).toBe("canceled");
    expect(immediate.cancel_at_period_end).toBe(0);
  });
});

describe("cancel transition guards", () => {
  it("rejects an immediate cancel without an approval_ref (INVALID_TRANSITION)", async () => {
    const { sub } = await seedSubscription();
    await expect(call(ctx, "cancel_subscription", { id: sub.id })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    const still = (await call(ctx, "get_subscription", { id: sub.id })) as SubscriptionRow;
    expect(still.status).toBe("active");
  });

  it("rejects canceling an already-canceled subscription", async () => {
    const { sub } = await seedSubscription();
    await call(ctx, "cancel_subscription", { id: sub.id, approval_ref: "approval-123" });
    await expect(call(ctx, "cancel_subscription", { id: sub.id, approval_ref: "approval-123" })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("fails with SUBSCRIPTION_NOT_FOUND for a missing subscription", async () => {
    await expect(call(ctx, "cancel_subscription", { id: "nope", approval_ref: "approval-123" })).rejects.toMatchObject({
      code: "SUBSCRIPTION_NOT_FOUND",
    });
  });
});

describe("plan changes", () => {
  it("rejects a plan change on a canceled subscription", async () => {
    const { sub } = await seedSubscription();
    await call(ctx, "cancel_subscription", { id: sub.id, approval_ref: "approval-123" });
    await expect(
      call(ctx, "change_subscription_plan", { id: sub.id, plan: "basic", approval_ref: "approval-123" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("rejects an approval_ref shorter than 8 characters at the input boundary", async () => {
    const { sub } = await seedSubscription();
    await expect(
      call(ctx, "change_subscription_plan", { id: sub.id, plan: "basic", approval_ref: "short" }),
    ).rejects.toThrow(/at least 8/i);
    const unchanged = (await call(ctx, "get_subscription", { id: sub.id })) as SubscriptionRow;
    expect(unchanged.plan).toBe("pro");
  });

  it("fails with SUBSCRIPTION_NOT_FOUND for a missing subscription", async () => {
    await expect(
      call(ctx, "change_subscription_plan", { id: "nope", plan: "basic", approval_ref: "approval-123" }),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_NOT_FOUND" });
  });
});

describe("create guards and list filters", () => {
  it("fails with CUSTOMER_NOT_FOUND when creating for a missing customer", async () => {
    await expect(call(ctx, "create_subscription", { customer_id: "nope", plan: "pro" })).rejects.toMatchObject({
      code: "CUSTOMER_NOT_FOUND",
    });
  });

  it("filters list_subscriptions by status without leaking other entities", async () => {
    const { sub } = await seedSubscription("pro");
    await seedSubscription("basic");
    await call(ctx, "cancel_subscription", { id: sub.id, approval_ref: "approval-123" });

    const active = (await call(ctx, "list_subscriptions", { entity_id: TEST_ENTITY_A, status: "active" })) as SubscriptionRow[];
    expect(active).toHaveLength(1);
    expect(active[0]!.status).toBe("active");
    expect(active[0]!.plan).toBe("basic");
  });
});
