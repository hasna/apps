import { describe, expect, test } from "bun:test";
import { assignPoolAuthProfiles, poolRoleOffset, selectLeastLoadedProfile, stableIndex } from "./profile-pool.js";

const POOL = ["acctA", "acctB", "acctC"];

describe("assignPoolAuthProfiles — least-loaded selection", () => {
  test("worker avoids the deterministic hash pick when that account is the most loaded", () => {
    const seed = "task-42";
    const hashPick = POOL[stableIndex(seed, POOL.length)]!;
    const free = POOL.find((entry) => entry !== hashPick)!;
    // The hash pick is heavily loaded; a different account is idle.
    const loadCounts = { [hashPick]: 4, [free]: 0 };
    const res = assignPoolAuthProfiles({ pool: POOL, seed, loadCounts, roles: ["worker"] });
    expect(res.deferred).toBe(false);
    // Neutralization: pure-hash selection (the pre-fix behaviour) would return
    // `hashPick` here; least-loaded must pick a zero-load account instead.
    expect(res.profiles.worker).not.toBe(hashPick);
    expect(loadCounts[res.profiles.worker!] ?? 0).toBe(0);
  });

  test("equal load reproduces the deterministic hash assignment (back-compat with rolePoolValue)", () => {
    const seed = "task-lifecycle-seed";
    const loadCounts = {}; // cold store: every account load 0
    const res = assignPoolAuthProfiles({ pool: POOL, seed, loadCounts, roles: ["worker", "verifier", "planner"] });
    const wi = stableIndex(seed, POOL.length);
    expect(res.profiles.worker).toBe(POOL[(wi + poolRoleOffset("worker")) % POOL.length]);
    expect(res.profiles.verifier).toBe(POOL[(wi + poolRoleOffset("verifier")) % POOL.length]);
    expect(res.profiles.planner).toBe(POOL[(wi + poolRoleOffset("planner")) % POOL.length]);
  });

  test("verifier and planner land on a different account than the worker", () => {
    const res = assignPoolAuthProfiles({
      pool: POOL,
      seed: "spread-me",
      loadCounts: { acctA: 1, acctB: 1, acctC: 1 },
      roles: ["worker", "verifier", "planner"],
    });
    expect(res.profiles.verifier).not.toBe(res.profiles.worker);
    expect(res.profiles.planner).not.toBe(res.profiles.worker);
    // With a pool of 3 and three roles, all three are distinct.
    const chosen = new Set([res.profiles.worker, res.profiles.verifier, res.profiles.planner]);
    expect(chosen.size).toBe(3);
  });

  test("verifier prefers a distinct account even when the worker's account is least loaded", () => {
    // acctB is globally least loaded, so the worker takes it; the verifier must
    // still move to a *different* account rather than stacking on acctB.
    const res = assignPoolAuthProfiles({
      pool: POOL,
      seed: "distinct-verifier",
      loadCounts: { acctA: 3, acctB: 0, acctC: 3 },
      roles: ["worker", "verifier"],
    });
    expect(res.profiles.worker).toBe("acctB");
    expect(res.profiles.verifier).not.toBe("acctB");
  });
});

describe("assignPoolAuthProfiles — max-per-profile guard", () => {
  test("defers when every pool member is already at the max-per-profile ceiling", () => {
    const res = assignPoolAuthProfiles({
      pool: POOL,
      seed: "s",
      loadCounts: { acctA: 2, acctB: 2, acctC: 2 },
      maxPerProfile: 2,
      roles: ["worker", "verifier"],
    });
    // Neutralization: without the guard this returns deferred=false with a full
    // assignment (which is exactly the provider-side 429 stacking we prevent).
    expect(res.deferred).toBe(true);
    expect(res.profiles).toEqual({});
    expect(res.reason).toContain("per-profile active limit reached");
  });

  test("does not defer while at least one pool member has headroom", () => {
    const res = assignPoolAuthProfiles({
      pool: POOL,
      seed: "s",
      loadCounts: { acctA: 2, acctB: 1, acctC: 2 },
      maxPerProfile: 2,
      roles: ["worker"],
    });
    expect(res.deferred).toBe(false);
    expect(res.profiles.worker).toBe("acctB"); // the member with headroom
  });

  test("max-per-profile 0 / undefined disables the guard (spread only, never defer)", () => {
    const saturated = { acctA: 9, acctB: 9, acctC: 9 };
    for (const maxPerProfile of [undefined, 0]) {
      const res = assignPoolAuthProfiles({ pool: POOL, seed: "s", loadCounts: saturated, maxPerProfile, roles: ["worker"] });
      expect(res.deferred).toBe(false);
      expect(res.profiles.worker).toBeDefined();
    }
  });
});

describe("selectLeastLoadedProfile", () => {
  test("prefers a non-excluded account over a lower-load excluded one", () => {
    // acctA is excluded (already taken by the worker) even though it is idle;
    // the next role must take a non-excluded account.
    const chosen = selectLeastLoadedProfile(POOL, { acctA: 0, acctB: 5, acctC: 6 }, 0, new Set(["acctA"]));
    expect(chosen).not.toBe("acctA");
    expect(chosen).toBe("acctB"); // least loaded of the non-excluded set
  });

  test("falls back to least-loaded when every member is excluded", () => {
    const chosen = selectLeastLoadedProfile(POOL, { acctA: 4, acctB: 1, acctC: 4 }, 0, new Set(POOL));
    expect(chosen).toBe("acctB");
  });

  test("breaks ties deterministically from the anchor (first encountered wins)", () => {
    const anchor = 2; // start at acctC
    const chosen = selectLeastLoadedProfile(POOL, {}, anchor, new Set());
    expect(chosen).toBe("acctC");
  });
});

describe("assignPoolAuthProfiles — edge cases", () => {
  test("empty pool yields no assignment and never defers", () => {
    const res = assignPoolAuthProfiles({ pool: [], seed: "s", loadCounts: {}, maxPerProfile: 2, roles: ["worker"] });
    expect(res).toEqual({ profiles: {}, deferred: false, minLoad: 0 });
  });

  test("single-member pool reuses the one account across roles", () => {
    const res = assignPoolAuthProfiles({ pool: ["only"], seed: "s", loadCounts: {}, roles: ["worker", "verifier"] });
    expect(res.profiles.worker).toBe("only");
    expect(res.profiles.verifier).toBe("only");
  });
});
