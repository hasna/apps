// Sol-guided coverage (tests-coverage-sol workflow, lane controls) — Priority 3:
// policy/cap evaluation (src/services/policies.ts) exercised DIRECTLY through
// evaluateCaps, including the exact week/month lookback boundary and currency
// isolation. Authorizations are inserted with a controlled created_at so the
// lookback inclusion/exclusion at the boundary is measured, not approximated.
import { describe, expect, it } from "bun:test";
import { memoryDb, SYS } from "./helpers/db.js";
import { createPolicy, evaluateCaps, getPolicy, updatePolicy } from "../src/services/policies.js";
import { allowCounterparty } from "../src/services/allowlists.js";
import type { Authorization } from "../src/types/index.js";

const WEEK_MS = 604_800_000;
const MONTH_MS = 2_592_000_000;
const AT = "2026-08-19T12:00:00.000Z";

function entity(): string {
  return crypto.randomUUID();
}

function seed(
  db: ReturnType<typeof memoryDb>,
  e: string,
  overrides: { limit?: number; window?: string; currency?: string; note?: string } = {},
): void {
  createPolicy(
    db,
    {
      entity_id: e,
      window: (overrides.window ?? "day") as "day",
      amount_limit: overrides.limit ?? 1000,
      currency: overrides.currency ?? "USD",
      note: overrides.note,
    },
    SYS,
  );
  allowCounterparty(db, { entity_id: e, counterparty_id: "cp-1" }, SYS);
}

/** Insert an approved authorization with an exact created_at (bypasses request-time cap checks). */
function recordSpend(db: ReturnType<typeof memoryDb>, e: string, amount: number, currency = "USD", atIso = AT, requestorId = "a"): void {
  const id = crypto.randomUUID();
  db.run(
    `INSERT INTO authorizations
       (id, entity_id, requestor_id, amount, currency, counterparty_id, status,
        required_approvals, approvals, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'approved', 0, '[]', ?, ?, ?)`,
    [id, e, requestorId, amount, currency, "cp-1", atIso, atIso, atIso],
  );
}

describe("policies: evaluateCaps and deactivation", () => {
  it("an active policy breaches; deactivating it stops evaluateCaps from breaching (two-sided)", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e, { limit: 1000 });
    recordSpend(db, e, 600);

    const before = evaluateCaps(db, e, 500, "USD", null, AT);
    expect(before.within_caps).toBe(false);
    expect(before.breached).toHaveLength(1);
    expect(before.breached[0].amount_limit).toBe(1000);
    expect(before.breached[0].already_consumed).toBe(600);
    expect(before.breached[0].would_total).toBe(1100);

    const policy = getPolicy(db, { entity_id: e, id: before.breached[0].policy_id }, SYS);
    updatePolicy(db, { entity_id: e, id: policy.id, active: false }, SYS);
    const after = evaluateCaps(db, e, 500, "USD", null, AT);
    expect(after.within_caps).toBe(true);
    expect(after.breached).toEqual([]);
  });

  it("partial update increments version and preserves note and active (two-sided)", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e, { limit: 1000, note: "original" });
    const policy = getPolicy(db, { entity_id: e, id: db.query("SELECT id FROM policies WHERE entity_id = ?").get(e)?.id as string }, SYS);
    expect(policy.version).toBe(1);
    expect(policy.note).toBe("original");
    expect(policy.active).toBe(true);

    const updated = updatePolicy(db, { entity_id: e, id: policy.id, amount_limit: 800 }, SYS);
    expect(updated.version).toBe(2);
    expect(updated.amount_limit).toBe(800);
    expect(updated.note).toBe("original"); // untouched
    expect(updated.active).toBe(true); // untouched

    const renamed = updatePolicy(db, { entity_id: e, id: policy.id, note: "revised" }, SYS);
    expect(renamed.note).toBe("revised");
    expect(renamed.amount_limit).toBe(800); // untouched by the note edit
    expect(renamed.version).toBe(3);
  });
});

describe("policies: spend-window lookback semantics", () => {
  it("a transaction-window cap is amount-only: prior spend never accumulates (two-sided)", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e, { limit: 500, window: "transaction" });
    recordSpend(db, e, 400);

    const atLimit = evaluateCaps(db, e, 500, "USD", null, AT);
    expect(atLimit.within_caps).toBe(true); // amount-only: 500 <= 500
    expect(atLimit.breached).toEqual([]);

    const over = evaluateCaps(db, e, 501, "USD", null, AT);
    expect(over.within_caps).toBe(false);
    expect(over.breached[0].window).toBe("transaction");
    expect(over.breached[0].already_consumed).toBe(0); // no lookback
    expect(over.breached[0].would_total).toBe(501);
  });

  it("week lookback: spend exactly at the boundary counts; one millisecond before does not (two-sided)", () => {
    const at = Date.parse(AT);
    // Included: created_at == at - 1 week (boundary inclusive).
    const inDb = memoryDb();
    const inEntity = entity();
    seed(inDb, inEntity, { limit: 1000, window: "week" });
    recordSpend(inDb, inEntity, 600, "USD", new Date(at - WEEK_MS).toISOString());
    const included = evaluateCaps(inDb, inEntity, 500, "USD", null, AT);
    expect(included.within_caps).toBe(false); // 600 + 500 > 1000
    expect(included.breached[0].already_consumed).toBe(600);

    // Excluded: created_at == at - 1 week - 1ms.
    const outDb = memoryDb();
    const outEntity = entity();
    seed(outDb, outEntity, { limit: 1000, window: "week" });
    recordSpend(outDb, outEntity, 600, "USD", new Date(at - WEEK_MS - 1).toISOString());
    const excluded = evaluateCaps(outDb, outEntity, 500, "USD", null, AT);
    expect(excluded.within_caps).toBe(true);
    expect(excluded.breached).toEqual([]);
  });

  it("month lookback: spend exactly at the boundary counts; one millisecond before does not (two-sided)", () => {
    const at = Date.parse(AT);
    const inDb = memoryDb();
    const inEntity = entity();
    seed(inDb, inEntity, { limit: 1000, window: "month" });
    recordSpend(inDb, inEntity, 600, "USD", new Date(at - MONTH_MS).toISOString());
    expect(evaluateCaps(inDb, inEntity, 500, "USD", null, AT).within_caps).toBe(false);

    const outDb = memoryDb();
    const outEntity = entity();
    seed(outDb, outEntity, { limit: 1000, window: "month" });
    recordSpend(outDb, outEntity, 600, "USD", new Date(at - MONTH_MS - 1).toISOString());
    expect(evaluateCaps(outDb, outEntity, 500, "USD", null, AT).within_caps).toBe(true);
  });

  it("currency isolation: USD spend never counts toward EUR evaluation (two-sided)", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e, { limit: 1000, currency: "USD" });
    createPolicy(db, { entity_id: e, window: "day", amount_limit: 1000, currency: "EUR" }, SYS);
    recordSpend(db, e, 5000, "USD");

    const eur = evaluateCaps(db, e, 900, "EUR", null, AT);
    expect(eur.within_caps).toBe(true); // no EUR spend recorded
    expect(eur.breached).toEqual([]);

    const usd = evaluateCaps(db, e, 100, "USD", null, AT);
    expect(usd.within_caps).toBe(false); // 5000 + 100 > 1000
    expect(usd.breached).toHaveLength(1);
  });
});
