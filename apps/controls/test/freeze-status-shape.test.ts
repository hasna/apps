// Sol-guided coverage (tests-coverage-sol workflow, lane controls) — Priority 3:
// freeze status shape and the isFrozen predicate (src/services/freezes.ts).
// The request/consume freeze gates and release-recovery flows are already covered
// in freeze-lifecycle.test.ts; this file pins the status CONTRACT (exact shape,
// identity scoping through isFrozen, and the flip after release) which the
// existing suite does not assert directly.
import { describe, expect, it } from "bun:test";
import { memoryDb, SYS } from "./helpers/db.js";
import { createFreeze, freezeStatus, isFrozen, releaseFreeze } from "../src/services/freezes.js";

function entity(): string {
  return crypto.randomUUID();
}

describe("freezes: freezeStatus contract", () => {
  it("returns the exact documented shape", () => {
    const db = memoryDb();
    const e = entity();
    createFreeze(db, { entity_id: e, identity_id: "x", reason: "incident" }, SYS);

    const st = freezeStatus(db, { entity_id: e, identity_id: "x" }, SYS);
    expect(Object.keys(st).sort()).toEqual(["entity_id", "freezes", "frozen", "identity_id"]);
    expect(st.entity_id).toBe(e);
    expect(st.identity_id).toBe("x");
    expect(st.frozen).toBe(true);
    expect(st.freezes).toHaveLength(1);
    expect(st.freezes[0]).toMatchObject({ entity_id: e, identity_id: "x", active: true, reason: "incident" });
  });

  it("an identity-scoped freeze freezes exactly that identity, never a different one (two-sided)", () => {
    const db = memoryDb();
    const e = entity();
    createFreeze(db, { entity_id: e, identity_id: "x", reason: "incident" }, SYS);

    expect(isFrozen(db, e, "x")).toBe(true);
    expect(isFrozen(db, e, "y")).toBe(false);
    // Entity isolation: the same identity is not frozen on another entity.
    const other = entity();
    expect(isFrozen(db, other, "x")).toBe(false);
    // Whole-entity freezes (identity_id null) apply to every identity.
    const e2 = entity();
    createFreeze(db, { entity_id: e2, reason: "entity-wide" }, SYS);
    expect(isFrozen(db, e2, "anyone")).toBe(true);
  });

  it("releasing a freeze flips freezeStatus and isFrozen to false (two-sided)", () => {
    const db = memoryDb();
    const e = entity();
    const freeze = createFreeze(db, { entity_id: e, identity_id: "x", reason: "incident" }, SYS);
    expect(freezeStatus(db, { entity_id: e, identity_id: "x" }, SYS).frozen).toBe(true);

    releaseFreeze(db, { entity_id: e, id: freeze.id }, SYS);
    expect(isFrozen(db, e, "x")).toBe(false);
    const after = freezeStatus(db, { entity_id: e, identity_id: "x" }, SYS);
    expect(after.frozen).toBe(false);
    expect(after.freezes).toEqual([]);
  });
});
