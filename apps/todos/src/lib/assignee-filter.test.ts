import { describe, it, expect } from "bun:test";
import { describeAssigneeFilter, type KnownAgent } from "./assignee-validation.js";

/**
 * Regression coverage for todos task 0cbf512c.
 *
 * `list --assigned <name>` resolves the ref through `resolveAssignedToAliases`
 * (db/database.ts) or `resolveAgentForAssignedFilter` (storage/postgres-adapter.ts).
 * BOTH deliberately degrade an AMBIGUOUS name — one that case-insensitively
 * occupies 2+ agent rows — to literal-only matching, rather than picking one row
 * at random. That choice is correct and is NOT changed here.
 *
 * The defect is that the degradation is SILENT. Both call sites describe it as
 * "same as no match", and it is not: "no match" returns 0 rows and the caller
 * knows, while literal-only returns a POPULATED, PLAUSIBLE, PARTIAL set at rc=0
 * with zero bytes on stderr.
 *
 * MEASURED on the live cloud store, installed @hasna/todos 0.15.6, 2026-08-07:
 *
 *     todos list --assigned 01d4cc12  -> n=190  assigned_to: {fabricius: 182, '01d4cc12': 8}
 *     todos list --assigned 4d77b218  -> n=182  assigned_to: {fabricius: 182}
 *     todos list --assigned fabricius -> n=182  assigned_to: {fabricius: 182}
 *     todos list --assigned Fabricius -> n=182  assigned_to: {fabricius: 182}
 *     stderr on every one of the above: 0 bytes
 *
 * Eight live rows carry `assigned_to = '01d4cc12'` — a raw agent id written by
 * `--assign <uuid>` — and are invisible to `--assigned fabricius`, the query
 * that seat actually runs. `fabricius` is ambiguous (`fabricius` 01d4cc12 +
 * `Fabricius` 4d77b218), so the resolver returns literal-only and the id-stored
 * rows drop out with no signal.
 *
 * The asymmetry this closes, quoting the bug row: "`assign` IS DEFENSIVE ABOUT
 * AMBIGUITY AND `list` IS NOT." `validateAssignee` already REFUSES an ambiguous
 * write with an exact message naming the candidate ids. This is the read-path
 * counterpart, which WARNS instead of refusing — a read must not start failing
 * for scripts that depend on it, and the partial set is still the best available
 * answer; it just has to say so.
 *
 * Bridging the two rows into one identity is a separate identity-model decision
 * and is deliberately NOT attempted here (todos task a37a7137).
 *
 * Pure by design, for the reason stated in assignee-validation.test.ts: a
 * subprocess test previously took this suite from 104s to 227s.
 */

const AGENTS: KnownAgent[] = [
  // The live ambiguous pair, verbatim from `todos agents --json`.
  { id: "01d4cc12", name: "fabricius" },
  { id: "4d77b218", name: "Fabricius" },
  // Unambiguous, for the negative control.
  { id: "4f331a8a", name: "agent-chief-operations" },
  { id: "aa11bb22", name: "laelia" },
];

const ctx = { agents: AGENTS, seats: new Set<string>() };

describe("describeAssigneeFilter — an ambiguous filter announces that it is partial", () => {
  it("reports ambiguity for a name occupying two rows, naming every candidate id", () => {
    const n = describeAssigneeFilter("fabricius", ctx);
    expect(n.kind).toBe("ambiguous");
    if (n.kind !== "ambiguous") throw new Error("unreachable");
    // The ids are what make the warning ACTIONABLE — they are the disambiguated
    // form the caller must re-query with.
    expect(n.candidates.map((a) => a.id).sort()).toEqual(["01d4cc12", "4d77b218"]);
    expect(n.message).toContain("01d4cc12");
    expect(n.message).toContain("4d77b218");
    // The warning must say the result is INCOMPLETE. A message that only says
    // "ambiguous" leaves the reader thinking the rows are merely mislabelled.
    expect(n.message.toLowerCase()).toContain("incomplete");
  });

  it("reports ambiguity regardless of the casing queried, since matching is case-insensitive", () => {
    for (const spelling of ["fabricius", "Fabricius", "FABRICIUS"]) {
      const n = describeAssigneeFilter(spelling, ctx);
      expect(n.kind).toBe("ambiguous");
    }
  });
});

describe("describeAssigneeFilter — NEGATIVE CONTROLS: it must stay silent on correct input", () => {
  it("stays silent for a name that resolves to exactly one agent", () => {
    const n = describeAssigneeFilter("agent-chief-operations", ctx);
    expect(n.kind).toBe("ok");
  });

  it("stays silent when queried by AGENT ID, which is the disambiguated form", () => {
    // This is the case that already returns the COMPLETE set (n=190 live), so
    // warning here would be a false positive on the one query that is correct.
    const n = describeAssigneeFilter("01d4cc12", ctx);
    expect(n.kind).toBe("ok");
  });

  it("stays silent for an unregistered name, whose exact-match behaviour is unchanged", () => {
    // A free-text assignee matches literally and completely; nothing is hidden,
    // so there is nothing to warn about.
    const n = describeAssigneeFilter("zzz-no-such-agent", ctx);
    expect(n.kind).toBe("ok");
  });

  it("stays silent on an empty roster, rather than making a confident false claim", () => {
    // The roster fetch degrades to [] when the cloud read fails
    // (assignee-context.ts). Every name looks unambiguous then, and none of them
    // is knowably ambiguous — so emitting nothing is the only honest option.
    const n = describeAssigneeFilter("fabricius", { agents: [], seats: new Set<string>() });
    expect(n.kind).toBe("ok");
  });

  it("stays silent on an empty ref", () => {
    expect(describeAssigneeFilter("", ctx).kind).toBe("ok");
    expect(describeAssigneeFilter("   ", ctx).kind).toBe("ok");
  });
});
