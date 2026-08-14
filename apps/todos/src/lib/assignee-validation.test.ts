import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAssignee, loadSeatSlugs, type KnownAgent } from "./assignee-validation.js";

/**
 * Regression coverage for todos task 056f3597.
 *
 * `--assign <name>` was passed through to the store completely unvalidated at
 * every call site. Measured on station01, 2026-08-01, across the 2566 pending
 * tasks in the shared store: of the 493 that carried an assignee, 365 (74%)
 * named a ROSTER SEAT (which owner directive k_ms8qy755_ryetl9 defines as
 * "assigned to nobody"), 44 (9%) named an agent that does not exist at all —
 * including bare task ids, the repo name `iapp-factory`, and the literal
 * string `unassigned` — and 66 (13%) named an agent whose name maps to more
 * than one roster row. Only 18 rows (3.6%) named exactly one real agent.
 *
 * These tests are deliberately PURE: they drive a function over in-memory
 * fixtures rather than spawning the CLI. A subprocess test in this suite was
 * previously measured taking it from 104s/0 failures to 227s with five
 * unrelated failures, so a validator's own coverage must not reintroduce that.
 */

const AGENTS: KnownAgent[] = [
  { id: "01d4cc12", name: "fabricius" },
  { id: "aa11bb22", name: "laelia" },
  // `valeria` genuinely occupies three rows in the live store.
  { id: "13dbf7df", name: "valeria" },
  { id: "31443c8c", name: "valeria" },
  { id: "4dfedfc4", name: "valeria" },
  // A seat is a registered agent in this store — that is the whole defect.
  { id: "63023602", name: "agent-chief-staff" },
];

const SEATS = new Set([
  "agent-ceo",
  "agent-chief-engineering",
  "agent-chief-staff",
  "agent-ea",
]);

const ctx = { agents: AGENTS, seats: SEATS };

describe("validateAssignee — a real person is accepted", () => {
  it("resolves a name that maps to exactly one non-seat agent", () => {
    const v = validateAssignee("fabricius", ctx);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error("unreachable");
    expect(v.assignee).toBe("fabricius");
    expect(v.agentId).toBe("01d4cc12");
  });

  it("treats agent names case-insensitively, as every storage engine does", () => {
    const v = validateAssignee("FABRICIUS", ctx);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error("unreachable");
    expect(v.agentId).toBe("01d4cc12");
  });

  it("accepts an unambiguous agent ID, which is how an ambiguous name is disambiguated", () => {
    const v = validateAssignee("31443c8c", ctx);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error("unreachable");
    // Stored canonically by name so existing readers keep working.
    expect(v.assignee).toBe("valeria");
    expect(v.agentId).toBe("31443c8c");
  });
});

describe("validateAssignee — a seat is nobody", () => {
  it("refuses a roster seat by default", () => {
    const v = validateAssignee("agent-chief-staff", ctx);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reason).toBe("seat");
    // The message must name the escape hatch, or the refusal just blocks work.
    expect(v.message).toContain("--assign-seat");
  });

  it("with NO seatHint supplied, recommends no invocation shape at all — regression for todos 75296282, cycle 0", () => {
    // The original message hardcoded "--assign <value> --assign-seat" into
    // the SHARED validator, which is correct for `add`/`update`/`task
    // upsert` (they take `--assign` as a flag) and WRONG for the standalone
    // `assign <id> <agent>` command, which has no `--assign` flag at all —
    // running the recommended form there gives "unknown option '--assign'".
    // Fixed by moving the invocation shape out of the shared validator and
    // into a per-call-site `seatHint` builder (see the describe block below).
    // With no hint supplied, the message must fall back to naming no
    // invocation shape, so it can never again be verb-wrong by default.
    const v = validateAssignee("agent-chief-staff", ctx);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.message).toContain("--assign-seat");
    expect(v.message).not.toContain("--assign ");
  });

  it("refuses a seat that has no agent row at all — the roster is the authority, not the store", () => {
    // `agent-chief-engineering` is a live seat with NO row in the agents
    // table. A store-only check would call it "unknown"; a prefix check over
    // the store would not see it at all.
    const v = validateAssignee("agent-chief-engineering", ctx);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reason).toBe("seat");
  });

  it("allows a seat when the caller opts in explicitly", () => {
    const v = validateAssignee("agent-chief-staff", { ...ctx, allowSeat: true });
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error("unreachable");
    expect(v.assignee).toBe("agent-chief-staff");
    expect(v.isSeat).toBe(true);
  });

  it("does NOT treat an agent- prefixed name as a seat when the roster does not list it", () => {
    // `agent-1` is prefix-shaped junk, not a seat. Prefix matching is wrong in
    // both directions and this pins the second direction: it must NOT be
    // refused as a seat.
    const v = validateAssignee("agent-1", ctx);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error("unreachable");
    expect(v.isSeat).toBe(false);
    expect(v.warning).toBeDefined();
  });
});

/**
 * PR hasna/todos#162, remediation cycle 1 (pr162-reviewer, NO_GO): the
 * shared seat-refusal message hardcoded `--assign <value> --assign-seat`,
 * which is the working form on `add`/`update`/`task upsert` (they take the
 * assignee via that FLAG) and `error: unknown option '--assign'` on the
 * standalone `assign <id> <agent>` command, which takes it POSITIONALLY and
 * has no `--assign` flag at all. Reproduced live by the reviewer against an
 * isolated store; confirmed here at the unit level for all three shapes, and
 * end-to-end for all four call sites in `src/cli/assign-seat-guard.test.ts`.
 *
 * Each call site now supplies its own `seatHint` builder naming its own real
 * invocation shape (`src/cli/commands/task-commands.ts` for add/update/
 * upsert, `src/cli/commands/query-commands.ts` for the standalone `assign`).
 * These tests pin the two shapes directly against the pure validator, since
 * `seatHint` is exactly the seam that makes that possible without spawning a
 * subprocess for every case.
 */
describe("validateAssignee — seatHint names an invocation the CALLING VERB actually accepts", () => {
  it("flag-shaped verbs (add / update / task upsert): --assign <value> --assign-seat", () => {
    const flagHint = (v: string) => `--assign ${v} --assign-seat`;
    const v = validateAssignee("agent-chief-staff", { ...ctx, seatHint: flagHint });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.message).toContain("--assign agent-chief-staff --assign-seat");
  });

  it("the positional `assign <id> <agent>` verb: NO --assign flag, just the two positionals plus --assign-seat", () => {
    // This is the exact shape query-commands.ts's `assign` action supplies.
    // It must never contain the string "--assign " (the flag token with its
    // trailing space) — only the bare "--assign-seat" boolean.
    const positionalHint = (v: string) => `9c2f1a3e ${v} --assign-seat`;
    const v = validateAssignee("agent-chief-staff", { ...ctx, seatHint: positionalHint });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.message).toContain("9c2f1a3e agent-chief-staff --assign-seat");
    expect(v.message).not.toContain("--assign ");
  });

  it("a hint that gets the flag wrong is exactly the regression this guards against", () => {
    // Pinning the FAILURE mode, not only the fix: if a future call site wired
    // the flag-shaped hint into the positional verb by mistake, this is what
    // it would produce, and it is precisely the invocation the reviewer
    // proved `assign` rejects with "unknown option '--assign'". This test
    // exists so that mistake is visible in a diff, not only in a live probe.
    const wrongHintForPositionalVerb = (v: string) => `--assign ${v} --assign-seat`;
    const v = validateAssignee("agent-chief-staff", { ...ctx, seatHint: wrongHintForPositionalVerb });
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    // The validator itself is verb-agnostic — it renders whatever hint it is
    // given. Confirming the FLAG-shaped hint is never wired to `assign` is an
    // end-to-end concern, covered by assign-seat-guard.test.ts's "argv sanity"
    // test below, which extracts the message's own hint and spawns the real
    // `assign` verb with it.
    expect(v.message).toContain("--assign agent-chief-staff --assign-seat");
  });
});

describe("validateAssignee — an unknown assignee warns but is NOT refused", () => {
  it.each([
    ["35d92ce4", "a bare task id"],
    ["iapp-factory", "a repo name"],
    ["unassigned", "the literal string 'unassigned'"],
    ["zzz-definitely-not-an-agent-9f3a", "outright garbage"],
  ])("warns on %s (%s) and still assigns", (name) => {
    const v = validateAssignee(name, ctx);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error("unreachable");
    expect(v.warning).toContain("registered yet");
    expect(v.assignee).toBe(name);
  });

  it("stays silent for an agent that IS registered — the warning must be able to not fire", () => {
    // Without this, the warning above is a check that cannot fail.
    const v = validateAssignee("fabricius", ctx);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error("unreachable");
    expect(v.warning).toBeUndefined();
  });

  it("preserves the pre-registration contract that `todos add --assign brutus` relies on", () => {
    // src/cli/creator-attribution.test.ts asserts exitCode 0 for exactly this
    // against a store where brutus has never registered. Refusing it broke 9
    // existing tests; this pins the decision so it is not "tightened" back.
    const v = validateAssignee("brutus", { agents: [], seats: SEATS });
    expect(v.ok).toBe(true);
  });
});

describe("validateAssignee — an ambiguous name is refused, not silently guessed", () => {
  it("refuses a name that maps to more than one agent and names the candidates", () => {
    const v = validateAssignee("valeria", ctx);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error("unreachable");
    expect(v.reason).toBe("ambiguous");
    expect(v.candidates?.map((c) => c.id).sort()).toEqual(["13dbf7df", "31443c8c", "4dfedfc4"]);
    // Picking the first row is exactly how a task lands on a stranger.
    expect(v.message).toContain("13dbf7df");
  });
});

describe("loadSeatSlugs — degrades gracefully rather than blocking assignment", () => {
  it("reads the slugs out of an @hasna/identities AgentRoster file", () => {
    const dir = mkdtempSync(join(tmpdir(), "todos-roster-"));
    try {
      const file = join(dir, "roster.json");
      writeFileSync(
        file,
        JSON.stringify({ name: "hasna-seats", agents: [{ slug: "agent-ceo" }, { slug: "agent-ea" }] }),
      );
      expect([...loadSeatSlugs(file)].sort()).toEqual(["agent-ceo", "agent-ea"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty set when the roster is absent, so cloud and e2b runs still assign", () => {
    // The roster is a station-local file. Throwing here would break every
    // sandboxed run, which is a worse failure than the one being fixed.
    expect(loadSeatSlugs(join(tmpdir(), "todos-roster-does-not-exist-9f3a", "roster.json")).size).toBe(0);
  });

  it("returns an empty set on a malformed roster rather than throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "todos-roster-bad-"));
    try {
      const file = join(dir, "roster.json");
      writeFileSync(file, "{ not json");
      expect(loadSeatSlugs(file).size).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
