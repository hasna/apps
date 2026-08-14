import { describe, it, expect, beforeEach } from "bun:test";
import { loadAssigneeContext, resetAssigneeContextCache } from "./assignee-context.js";
import { validateAssignee } from "./assignee-validation.js";

/**
 * Regression coverage for the CI failure on hasna/todos#146.
 *
 * Validating an assignee added a NEW dependency to the cloud assign path
 * (`GET /v1/agents`). The first version made that fatal: a 404 there took
 * `todos assign REMOTE-1 fixture-agent` from exit 0 to exit 1 with
 * "Hasna cloud request failed: GET /agents -> 404". A guard that is advisory
 * by design must never convert a working assignment into a failure.
 *
 * Worth recording how it was missed: a local A/B against pristine main showed
 * no reproducible regression, and that was a correct answer to a different
 * question. The box was at load 21-29 on 20 cores where main ALSO fails, while
 * CI runs a clean runner where main is green through six consecutive runs.
 * Same tests, different denominators.
 */

beforeEach(() => {
  resetAssigneeContextCache();
});

const SEATS = new Set<string>();

describe("loadAssigneeContext — a roster fetch failure degrades, never throws", () => {
  it("returns an empty roster and flags degraded when the fetch rejects", async () => {
    const ctx = await loadAssigneeContext(() => {
      throw new Error("Hasna cloud request failed: GET /agents -> 404");
    }, false);
    expect(ctx.degraded).toBe(true);
    expect(ctx.agents).toEqual([]);
  });

  it("does not reject on an async fetch failure either", async () => {
    const ctx = await loadAssigneeContext(async () => {
      throw new Error("network down");
    }, false);
    expect(ctx.degraded).toBe(true);
  });

  it("STILL REFUSES A SEAT while degraded — the seat rule reads a local file", async () => {
    const ctx = await loadAssigneeContext(() => {
      throw new Error("GET /agents -> 404");
    }, false);
    const verdict = validateAssignee("agent-ceo", { ...ctx, seats: new Set(["agent-ceo"]) });
    expect(verdict.ok).toBe(false);
  });

  it("ASSIGNS an ordinary name while degraded rather than failing", async () => {
    const ctx = await loadAssigneeContext(() => {
      throw new Error("GET /agents -> 404");
    }, false);
    const verdict = validateAssignee("fixture-agent", { ...ctx, seats: SEATS });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) throw new Error("unreachable");
    expect(verdict.assignee).toBe("fixture-agent");
  });

  it("reports NOT degraded on success — the flag must be able to be false", async () => {
    // Without this, every assertion above would also hold if `degraded` were
    // hardcoded true.
    const ctx = await loadAssigneeContext(() => [{ id: "01d4cc12", name: "fabricius" }], false);
    expect(ctx.degraded).toBe(false);
    expect(ctx.agents).toHaveLength(1);
  });
});

describe("loadAssigneeContext — caching", () => {
  it("does not refetch inside the TTL", async () => {
    let calls = 0;
    const list = () => {
      calls += 1;
      return [{ id: "aa11bb22", name: "laelia" }];
    };
    await loadAssigneeContext(list, false, 1_000);
    await loadAssigneeContext(list, false, 5_000);
    expect(calls).toBe(1);
  });

  it("refetches once the TTL has elapsed", async () => {
    let calls = 0;
    const list = () => {
      calls += 1;
      return [{ id: "aa11bb22", name: "laelia" }];
    };
    await loadAssigneeContext(list, false, 1_000);
    await loadAssigneeContext(list, false, 1_000 + 15_000);
    expect(calls).toBe(2);
  });

  it("carries allowSeat per call rather than caching it", async () => {
    const list = () => [{ id: "aa11bb22", name: "laelia" }];
    const first = await loadAssigneeContext(list, true, 1_000);
    const second = await loadAssigneeContext(list, false, 2_000);
    expect(first.allowSeat).toBe(true);
    expect(second.allowSeat).toBe(false);
  });
});
