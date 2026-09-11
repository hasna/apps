process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, it, expect, beforeEach } from "bun:test";
import { getDatabase, resetDatabase } from "./database.js";
import { setAcl, listAcls, removeAcl, checkPermission } from "./acl.js";

describe("memory ACL", () => {
  beforeEach(() => {
    resetDatabase();
  });

  // DENY BY DEFAULT (P0, 2026-09-11). This test previously asserted the
  // opposite — "allows all access when no ACLs exist for agent" — which is the
  // defect: an authorization primitive whose default answer is `true` conflates
  // "deliberately unrestricted" with "rules missing / not written yet / not
  // readable from here", and those have opposite correct answers.
  it("denies when the agent has NO rules at all", () => {
    const db = getDatabase();
    expect(checkPermission("agent-1", "any-key", "read", db)).toBe(false);
    expect(checkPermission("agent-1", "any-key", "write", db)).toBe(false);
  });

  it("still allows the unconfigured agent when the caller asks for that BY NAME", () => {
    const db = getDatabase();
    const permissive = { allowWhenUnconfigured: true };
    expect(checkPermission("agent-1", "any-key", "read", db, permissive)).toBe(true);
    expect(checkPermission("agent-1", "any-key", "write", db, permissive)).toBe(true);
  });

  it("the opt-in does NOT override a rule set that exists and does not match", () => {
    const db = getDatabase();
    setAcl("agent-1", "project-*", "read", undefined, db);
    // The agent IS configured, so allowWhenUnconfigured is irrelevant here.
    expect(checkPermission("agent-1", "other-key", "read", db, { allowWhenUnconfigured: true })).toBe(false);
    expect(checkPermission("agent-1", "project-a", "write", db, { allowWhenUnconfigured: true })).toBe(false);
    expect(checkPermission("agent-1", "project-a", "read", db, { allowWhenUnconfigured: true })).toBe(true);
  });

  it("denies when the rule set cannot be READ — an unreadable ACL table is not a grant", () => {
    // A store that throws on every query stands in for "no store configured",
    // a transport failure, or a store error. The answer must be deny, and it
    // must be a denial rather than an exception a caller could catch into a
    // grant.
    const brokenStore = {
      query() {
        throw new Error("store unavailable");
      },
      run() {
        throw new Error("store unavailable");
      },
    } as unknown as Parameters<typeof checkPermission>[3];

    expect(checkPermission("agent-1", "any-key", "read", brokenStore)).toBe(false);
    expect(checkPermission("agent-1", "any-key", "write", brokenStore)).toBe(false);
    // even with the permissive opt-in: we do not know that the agent is unconfigured
    expect(
      checkPermission("agent-1", "any-key", "read", brokenStore, { allowWhenUnconfigured: true }),
    ).toBe(false);
  });

  it("sets, lists, and upserts ACL rules", () => {
    const db = getDatabase();
    setAcl("agent-1", "project-*", "read", undefined, db);
    setAcl("agent-1", "project-*", "readwrite", undefined, db);

    const acls = listAcls("agent-1", db);
    expect(acls).toHaveLength(1);
    expect(acls[0]!.key_pattern).toBe("project-*");
    expect(acls[0]!.permission).toBe("readwrite");
  });

  it("matches glob patterns for read and write checks", () => {
    const db = getDatabase();
    setAcl("agent-1", "project-*", "read", undefined, db);
    setAcl("agent-1", "secret-*", "admin", undefined, db);

    expect(checkPermission("agent-1", "project-stack", "read", db)).toBe(true);
    expect(checkPermission("agent-1", "project-stack", "write", db)).toBe(false);
    expect(checkPermission("agent-1", "secret-key", "write", db)).toBe(true);
    expect(checkPermission("agent-1", "other-key", "read", db)).toBe(false);
  });

  it("removes ACL rules by id", () => {
    const db = getDatabase();
    const acl = setAcl("agent-1", "temp-*", "read", undefined, db);

    expect(removeAcl(acl.id, db)).toBe(true);
    expect(listAcls("agent-1", db)).toHaveLength(0);
    // Removing the last rule leaves the agent UNCONFIGURED, which now denies.
    // (This assertion was `true` before the default-deny fix: deleting a rule
    // used to hand the agent full access to everything, which is the opposite
    // of what removing a permission should do.)
    expect(checkPermission("agent-1", "temp-key", "read", db)).toBe(false);
    expect(checkPermission("agent-1", "temp-key", "read", db, { allowWhenUnconfigured: true })).toBe(true);
    expect(removeAcl("missing", db)).toBe(false);
  });
});
