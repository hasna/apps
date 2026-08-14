import { describe, it, expect } from "bun:test";
import { missingDelegationLineage, type PersistedLineage } from "./delegation-verify.js";

/**
 * THE CHECK THAT CATCHES A SILENT NO-OP.
 *
 * `cloudUpdateTask` is `PATCH /v1/tasks/:id`, and the authority serving that
 * route is a SEPARATELY DEPLOYED build. Until this change, nothing anywhere in
 * the server or the storage layer handled `assigned_by`, `delegated_from` or
 * `delegation_depth` — so an authority running any earlier build accepts the
 * patch, returns 200 with a bumped version, and writes NONE of the lineage.
 *
 * That is the worst available failure shape for this verb: `delegate` would
 * report a successful handover, print a [DISPATCH] comment claiming a lineage,
 * and leave a row indistinguishable from a plain `todos assign`. An exit code
 * cannot see it. Only reading the returned row back can.
 *
 * The check is a pure function precisely so BOTH arms are testable without an
 * old server to point at: a check that can only be observed passing is not
 * evidence about anything.
 */

const expected = { assignedTo: "lucilius", assignedBy: "agent-ceo", delegatedFrom: "agent-ceo", depth: 1 };

const persisted = (overrides: Partial<PersistedLineage> = {}): PersistedLineage => ({
  assigned_to: "lucilius",
  assigned_by: "agent-ceo",
  delegated_from: "agent-ceo",
  delegation_depth: 1,
  ...overrides,
});

describe("missingDelegationLineage — PASSES on a row the authority actually wrote", () => {
  it("reports nothing missing when every field came back", () => {
    expect(missingDelegationLineage(persisted(), expected)).toEqual([]);
  });

  it("accepts depth 0, which a truthiness check would wrongly call missing", () => {
    expect(
      missingDelegationLineage(persisted({ delegation_depth: 0 }), { ...expected, depth: 0 }),
    ).toEqual([]);
  });
});

describe("missingDelegationLineage — FAILS on the silent no-op, which is why it exists", () => {
  it("names delegated_from when an older authority dropped it", () => {
    expect(missingDelegationLineage(persisted({ delegated_from: null }), expected)).toEqual(["delegated_from"]);
  });

  it("names delegation_depth when it stayed at the hardcoded 0", () => {
    // Every creation site writes `delegation_depth: 0` literally, so a server
    // that ignores the patch leaves exactly this value behind.
    expect(missingDelegationLineage(persisted({ delegation_depth: 0 }), expected)).toEqual(["delegation_depth"]);
  });

  it("names assigned_by when it still holds the FILER rather than the dispatcher", () => {
    // assigned_by is stamped at creation from agent_id, so an ignored patch
    // leaves the filer's name — a plausible value, which is what makes this
    // failure invisible without an explicit comparison.
    expect(missingDelegationLineage(persisted({ assigned_by: "agent-chief-staff" }), expected))
      .toEqual(["assigned_by"]);
  });

  it("names assigned_to when even the assignment did not land", () => {
    expect(missingDelegationLineage(persisted({ assigned_to: null }), expected)).toEqual(["assigned_to"]);
  });

  it("names EVERY missing field, so one report covers a wholly-ignored patch", () => {
    const stale = persisted({
      assigned_to: null,
      assigned_by: "agent-chief-staff",
      delegated_from: null,
      delegation_depth: 0,
    });
    expect(missingDelegationLineage(stale, expected).sort()).toEqual(
      ["assigned_by", "assigned_to", "delegated_from", "delegation_depth"],
    );
  });

  it("treats an absent field as missing, not as a pass", () => {
    // A predecessor server may omit unknown columns from its response entirely
    // rather than returning them null.
    expect(missingDelegationLineage({} as PersistedLineage, expected).sort()).toEqual(
      ["assigned_by", "assigned_to", "delegated_from", "delegation_depth"],
    );
  });

  it("compares names case-insensitively, so casing alone is never reported as a defect", () => {
    expect(missingDelegationLineage(persisted({ delegated_from: "Agent-CEO" }), expected)).toEqual([]);
  });
});
