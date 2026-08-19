// Sol-guided coverage (tests-coverage-sol workflow, 2026-08-19).
//
// Priority 1: list_customers declares a `status` input and silently ignores
// it — a caller filtering for `active` customers receives every customer,
// including canceled ones. Measured red regression: the positive filter must
// return only matching rows, and an unknown status must be rejected at the
// input boundary. A customer's lifecycle status in this domain is its most
// recent subscription's status (customers have no status column of their
// own; the app models customer lifecycle through subscriptions.status).
//
// Plus two-sided update_customer coverage: persisted email/name/delinquent
// updates with correct 1/0 coercion and partial-update preservation.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { freshDb, systemContext, TEST_ENTITY_A, TEST_ENTITY_B } from "./helpers.js";
import { closeDatabase } from "../src/db/database.js";
import { getOp } from "../src/services/registry.js";
import { runOp, type ServiceContext } from "../src/services/context.js";
import { MockStripeAdapter, setStripeAdapter } from "../src/adapters/stripe.js";
import type { CustomerRow, SubscriptionRow } from "../src/types/index.js";

async function call(ctx: ServiceContext, opName: string, input: unknown): Promise<unknown> {
  const op = getOp(opName);
  if (!op) throw new Error(`no op ${opName}`);
  return runOp(op, ctx, input);
}

let ctx: ServiceContext;
let mock: MockStripeAdapter;

async function seedCustomer(email: string, entity = TEST_ENTITY_A): Promise<CustomerRow> {
  return (await call(ctx, "create_customer", { entity_id: entity, email, name: email })) as CustomerRow;
}

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

describe("list_customers status filter", () => {
  it("filters customers by their latest subscription status (positive filter returns only matching rows)", async () => {
    const activeCustomer = await seedCustomer("active@example.com");
    const canceledCustomer = await seedCustomer("canceled@example.com");

    // Two customers with different subscription lifecycle statuses.
    const subA = (await call(ctx, "create_subscription", { customer_id: activeCustomer.id, plan: "pro" })) as SubscriptionRow;
    expect(subA.status).toBe("active");
    const subB = (await call(ctx, "create_subscription", { customer_id: canceledCustomer.id, plan: "basic" })) as SubscriptionRow;
    await call(ctx, "cancel_subscription", { id: subB.id, approval_ref: "approval-cancel-b" });
    const canceledCheck = (await call(ctx, "get_subscription", { id: subB.id })) as SubscriptionRow;
    expect(canceledCheck.status).toBe("canceled");

    // REGRESSION: a status filter is accepted by the schema and must be
    // honored. Today the handler drops the input and returns BOTH customers.
    const active = (await call(ctx, "list_customers", { entity_id: TEST_ENTITY_A, status: "active" })) as CustomerRow[];
    expect(active.map((c) => c.id)).toEqual([activeCustomer.id]);

    const canceled = (await call(ctx, "list_customers", { entity_id: TEST_ENTITY_A, status: "canceled" })) as CustomerRow[];
    expect(canceled.map((c) => c.id)).toEqual([canceledCustomer.id]);

    // No status filter → both rows, unchanged behavior.
    const all = (await call(ctx, "list_customers", { entity_id: TEST_ENTITY_A })) as CustomerRow[];
    expect(all).toHaveLength(2);
  });

  it("rejects an unknown status at the input boundary (VALIDATION_ERROR)", async () => {
    await seedCustomer("a@example.com");
    await expect(call(ctx, "list_customers", { entity_id: TEST_ENTITY_A, status: "bogus-status" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("keeps entity scoping independent of the status filter (no cross-entity leak)", async () => {
    const a = await seedCustomer("a@example.com", TEST_ENTITY_A);
    const b = await seedCustomer("b@example.com", TEST_ENTITY_B);
    await call(ctx, "create_subscription", { customer_id: a.id, plan: "pro" });
    await call(ctx, "create_subscription", { customer_id: b.id, plan: "pro" });

    const forA = (await call(ctx, "list_customers", { entity_id: TEST_ENTITY_A, status: "active" })) as CustomerRow[];
    expect(forA.map((c) => c.id)).toEqual([a.id]);
    const forB = (await call(ctx, "list_customers", { entity_id: TEST_ENTITY_B, status: "active" })) as CustomerRow[];
    expect(forB.map((c) => c.id)).toEqual([b.id]);
  });
});

describe("update_customer persistence", () => {
  it("persists a new email and name and coerces delinquent=true to 1", async () => {
    const customer = await seedCustomer("old@example.com");
    const updated = (await call(ctx, "update_customer", {
      id: customer.id,
      email: "new@example.com",
      name: "New Name",
      delinquent: true,
    })) as CustomerRow;
    expect(updated.email).toBe("new@example.com");
    expect(updated.name).toBe("New Name");
    expect(updated.delinquent).toBe(1);

    const reloaded = (await call(ctx, "get_customer", { id: customer.id })) as CustomerRow;
    expect(reloaded.email).toBe("new@example.com");
    expect(reloaded.name).toBe("New Name");
    expect(reloaded.delinquent).toBe(1);
  });

  it("coerces delinquent=false to 0 (clears the flag)", async () => {
    const customer = await seedCustomer("a@example.com");
    await call(ctx, "update_customer", { id: customer.id, delinquent: true });
    const cleared = (await call(ctx, "update_customer", { id: customer.id, delinquent: false })) as CustomerRow;
    expect(cleared.delinquent).toBe(0);
  });

  it("applies partial updates without touching the omitted fields", async () => {
    const customer = await seedCustomer("keep@example.com");
    await call(ctx, "update_customer", { id: customer.id, name: "Original", delinquent: true });
    const emailOnly = (await call(ctx, "update_customer", { id: customer.id, email: "only@example.com" })) as CustomerRow;
    expect(emailOnly.email).toBe("only@example.com");
    expect(emailOnly.name).toBe("Original"); // untouched
    expect(emailOnly.delinquent).toBe(1); // untouched
  });

  it("fails with CUSTOMER_NOT_FOUND for a missing customer", async () => {
    await expect(call(ctx, "update_customer", { id: "nope", email: "x@y.com" })).rejects.toMatchObject({
      code: "CUSTOMER_NOT_FOUND",
    });
  });
});
