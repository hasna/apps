// Agent-authored test-gap analysis (SOL consult timed out before delivering a
// spec; this file was written from direct source analysis, never attributed to SOL).
import { describe, expect, it } from "bun:test";
import { memoryDb, SYS } from "./helpers/db.js";
import { createPolicy } from "../src/services/policies.js";
import { allowCounterparty } from "../src/services/allowlists.js";
import { createApprovalRule } from "../src/services/approval-rules.js";
import {
  approveAuthorization,
  consumeAuthorization,
  getAuthorization,
  listAuthorizations,
  rejectAuthorization,
  requestAuthorization,
  verifyAuthorization,
} from "../src/services/authorizations.js";
import type { Authorization } from "../src/types/index.js";

function entity(): string {
  return crypto.randomUUID();
}

function seed(db: ReturnType<typeof memoryDb>, e: string): void {
  createPolicy(db, { entity_id: e, window: "day", amount_limit: 1_000_000, currency: "USD" }, SYS);
  allowCounterparty(db, { entity_id: e, counterparty_id: "cp-1" }, SYS);
}

describe("state machine: segregation of duties and duplicate votes", () => {
  it("blocks the requestor from rejecting their own authorization (SoD on reject)", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    createApprovalRule(db, { entity_id: e, tier: "high", threshold_amount: 50_000, currency: "USD", required_approvals: 1 }, SYS);
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 60_000, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(() => rejectAuthorization(db, { entity_id: e, id: auth.id, approver_id: "a" }, SYS)).toThrow(/requestor/);
  });

  it("rejects a second vote by the same approver", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    createApprovalRule(db, { entity_id: e, tier: "critical", threshold_amount: 10_000, currency: "USD", required_approvals: 2 }, SYS);
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 20_000, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    approveAuthorization(db, { entity_id: e, id: auth.id, approver_id: "b" }, SYS);
    expect(() => approveAuthorization(db, { entity_id: e, id: auth.id, approver_id: "b" }, SYS)).toThrow(/already voted/);
  });

  it("sets approved_at only on the final approval", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    createApprovalRule(db, { entity_id: e, tier: "critical", threshold_amount: 10_000, currency: "USD", required_approvals: 2 }, SYS);
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 20_000, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    const one = approveAuthorization(db, { entity_id: e, id: auth.id, approver_id: "b" }, SYS) as Authorization;
    expect(one.status).toBe("pending");
    expect(one.approved_at).toBeNull();
    const two = approveAuthorization(db, { entity_id: e, id: auth.id, approver_id: "c" }, SYS) as Authorization;
    expect(two.status).toBe("approved");
    expect(two.approved_at).toBeTruthy();
  });
});

describe("state machine: token binding beyond a dead string", () => {
  it("rejects a valid-format token minted for a different authorization", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const one = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 100, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    const two = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 200, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    // one.token is a structurally valid HMAC — just bound to authorization `one`.
    expect(() => consumeAuthorization(db, { entity_id: e, id: two.id, token: one.token! }, SYS)).toThrow(/Token does not match/);
    const v = verifyAuthorization(db, { entity_id: e, id: two.id, token: one.token! }, SYS);
    expect(v.valid).toBe(false);
    expect(v.reason).toBe("token mismatch");
  });
});

describe("state machine: cross-entity isolation", () => {
  it("an authorization created under entity A is unreachable from entity B on every operation", () => {
    const db = memoryDb();
    const a = entity();
    const b = entity();
    seed(db, a);
    seed(db, b);
    const auth = requestAuthorization(db, { entity_id: a, requestor_id: "a", amount: 100, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(() => getAuthorization(db, { entity_id: b, id: auth.id }, SYS)).toThrow(/not found/);
    expect(() => approveAuthorization(db, { entity_id: b, id: auth.id, approver_id: "x" }, SYS)).toThrow(/not found/);
    expect(() => consumeAuthorization(db, { entity_id: b, id: auth.id, token: auth.token! }, SYS)).toThrow(/not found/);
    expect(() => verifyAuthorization(db, { entity_id: b, id: auth.id, token: auth.token! }, SYS)).toThrow(/not found/);
    expect(listAuthorizations(db, { entity_id: b }, SYS)).toEqual([]);
  });
});

describe("state machine: transition matrix", () => {
  function pendingAuth(db: ReturnType<typeof memoryDb>, e: string): Authorization {
    createApprovalRule(db, { entity_id: e, tier: "high", threshold_amount: 50_000, currency: "USD", required_approvals: 1 }, SYS);
    return requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 60_000, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
  }

  it("approve after reject is refused", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const auth = pendingAuth(db, e);
    rejectAuthorization(db, { entity_id: e, id: auth.id, approver_id: "b" }, SYS);
    expect(() => approveAuthorization(db, { entity_id: e, id: auth.id, approver_id: "c" }, SYS)).toThrow(/only pending/);
  });

  it("consume on a rejected authorization is refused and verify reports rejected", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const auth = pendingAuth(db, e);
    rejectAuthorization(db, { entity_id: e, id: auth.id, approver_id: "b" }, SYS);
    expect(() => consumeAuthorization(db, { entity_id: e, id: auth.id, token: "x" }, SYS)).toThrow(/only approved/);
    const v = verifyAuthorization(db, { entity_id: e, id: auth.id, token: "x" }, SYS);
    expect(v.valid).toBe(false);
    expect(v.status).toBe("rejected");
    expect(v.reason).toMatch(/rejected/);
  });

  it("verify on a consumed authorization reports consumed, not approved", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 100, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    consumeAuthorization(db, { entity_id: e, id: auth.id, token: auth.token! }, SYS);
    const v = verifyAuthorization(db, { entity_id: e, id: auth.id, token: auth.token! }, SYS);
    expect(v.valid).toBe(false);
    expect(v.status).toBe("consumed");
    expect(v.reason).toMatch(/consumed/);
  });

  it("approve on an already-approved authorization is refused", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 100, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(auth.status).toBe("approved");
    expect(() => approveAuthorization(db, { entity_id: e, id: auth.id, approver_id: "b" }, SYS)).toThrow(/only pending/);
  });
});

describe("state machine: TTL boundaries", () => {
  it("a zero TTL is issued but immediately expired on any later read", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 100, currency: "USD", counterparty_id: "cp-1", ttl_seconds: 0 }, SYS) as Authorization;
    expect(auth.status).toBe("expired");
    // The stored token exists but is unusable: every read path flips to expired.
    expect(() => consumeAuthorization(db, { entity_id: e, id: auth.id, token: auth.token! }, SYS)).toThrow(/only approved/);
    const v = verifyAuthorization(db, { entity_id: e, id: auth.id, token: auth.token! }, SYS);
    expect(v.valid).toBe(false);
    expect(v.status).toBe("expired");
  });

  it("an expired authorization can no longer be approved", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 100, currency: "USD", counterparty_id: "cp-1", ttl_seconds: -1 }, SYS) as Authorization;
    expect(auth.status).toBe("expired");
    expect(() => approveAuthorization(db, { entity_id: e, id: auth.id, approver_id: "b" }, SYS)).toThrow(/only pending/);
  });
});

describe("state machine: listing edges", () => {
  it("an unknown status filter yields an empty list rather than all rows", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 100, currency: "USD", counterparty_id: "cp-1" }, SYS);
    expect(listAuthorizations(db, { entity_id: e, status: "definitely-not-a-status" }, SYS)).toEqual([]);
  });
});
