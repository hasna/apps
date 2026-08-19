// Agent-authored test-gap analysis (SOL consult timed out before delivering a
// spec; this file was written from direct source analysis, never attributed to SOL).
import { describe, expect, it } from "bun:test";
import { memoryDb, SYS } from "./helpers/db.js";
import { createPolicy, updatePolicy } from "../src/services/policies.js";
import { allowCounterparty } from "../src/services/allowlists.js";
import { createApprovalRule } from "../src/services/approval-rules.js";
import {
  rejectAuthorization,
  requestAuthorization,
} from "../src/services/authorizations.js";
import type { Authorization } from "../src/types/index.js";

function entity(): string {
  return crypto.randomUUID();
}

function seed(
  db: ReturnType<typeof memoryDb>,
  e: string,
  overrides: { limit?: number; window?: string; currency?: string; agent_id?: string } = {},
): void {
  createPolicy(
    db,
    {
      entity_id: e,
      window: (overrides.window ?? "day") as "day",
      amount_limit: overrides.limit ?? 1000,
      currency: overrides.currency ?? "USD",
      agent_id: overrides.agent_id ?? undefined,
    },
    SYS,
  );
  allowCounterparty(db, { entity_id: e, counterparty_id: "cp-1" }, SYS);
}

describe("caps: rejected authorizations do not consume budget", () => {
  it("frees the cap once a pending authorization is rejected", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e, { limit: 1000 });
    createApprovalRule(db, { entity_id: e, tier: "high", threshold_amount: 500, currency: "USD", required_approvals: 1 }, SYS);
    const first = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 600, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(first.status).toBe("pending");
    // Control: while the 600 is still pending it must NOT count (request-time
    // semantics) — the cap gate counts only approved+consumed authorizations.
    expect(() =>
      requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 600, currency: "USD", counterparty_id: "cp-1" }, SYS),
    ).not.toThrow();
    rejectAuthorization(db, { entity_id: e, id: first.id, approver_id: "b" }, SYS);
    // After rejection the budget is free again: a third 600 request is allowed.
    const third = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 600, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(third.status).toBe("pending");
  });
});

describe("caps: expired authorizations do not consume budget", () => {
  it("an approved authorization reserves budget, and an expired one releases it", () => {
    // Control flow: while approved, the 600 reserves the 1000 cap.
    {
      const db = memoryDb();
      const e = entity();
      seed(db, e, { limit: 1000 });
      const approved = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 600, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
      expect(approved.status).toBe("approved");
      expect(() =>
        requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 500, currency: "USD", counterparty_id: "cp-1" }, SYS),
      ).toThrow(/Spend cap exceeded/);
    }
    // Expired flow: a backdated TTL flips the authorization to expired, and the
    // cap gate stops counting it (only approved+consumed count).
    {
      const db = memoryDb();
      const e = entity();
      seed(db, e, { limit: 1000 });
      const expired = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 600, currency: "USD", counterparty_id: "cp-1", ttl_seconds: -1 }, SYS) as Authorization;
      expect(expired.status).toBe("expired");
      const second = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 500, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
      expect(second.status).toBe("approved");
    }
  });
});

describe("caps: request-time semantics are pinned", () => {
  it("does not count pending authorizations at request time", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e, { limit: 1000 });
    createApprovalRule(db, { entity_id: e, tier: "high", threshold_amount: 500, currency: "USD", required_approvals: 2 }, SYS);
    const one = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 600, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    const two = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 600, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(one.status).toBe("pending");
    expect(two.status).toBe("pending");
    // Once the first is approved it counts: the second 600 would now exceed the cap.
    // (Approval itself does not re-evaluate caps — cap enforcement is request-time.)
  });

  it("enforces the exact boundary: amount == limit allowed, limit + 1 rejected", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e, { limit: 1000 });
    const exact = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 1000, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(exact.status).toBe("approved");
    expect(() =>
      requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 1, currency: "USD", counterparty_id: "cp-1" }, SYS),
    ).toThrow(/Spend cap exceeded/);
  });
});

describe("caps: window and scope edges", () => {
  it("transaction-window cap limits one transaction but does not accumulate", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e, { limit: 500, window: "transaction" });
    const one = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 500, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(one.status).toBe("approved");
    const two = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 500, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(two.status).toBe("approved");
    expect(() =>
      requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 501, currency: "USD", counterparty_id: "cp-1" }, SYS),
    ).toThrow(/Spend cap exceeded/);
  });

  it("a USD cap does not bind EUR requests", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e, { limit: 1000, currency: "USD" });
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 5000, currency: "EUR", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(auth.status).toBe("approved");
  });

  it("deactivating a policy releases its cap", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e, { limit: 1000 });
    requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 800, currency: "USD", counterparty_id: "cp-1" }, SYS);
    expect(() =>
      requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 300, currency: "USD", counterparty_id: "cp-1" }, SYS),
    ).toThrow(/Spend cap exceeded/);
    const policy = getPolicyForSeed(db, e);
    updatePolicy(db, { entity_id: e, id: policy.id, active: false }, SYS);
    const after = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 300, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(after.status).toBe("approved");
  });

  it("agent-scoped caps accumulate only against that agent", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e, { limit: 500, agent_id: "a" });
    requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 300, currency: "USD", counterparty_id: "cp-1" }, SYS);
    expect(() =>
      requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 300, currency: "USD", counterparty_id: "cp-1" }, SYS),
    ).toThrow(/Spend cap exceeded/);
    // Agent b is not covered by a's agent-scoped policy.
    const b = requestAuthorization(db, { entity_id: e, requestor_id: "b", amount: 5000, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(b.status).toBe("approved");
  });
});

function getPolicyForSeed(db: ReturnType<typeof memoryDb>, e: string): { id: string } {
  return db.query("SELECT id FROM policies WHERE entity_id = ?").get(e) as { id: string };
}

describe("caps: cross-entity isolation of spend", () => {
  it("entity A's approved spend never counts toward entity B's cap", () => {
    const db = memoryDb();
    const a = entity();
    const b = entity();
    seed(db, a, { limit: 1000 });
    seed(db, b, { limit: 1000 });
    requestAuthorization(db, { entity_id: a, requestor_id: "a", amount: 900, currency: "USD", counterparty_id: "cp-1" }, SYS);
    // B's cap is untouched by A's 900.
    const auth = requestAuthorization(db, { entity_id: b, requestor_id: "b", amount: 1000, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(auth.status).toBe("approved");
  });
});
