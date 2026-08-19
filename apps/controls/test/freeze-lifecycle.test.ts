// Agent-authored test-gap analysis (SOL consult timed out before delivering a
// spec; this file was written from direct source analysis, never attributed to SOL).
import { describe, expect, it } from "bun:test";
import { memoryDb, SYS } from "./helpers/db.js";
import { createPolicy } from "../src/services/policies.js";
import { allowCounterparty } from "../src/services/allowlists.js";
import { createFreeze, freezeStatus, releaseFreeze } from "../src/services/freezes.js";
import { consumeAuthorization, requestAuthorization, verifyAuthorization } from "../src/services/authorizations.js";
import type { Authorization } from "../src/types/index.js";

function entity(): string {
  return crypto.randomUUID();
}

function seed(db: ReturnType<typeof memoryDb>, e: string): void {
  createPolicy(db, { entity_id: e, window: "day", amount_limit: 1_000_000, currency: "USD" }, SYS);
  allowCounterparty(db, { entity_id: e, counterparty_id: "cp-1" }, SYS);
}

describe("freezes: identity scoping", () => {
  it("an identity-scoped freeze blocks only that identity's requests", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    createFreeze(db, { entity_id: e, identity_id: "x", reason: "incident" }, SYS);
    expect(() =>
      requestAuthorization(db, { entity_id: e, requestor_id: "x", amount: 100, currency: "USD", counterparty_id: "cp-1" }, SYS),
    ).toThrow(/freeze/);
    const ok = requestAuthorization(db, { entity_id: e, requestor_id: "y", amount: 100, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(ok.status).toBe("approved");
  });

  it("a freeze on the requestor identity blocks consumption of an approved token", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 100, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    createFreeze(db, { entity_id: e, identity_id: "a", reason: "incident" }, SYS);
    expect(() => consumeAuthorization(db, { entity_id: e, id: auth.id, token: auth.token! }, SYS)).toThrow(/freeze/);
  });

  it("a freeze on an unrelated identity does not block consumption (freeze binds the requestor)", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 100, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    createFreeze(db, { entity_id: e, identity_id: "z", reason: "unrelated" }, SYS);
    const consumed = consumeAuthorization(db, { entity_id: e, id: auth.id, token: auth.token! }, SYS) as Authorization;
    expect(consumed.status).toBe("consumed");
  });
});

describe("freezes: freeze-after-approval and recovery", () => {
  it("blocks consumption when frozen after approval, then allows it after release", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 100, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    const freeze = createFreeze(db, { entity_id: e, reason: "incident" }, SYS);
    expect(() => consumeAuthorization(db, { entity_id: e, id: auth.id, token: auth.token! }, SYS)).toThrow(/freeze/);
    releaseFreeze(db, { entity_id: e, id: freeze.id }, SYS);
    const consumed = consumeAuthorization(db, { entity_id: e, id: auth.id, token: auth.token! }, SYS) as Authorization;
    expect(consumed.status).toBe("consumed");
  });

  it("verifyAuthorization tracks freeze and recovery state", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 100, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(verifyAuthorization(db, { entity_id: e, id: auth.id, token: auth.token! }, SYS).valid).toBe(true);
    const freeze = createFreeze(db, { entity_id: e, reason: "incident" }, SYS);
    const frozen = verifyAuthorization(db, { entity_id: e, id: auth.id, token: auth.token! }, SYS);
    expect(frozen.valid).toBe(false);
    expect(frozen.reason).toMatch(/frozen/);
    expect(frozen.status).toBe("approved");
    releaseFreeze(db, { entity_id: e, id: freeze.id }, SYS);
    expect(verifyAuthorization(db, { entity_id: e, id: auth.id, token: auth.token! }, SYS).valid).toBe(true);
  });
});

describe("freezes: status and lifecycle edges", () => {
  it("freezeStatus lists entity-wide and identity freezes for the scoped identity only", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    createFreeze(db, { entity_id: e, reason: "entity-wide" }, SYS);
    createFreeze(db, { entity_id: e, identity_id: "x", reason: "identity-x" }, SYS);
    const forX = freezeStatus(db, { entity_id: e, identity_id: "x" }, SYS);
    expect(forX.frozen).toBe(true);
    expect(forX.freezes.map((f) => f.reason).sort()).toEqual(["entity-wide", "identity-x"]);
    const forY = freezeStatus(db, { entity_id: e, identity_id: "y" }, SYS);
    expect(forY.frozen).toBe(true);
    expect(forY.freezes.map((f) => f.reason)).toEqual(["entity-wide"]);
  });

  it("releasing an unknown freeze throws FreezeNotFound", () => {
    const db = memoryDb();
    const e = entity();
    expect(() => releaseFreeze(db, { entity_id: e, id: "missing" }, SYS)).toThrow(/not found/);
  });

  it("releasing an already-released freeze is idempotent and stays inactive", () => {
    const db = memoryDb();
    const e = entity();
    seed(db, e);
    const freeze = createFreeze(db, { entity_id: e, reason: "incident" }, SYS);
    const released = releaseFreeze(db, { entity_id: e, id: freeze.id }, SYS);
    expect(released.active).toBe(false);
    const again = releaseFreeze(db, { entity_id: e, id: freeze.id }, SYS);
    expect(again.active).toBe(false);
    expect(again.released_at).toBeTruthy();
    // A released freeze no longer blocks anything.
    const auth = requestAuthorization(db, { entity_id: e, requestor_id: "a", amount: 100, currency: "USD", counterparty_id: "cp-1" }, SYS) as Authorization;
    expect(auth.status).toBe("approved");
  });
});
