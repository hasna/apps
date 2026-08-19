/**
 * Two-sided fixtures for safe-read.
 *
 * FOUR MECHANISMS, EACH WITH BOTH ARMS. A one-sided test passes whichever way round
 * the condition is installed, which is the failure this whole module exists to
 * refuse — so a fixture set that only exercised the happy path would be this defect
 * inside its own fix.
 *
 *   mechanism 1  CUT SHORT          truncated -> REFUSE   | untruncated -> PASS
 *   mechanism 2  FAILED-AS-EMPTY    error     -> REFUSE   | genuine empty -> PASS
 *   mechanism 3  UNPAGINATED        capped    -> REFUSE   | provably whole -> PASS
 *   mechanism 4  PREDICATE IGNORED  inert     -> REFUSE   | discriminating -> PASS
 *
 * FIXTURE HYGIENE. Every fake surface here is a pure in-memory function. Nothing
 * spawns a process and nothing writes to a path, so a copied fixture cannot land
 * output in a real log directory; the one test that does touch the filesystem uses
 * the OS temp dir via mkdtemp and removes it. See "fixtures write nowhere" below,
 * which asserts that property rather than leaving it to inspection.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRead, locateRows, readDottedPath, type CapturedRead } from "../src/safe-read";
import { KNOWN_CLAMPS, lookupClamp, runCaptured, safeRead } from "../src/safe-read-exec";
import { runSafeReadCli } from "../src/cli/read";

const ok = (stdout: string, stderr = ""): CapturedRead => ({ stdout, stderr, code: 0 });
const SENSITIVE_OUTPUT_SENTINEL = "FAKE-SENSITIVE-STDERR-SENTINEL";

/** A fake surface: maps an argv to a captured read. Spawns nothing, writes nothing. */
function surface(handler: (argv: string[]) => CapturedRead) {
  const calls: string[][] = [];
  return {
    calls,
    run: (argv: string[]) => {
      calls.push([...argv]);
      return handler(argv);
    }
  };
}

function flagValue(argv: string[], flag: string): number | undefined {
  const at = argv.indexOf(flag);
  return at >= 0 && at + 1 < argv.length ? Number(argv[at + 1]) : undefined;
}

// ---------------------------------------------------------------------------
// MECHANISM 1 — CUT SHORT
// ---------------------------------------------------------------------------
describe("mechanism 1: cut short", () => {
  test("KNOWN-BAD: a stderr-only truncation notice is refused (the repos shape)", () => {
    // Measured live 2026-08-11: `repos repos --json` returns 50 rows at rc=0 with a
    // clean body; the notice appears only on stderr. A checker reading stdout alone
    // passes this, which is why the helper captures both streams.
    const verdict = classifyRead(
      ok(
        JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ id: i }))),
        "warning: showing 50 of 1793 repo(s) (offset 0, limit 50). Pass -n 1793 or page with --cursor 50 to see the rest.\n"
      )
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("stderr_truncation_notice");
    expect(verdict.rows).toEqual([]);
  });

  test("KNOWN-GOOD: the same body with a clean stderr and a satisfied total passes", () => {
    const verdict = classifyRead(
      ok(JSON.stringify({ total: 50, rows: Array.from({ length: 50 }, (_, i) => ({ id: i })) }), "")
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.proofs).toContain("declared_total_satisfied");
    expect(verdict.rowCount).toBe(50);
  });

  test("KNOWN-BAD: rows short of a declared total is refused", () => {
    const verdict = classifyRead(ok(JSON.stringify({ total: 1524, rows: [{ id: 1 }, { id: 2 }] })));
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("declared_total_mismatch");
  });

  test("KNOWN-BAD: rows above, negative, fractional, or non-numeric declared totals are refused", () => {
    for (const payload of [
      { total: 1, rows: [1, 2] },
      { total: -1, rows: [] },
      { total: 1.5, rows: [1, 2] },
      { total: "2", rows: [1, 2] }
    ]) {
      const verdict = classifyRead(ok(JSON.stringify(payload)));
      expect(verdict.ok).toBe(false);
      expect(verdict.code).toBe("declared_total_mismatch");
    }
  });

  test("KNOWN-BAD: has_more=true is refused; KNOWN-GOOD: has_more=false passes", () => {
    const bad = classifyRead(ok(JSON.stringify({ rows: [1, 2], has_more: true, next_cursor: "c1" })));
    expect(bad.ok).toBe(false);
    expect(bad.code).toBe("unfollowed_cursor");

    const good = classifyRead(ok(JSON.stringify({ rows: [1, 2], has_more: false, next_cursor: null })));
    expect(good.ok).toBe(true);
    expect(good.proofs).toContain("cursor_exhausted");
  });

  test("KNOWN-BAD: has_more=true without a usable string or safe-integer cursor is refused", () => {
    for (const nextCursor of [undefined, null, "", "   ", 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const verdict = classifyRead(
        ok(JSON.stringify({ rows: [1, 2], has_more: true, next_cursor: nextCursor }))
      );
      expect(verdict.ok).toBe(false);
      expect(verdict.code).toBe("unfollowed_cursor");
      expect(verdict.nextCursor).toBe(nextCursor === null ? null : undefined);
    }
  });

  test("snake_case null is explicit, while an absent snake key falls back to camelCase", () => {
    const explicitNull = classifyRead(
      ok(JSON.stringify({ rows: [1, 2], has_more: false, next_cursor: null, nextCursor: "wrong-page" }))
    );
    expect(explicitNull.ok).toBe(true);
    expect(explicitNull.nextCursor).toBeNull();
    expect(explicitNull.proofs).toContain("cursor_exhausted");

    const snakeAbsent = classifyRead(
      ok(JSON.stringify({ rows: [1, 2], has_more: true, nextCursor: "camel-page" }))
    );
    expect(snakeAbsent.ok).toBe(false);
    expect(snakeAbsent.code).toBe("unfollowed_cursor");
    expect(snakeAbsent.nextCursor).toBe("camel-page");
  });

  test("total_available is a declared population total with both mismatch and satisfaction arms", () => {
    const mismatch = classifyRead(ok(JSON.stringify({ total_available: 3, rows: [1, 2] })));
    expect(mismatch.ok).toBe(false);
    expect(mismatch.code).toBe("declared_total_mismatch");
    expect(mismatch.declaredTotal).toBe(3);

    const satisfied = classifyRead(ok(JSON.stringify({ total_available: 2, rows: [1, 2] })));
    expect(satisfied.ok).toBe(true);
    expect(satisfied.declaredTotal).toBe(2);
    expect(satisfied.proofs).toContain("declared_total_satisfied");
  });
});

// ---------------------------------------------------------------------------
// MECHANISM 2 — FAILED-AS-EMPTY
// ---------------------------------------------------------------------------
describe("mechanism 2: failed-as-empty", () => {
  test("KNOWN-BAD: {ok:false} on stdout at rc=1 is refused, not degraded to []", () => {
    // The shape that ran the fleet knowledge monitor blind for ~11.6h.
    const verdict = classifyRead({ stdout: JSON.stringify({ ok: false, error: "store unreachable" }), stderr: "", code: 1 });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("nonzero_exit");
    expect(verdict.rows).toEqual([]);
    expect(verdict.rowCount).toBe(0);
  });

  test("REGRESSION: a nonzero child exit reports metadata without reproducing stderr", () => {
    const verdict = classifyRead({ stdout: "", stderr: SENSITIVE_OUTPUT_SENTINEL, code: 1 });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("nonzero_exit");
    expect(verdict.reason).toContain("exited 1");
    expect(verdict.reason).toContain(`Captured stderr was ${SENSITIVE_OUTPUT_SENTINEL.length} byte(s)`);
    expect(`${verdict.reason}\n${verdict.evidence.join("\n")}`).not.toContain(SENSITIVE_OUTPUT_SENTINEL);
  });

  test("KNOWN-BAD: an error object at rc=0 is still refused", () => {
    const verdict = classifyRead(ok(JSON.stringify({ ok: false, error: 'Project not found: "iproj-ads-ops"' })));
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("error_object");
    expect(verdict.reason).not.toContain("iproj-ads-ops");
  });

  test("REGRESSION: an error-object payload is never copied into refusal output", () => {
    const verdict = classifyRead(ok(JSON.stringify({ ok: false, error: SENSITIVE_OUTPUT_SENTINEL })));
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("error_object");
    expect(`${verdict.reason}\n${verdict.evidence.join("\n")}`).not.toContain(SENSITIVE_OUTPUT_SENTINEL);
  });

  test("KNOWN-BAD: store_exists=false is refused even with a well-formed empty list", () => {
    const verdict = classifyRead(ok(JSON.stringify({ ok: true, store_exists: false, total: 0, rows: [] })));
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("store_unavailable");
  });

  test("KNOWN-BAD: unparseable stdout is refused rather than read as zero rows", () => {
    const verdict = classifyRead(ok('{"rows":[1,2'));
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("unparseable_stdout");
  });

  test("KNOWN-BAD: a missing rows key refuses instead of reporting zero", () => {
    const verdict = classifyRead(ok(JSON.stringify({ ok: true, total: 3, payload: { nested: true } })));
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("rows_key_missing");
  });

  test("KNOWN-GOOD: a genuinely empty set with a declared total of 0 passes", () => {
    const verdict = classifyRead(ok(JSON.stringify({ ok: true, store_exists: true, total: 0, rows: [] })), {
      allowEmpty: true
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.rowCount).toBe(0);
    expect(verdict.proofs).toContain("declared_total_satisfied");
  });
});

// ---------------------------------------------------------------------------
// MECHANISM 3 — UNPAGINATED
// ---------------------------------------------------------------------------
describe("mechanism 3: unpaginated", () => {
  test("KNOWN-BAD: a complete-looking first page with no marker is refused", () => {
    // rc=0, valid JSON, clean stderr, no has_more, no total. Nothing in this payload
    // is wrong and nothing in it proves the read is whole.
    const verdict = classifyRead(ok(JSON.stringify(Array.from({ length: 20 }, (_, i) => i))), { limit: 20 });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("page_cap_reached");
  });

  test("KNOWN-BAD: probe-guard's blind spot — 50 rows, no marker, is not a pass here", () => {
    const verdict = classifyRead(ok(JSON.stringify(Array.from({ length: 50 }, (_, i) => i))));
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("completeness_unproven");
  });

  test("KNOWN-GOOD: widening below the bound proves completeness", () => {
    const s = surface((argv) => {
      const limit = flagValue(argv, "--limit") ?? 20;
      return ok(JSON.stringify(Array.from({ length: Math.min(37, limit) }, (_, i) => i)));
    });
    const result = safeRead({ argv: ["fake", "list", "--json"], limit: 20, limitFlag: "--limit", run: s.run });
    expect(result.ok).toBe(true);
    expect(result.proofs).toContain("stable_under_widening");
    expect(result.rowCount).toBe(37);
  });

  test("KNOWN-BAD: a HIDDEN CLAMP defeats widening and must be refused", () => {
    // knowledge k_mso1r678_fhgm1o: `conversations read` silently returns 500 for any
    // request above 500. Widening 200 -> 800 yields 500 rows, which is below 800 —
    // so `count < bound` would wrongly read as complete. Two-step widening cannot
    // rescue it either: a true population of 500 and a cap of 500 are identical
    // under every bound. The clamp census is what makes this refusable.
    const s = surface((argv) => {
      const limit = flagValue(argv, "--limit") ?? 20;
      const served = Math.min(limit, 500); // the silent clamp
      return ok(JSON.stringify(Array.from({ length: served }, (_, i) => i)));
    });
    const result = safeRead({
      argv: ["conversations", "read", "--channel", "board", "--json"],
      limit: 200,
      limitFlag: "--limit",
      widenTo: 800,
      run: s.run
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("hidden_clamp_suspected");
    expect(result.reason).toContain("500");
  });

  test("KNOWN-BAD: an uncensused surface landing on a round number is refused", () => {
    const s = surface((argv) => {
      const limit = flagValue(argv, "--limit") ?? 20;
      return ok(JSON.stringify(Array.from({ length: Math.min(limit, 100) }, (_, i) => i)));
    });
    const result = safeRead({ argv: ["unknowntool", "list"], limit: 50, limitFlag: "--limit", widenTo: 400, run: s.run });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("hidden_clamp_suspected");
  });

  test("KNOWN-GOOD: --known-clamp lets a real population above a round number pass", () => {
    const s = surface((argv) => {
      const limit = flagValue(argv, "--limit") ?? 20;
      return ok(JSON.stringify(Array.from({ length: Math.min(limit, 100) }, (_, i) => i)));
    });
    const result = safeRead({
      argv: ["unknowntool", "list"],
      limit: 50,
      limitFlag: "--limit",
      widenTo: 400,
      knownClamp: 5000,
      run: s.run
    });
    expect(result.ok).toBe(true);
    expect(result.proofs).toContain("stable_under_widening");
    expect(result.rowCount).toBe(100);
  });

  test("KNOWN-GOOD: a cursor is followed to exhaustion and rows accumulate", () => {
    const pages: Record<string, { rows: number[]; next: string | null }> = {
      "": { rows: [1, 2], next: "p2" },
      p2: { rows: [3, 4], next: "p3" },
      p3: { rows: [5], next: null }
    };
    const s = surface((argv) => {
      const at = argv.indexOf("--cursor");
      const key = at >= 0 ? argv[at + 1]! : "";
      const page = pages[key]!;
      return ok(JSON.stringify({ rows: page.rows, has_more: page.next !== null, next_cursor: page.next }));
    });
    const result = safeRead({ argv: ["fake", "digest"], cursorFlag: "--cursor", run: s.run });
    expect(result.ok).toBe(true);
    expect(result.proofs).toContain("cursor_exhausted");
    expect(result.rows).toEqual([1, 2, 3, 4, 5]);
    expect(result.pages).toBe(3);
  });

  test("KNOWN-GOOD: safe-integer cursors are opaque, stringified into argv, and reconciled against total_available", () => {
    const s = surface((argv) => {
      const at = argv.indexOf("--cursor");
      const cursor = at >= 0 ? argv[at + 1] : undefined;
      if (cursor === undefined) {
        return ok(JSON.stringify({ messages: [1, 2], has_more: true, next_cursor: 0, total_available: 3 }));
      }
      expect(cursor).toBe("0");
      // conversations digest applies the cursor before counting total_available,
      // so later pages declare the rows remaining at that cursor, not the first
      // page's original population size.
      return ok(JSON.stringify({ messages: [3], has_more: false, next_cursor: null, total_available: 1 }));
    });

    const result = safeRead({ argv: ["fake", "digest"], cursorFlag: "--cursor", run: s.run });
    expect(result.ok).toBe(true);
    expect(result.proofs).toContain("cursor_exhausted");
    expect(result.rows).toEqual([1, 2, 3]);
    expect(result.rowCount).toBe(3);
    expect(result.pages).toBe(2);
    expect(s.calls).toHaveLength(2);
  });

  test("KNOWN-BAD: exhausted numeric-cursor paging refuses an accumulated total_available mismatch", () => {
    const s = surface((argv) =>
      argv.includes("7")
        ? ok(JSON.stringify({ messages: [3], has_more: false, next_cursor: null, total_available: 4 }))
        : ok(JSON.stringify({ messages: [1, 2], has_more: true, next_cursor: 7, total_available: 4 }))
    );

    const result = safeRead({ argv: ["fake", "digest"], cursorFlag: "--cursor", run: s.run });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("declared_total_mismatch");
    expect(result.reason).toContain("3 row(s)");
    expect(result.reason).toContain("declared total of 4");
    expect(result.pages).toBe(2);
  });

  test("KNOWN-BAD: has_more without a usable cursor is refused, never treated as exhausted", () => {
    for (const nextCursor of [undefined, null, ""]) {
      const s = surface(() => ok(JSON.stringify({ rows: [1, 2], has_more: true, next_cursor: nextCursor })));
      const result = safeRead({ argv: ["fake", "digest"], cursorFlag: "--cursor", run: s.run });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("unfollowed_cursor");
    }
  });

  test("KNOWN-BAD: a non-empty next cursor is followed even when has_more contradicts it", () => {
    const s = surface((argv) =>
      argv.includes("p2")
        ? ok(JSON.stringify({ rows: [3], has_more: false, next_cursor: null }))
        : ok(JSON.stringify({ rows: [1, 2], has_more: false, next_cursor: "p2" }))
    );
    const result = safeRead({ argv: ["fake", "digest"], cursorFlag: "--cursor", run: s.run });
    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([1, 2, 3]);
    expect(result.pages).toBe(2);
  });

  test("KNOWN-BAD: widening cannot turn a failed second read into a successful empty population", () => {
    let calls = 0;
    const s = surface(() =>
      ++calls === 1
        ? ok(JSON.stringify(Array.from({ length: 20 }, (_, i) => i)))
        : ok(JSON.stringify({ ok: true, store_exists: false, rows: [] }))
    );
    const result = safeRead({
      argv: ["fake", "list"],
      limit: 20,
      limitFlag: "--limit",
      widenTo: 80,
      run: s.run
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("store_unavailable");
    expect(result.rows).toEqual([]);
  });

  test("REGRESSION: a failed widening probe reports metadata without reproducing stderr", () => {
    let calls = 0;
    const s = surface(() =>
      ++calls === 1
        ? ok(JSON.stringify(Array.from({ length: 20 }, (_, i) => i)))
        : { stdout: "", stderr: SENSITIVE_OUTPUT_SENTINEL, code: 1 }
    );
    const result = safeRead({
      argv: ["fake", "list"],
      limit: 20,
      limitFlag: "--limit",
      widenTo: 80,
      run: s.run
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("completeness_unproven");
    expect(result.reason).toContain("exited 1");
    expect(result.reason).toContain(`Captured stderr was ${SENSITIVE_OUTPUT_SENTINEL.length} byte(s)`);
    expect(`${result.reason}\n${result.evidence.join("\n")}`).not.toContain(SENSITIVE_OUTPUT_SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// THE ARM THAT MUST NOT FAIL CLOSED — the envelope-less mementos shape
// ---------------------------------------------------------------------------
describe("envelope-less surfaces are not fail-closed", () => {
  test("KNOWN-GOOD: a bare array with NO envelope is proven by a sibling aggregate", () => {
    // `mementos list --json` returns a bare array: no total, no has_more, no
    // store_exists. A guard that fail-closed whenever a total is absent would refuse
    // this surface forever, which is a broken helper rather than a safe one. The
    // aggregate lives on the SIBLING verb `mementos stats --json`.
    const s = surface((argv) => {
      if (argv.includes("stats")) {
        // Note `total` here is by_status.active and EXCLUDES archived — which is why
        // the caller names the path and the helper never guesses one.
        return ok(JSON.stringify({ total: 640, by_status: { active: 640, archived: 41 }, by_scope: { global: 681, shared: 337 } }));
      }
      return ok(JSON.stringify(Array.from({ length: 681 }, (_, i) => ({ key: `m${i}` }))));
    });
    const result = safeRead({
      argv: ["mementos", "list", "--scope", "global", "--json"],
      siblingArgv: ["mementos", "stats", "--json"],
      siblingPath: "by_scope.global",
      run: s.run
    });
    expect(result.ok).toBe(true);
    expect(result.proofs).toEqual(["sibling_aggregate_agrees"]);
    expect(result.rowCount).toBe(681);
  });

  test("KNOWN-BAD: the same bare-array surface is refused when the sibling disagrees", () => {
    const s = surface((argv) =>
      argv.includes("stats")
        ? ok(JSON.stringify({ by_scope: { global: 681 } }))
        : ok(JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ key: `m${i}` }))))
    );
    const result = safeRead({
      argv: ["mementos", "list", "--scope", "global", "--json"],
      siblingArgv: ["mementos", "stats", "--json"],
      siblingPath: "by_scope.global",
      run: s.run
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("declared_total_mismatch");
  });

  test("a bare array is refused with a NAMED, actionable code rather than a generic failure", () => {
    const verdict = classifyRead(ok(JSON.stringify([{ key: "a" }, { key: "b" }])));
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("completeness_unproven");
    expect(verdict.reason).toContain("sibling aggregate");
  });
});

// ---------------------------------------------------------------------------
// MECHANISM 4 — PREDICATE IGNORED
// ---------------------------------------------------------------------------
describe("mechanism 4: predicate silently ignored", () => {
  test("KNOWN-BAD: a query that returns rows for a predicate matching NOTHING is refused", () => {
    // The `gh search issues` shape: identical rows for two different queries, and
    // `org:` ignored outright. Every count taken from such a surface is a count of
    // the wrong population, and no amount of paging repairs it.
    const s = surface(() => ok(JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ id: i })))));
    const result = safeRead({
      argv: ["faketool", "search", "widget"],
      probeNegativeArgs: ["zzz-no-such-token-zzz"],
      run: s.run
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("predicate_ignored");
  });

  test("KNOWN-GOOD: a discriminating query passes both probes", () => {
    const s = surface((argv) => {
      if (argv.includes("zzz-no-such-token-zzz")) return ok("[]");
      if (argv.includes("known-present")) return ok(JSON.stringify([{ id: 1 }, { id: 2 }]));
      return ok(JSON.stringify({ total: 3, rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }));
    });
    const result = safeRead({
      argv: ["faketool", "search", "widget"],
      probeNegativeArgs: ["zzz-no-such-token-zzz"],
      probePositiveArgs: ["known-present"],
      run: s.run
    });
    expect(result.ok).toBe(true);
    expect(result.rowCount).toBe(3);
  });

  test("KNOWN-BAD: a predicate known to match returning zero is refused as inert", () => {
    const s = surface(() => ok("[]"));
    const result = safeRead({
      argv: ["faketool", "search", "widget"],
      probePositiveArgs: ["known-present"],
      run: s.run
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("predicate_inert");
  });
});

// ---------------------------------------------------------------------------
// MECHANISM 5 — DEFAULTED SCOPE
// ---------------------------------------------------------------------------
describe("mechanism 5: defaulted scope", () => {
  test("KNOWN-BAD: a scope-defaulting surface is refused even when every other check is clean", () => {
    // The read is complete, the total is honest, the rows reconcile against it
    // three ways — and it is 41 items short. This is the arm that proves
    // total-reconciliation cannot see a defaulted scope.
    const s = surface(() => ok(JSON.stringify({ total: 1526, rows: Array.from({ length: 1526 }, (_, i) => i) })));
    const result = safeRead({ argv: ["knowledge", "list", "--json"], run: s.run });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("scope_defaulted");
    expect(result.reason).toContain("--include-archived");
    // The surface was never even called: the refusal is cheap and pre-read.
    expect(s.calls.length).toBe(0);
  });

  test("KNOWN-GOOD: passing the widening flag proves the wider scope and stamps it on the result", () => {
    const s = surface(() => ok(JSON.stringify({ total: 1567, rows: Array.from({ length: 1567 }, (_, i) => i) })));
    const result = safeRead({ argv: ["knowledge", "list", "--include-archived", "--json"], run: s.run });
    expect(result.ok).toBe(true);
    expect(result.rowCount).toBe(1567);
    expect(result.scope).toBe("--include-archived");
    expect(result.reason).toContain("scope: --include-archived");
  });

  test("KNOWN-GOOD: the narrow scope is allowed only as an explicit, recorded choice", () => {
    const s = surface(() => ok(JSON.stringify({ total: 1526, rows: Array.from({ length: 1526 }, (_, i) => i) })));
    const result = safeRead({
      argv: ["knowledge", "list", "--json"],
      scopeAck: "active items only, archived deliberately excluded",
      run: s.run
    });
    expect(result.ok).toBe(true);
    expect(result.scope).toContain("acknowledged");
    expect(result.reason).toContain("archived deliberately excluded");
  });

  test("todos --all is censused the same way", () => {
    const s = surface(() => ok(JSON.stringify({ total: 7301, rows: Array.from({ length: 7301 }, (_, i) => i) })));
    const narrow = safeRead({ argv: ["todos", "list", "--json"], run: s.run });
    expect(narrow.ok).toBe(false);
    expect(narrow.code).toBe("scope_defaulted");
    expect(narrow.reason).toContain("--all");
  });

  test("every count carries its scope, including on surfaces with no known widener", () => {
    const s = surface(() => ok(JSON.stringify({ total: 3, rows: [1, 2, 3] })));
    const result = safeRead({ argv: ["faketool", "list"], run: s.run });
    expect(result.ok).toBe(true);
    expect(typeof result.scope).toBe("string");
    expect(result.scope.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The helper's own capture path and CLI surface
// ---------------------------------------------------------------------------
describe("capture path and CLI", () => {
  test("the executor spawns from argv and never through a shell", () => {
    // If this went through a shell, the metacharacters would be interpreted and the
    // argument would not survive intact. It is echoed back verbatim instead.
    const payload = '`whoami` $(id -u) ; rm -rf /tmp/nope';
    const captured = runCaptured(["printf", "%s", payload]);
    expect(captured.code).toBe(0);
    expect(captured.stdout).toBe(payload);
  });

  test("REGRESSION: a payload well past 1 MiB survives the capture path intact", () => {
    // The first implementation used in-memory spawnSync capture and returned a
    // partial, unparseable live payload. The truncation point varied; the 256 MiB
    // option does take effect and the default limit raises ENOBUFS. File descriptors
    // avoid dependence on that bounded, producer-timing-sensitive path.
    const rows = Array.from({ length: 40000 }, (_, i) => ({ id: i, pad: "0123456789abcdef" }));
    const payload = JSON.stringify(rows);
    expect(payload.length).toBeGreaterThan(1024 * 1024);
    // The payload goes through a temp FILE rather than an argv element: Linux caps a
    // single argument at MAX_ARG_STRLEN (128 KiB), so passing it inline would fail
    // the spawn for a reason unrelated to what is under test.
    const dir = mkdtempSync(join(tmpdir(), "safe-read-big-"));
    try {
      const file = join(dir, "big.json");
      writeFileSync(file, payload);
      const captured = runCaptured(["cat", file]);
      expect(captured.code).toBe(0);
      expect(captured.stdout.length).toBe(payload.length);
      const verdict = classifyRead(captured);
      // Parses cleanly — the point is that it is not cut mid-string.
      expect(verdict.code).not.toBe("unparseable_stdout");
      expect(verdict.rowCount).toBe(40000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("REGRESSION: a paced multi-megabyte producer is captured byte-for-byte", () => {
    // A fast `cat` did not kill the in-memory spawnSync mutant. Pacing adds a
    // sustained-output arm, but the producer-timing-sensitive mutant can still
    // pass it; the structural fixture below pins the selected mechanism. The
    // interpreter is the current runtime, not a script in the temporary directory.
    const chunks = 96;
    const chunkBytes = 32 * 1024;
    const producer = [
      'const { writeSync } = require("node:fs");',
      `const chunk = "z".repeat(${chunkBytes});`,
      `for (let i = 0; i < ${chunks}; i += 1) {`,
      "  writeSync(1, chunk);",
      "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);",
      "}"
    ].join("\n");

    const captured = runCaptured([process.execPath, "-e", producer]);
    expect(captured.code).toBe(0);
    expect(captured.stderr).toBe("");
    expect(captured.stdout.length).toBe(chunks * chunkBytes);
    expect(captured.stdout.startsWith("z".repeat(64))).toBe(true);
    expect(captured.stdout.endsWith("z".repeat(64))).toBe(true);
  });

  test("REGRESSION: capture stays file-descriptor based even when memory capture happens to pass", () => {
    // The observed in-memory truncation is producer-timing-sensitive, so a payload
    // fixture alone can let the exact old implementation survive. Pin the selected
    // mechanism as well: the captured streams must be child file descriptors, not
    // spawnSync-managed strings with a maxBuffer ceiling.
    const source = readFileSync(join(import.meta.dir, "../src/safe-read-exec.ts"), "utf8");
    const start = source.indexOf("export function runCaptured");
    const end = source.indexOf("\nfunction withFlag", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).toContain('stdio: ["ignore", outFd, errFd]');
    expect(body).not.toContain('\n    encoding: "utf8",');
    expect(body).not.toContain("\n    maxBuffer:");
  });

  test("stdout and stderr are captured separately and never merged", () => {
    // A merged capture corrupts the JSON with whatever diagnostics the tool emitted,
    // which is how a valid payload becomes an unparseable one.
    const captured = runCaptured(["sh", "-c", 'printf "{\\"rows\\":[]}"; printf "warning: showing 5 of 900" >&2']);
    expect(captured.stdout).toBe('{"rows":[]}');
    expect(captured.stderr).toContain("showing 5 of 900");
    // And the stderr notice is what decides the verdict, not the clean body.
    const verdict = classifyRead(captured);
    expect(verdict.code).toBe("stderr_truncation_notice");
  });

  test("a nonzero exit from the real spawner is surfaced, not swallowed", () => {
    const captured = runCaptured(["false"]);
    expect(captured.code).toBe(1);
    const verdict = classifyRead(captured);
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("nonzero_exit");
  });

  test("CLI returns 2 on refusal and prints NOTHING to stdout", () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runSafeReadCli(["false"], { json: false }, { log: (s) => out.push(s), err: (s) => err.push(s) });
    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain("REFUSED");
  });

  test("CLI --json omits `rows` entirely on refusal so a consumer cannot read a plausible zero", () => {
    const out: string[] = [];
    const code = runSafeReadCli(["false"], { json: true }, { log: (s) => out.push(s), err: () => {} });
    expect(code).toBe(2);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.ok).toBe(false);
    expect(parsed.rows).toBeUndefined();
    expect(parsed.scope).toBe("default");
  });

  test("REGRESSION: human and JSON refusal output never reproduces child stderr or error payloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "safe-read-redaction-"));
    const stderrFixture = join(dir, "stderr-fixture.js");
    const errorObjectFixture = join(dir, "error-object-fixture.js");
    const wideningFixture = join(dir, "widening-fixture.js");
    writeFileSync(stderrFixture, `console.error(${JSON.stringify(SENSITIVE_OUTPUT_SENTINEL)}); process.exit(1);\n`);
    writeFileSync(
      errorObjectFixture,
      `process.stdout.write(JSON.stringify({ok:false,error:${JSON.stringify(SENSITIVE_OUTPUT_SENTINEL)}}));\n`
    );
    writeFileSync(
      wideningFixture,
      `const limitAt = process.argv.indexOf("--limit"); const limit = limitAt >= 0 ? process.argv[limitAt + 1] : undefined;\n` +
        `if (limit === "80") { console.error(${JSON.stringify(SENSITIVE_OUTPUT_SENTINEL)}); process.exit(7); }\n` +
        `process.stdout.write(JSON.stringify(Array.from({length:20},(_,i)=>i)));\n`
    );
    const commands = [
      [process.execPath, stderrFixture],
      [process.execPath, errorObjectFixture]
    ];

    try {
      for (const json of [false, true]) {
        for (const command of commands) {
          const out: string[] = [];
          const err: string[] = [];
          const code = runSafeReadCli(command, { json }, { log: (s) => out.push(s), err: (s) => err.push(s) });
          const rendered = `${out.join("\n")}\n${err.join("\n")}`;
          expect(code).toBe(2);
          expect(rendered).not.toContain(SENSITIVE_OUTPUT_SENTINEL);
          if (command === commands[0]) {
            expect(rendered).toContain("nonzero_exit");
            expect(rendered).toContain("exited 1");
            expect(rendered).toMatch(/Captured stderr was \d+ byte\(s\)/);
          } else {
            expect(rendered).toContain("error_object");
            expect(rendered).toContain("payload content was not rendered");
          }
        }

        const wideningOut: string[] = [];
        const wideningErr: string[] = [];
        const wideningCode = runSafeReadCli(
          [process.execPath, wideningFixture],
          { json, limit: "20", limitFlag: "--limit", widenTo: "80" },
          { log: (s) => wideningOut.push(s), err: (s) => wideningErr.push(s) }
        );
        const wideningRendered = `${wideningOut.join("\n")}\n${wideningErr.join("\n")}`;
        expect(wideningCode).toBe(2);
        expect(wideningRendered).not.toContain(SENSITIVE_OUTPUT_SENTINEL);
        expect(wideningRendered).toContain("completeness_unproven");
        expect(wideningRendered).toContain("widening probe to --limit 80 exited 7");
        expect(wideningRendered).toMatch(/Captured stderr was \d+ byte\(s\)/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("CLI --json carries scope on success", () => {
    const out: string[] = [];
    const code = runSafeReadCli(
      ["bun", "-e", "console.log(JSON.stringify({total:1,rows:[{id:1}]}))"],
      { json: true },
      { log: (s) => out.push(s), err: () => {} }
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.ok).toBe(true);
    expect(parsed.scope).toBe("default");
  });

  test("CLI returns 3 for usage, distinct from 2 for a fired guard", () => {
    const code = runSafeReadCli([], { json: false }, { log: () => {}, err: () => {} });
    expect(code).toBe(3);
  });

  test("--assume-complete records the waiver in the evidence and is never silent", () => {
    const s = surface(() => ok(JSON.stringify([1, 2, 3])));
    const result = safeRead({ argv: ["fake", "list"], assumeComplete: true, run: s.run });
    expect(result.ok).toBe(true);
    expect(result.proofs).toEqual(["assumed_complete"]);
    expect(result.evidence.join(" ")).toContain("WAIVED");
  });
});

// ---------------------------------------------------------------------------
// Supporting units and fixture hygiene
// ---------------------------------------------------------------------------
describe("supporting units", () => {
  test("locateRows never turns a miss into an empty list", () => {
    expect(locateRows({ nope: 1 }).ok).toBe(false);
    expect(locateRows({ rows: [1] }).ok).toBe(true);
    expect(locateRows([1, 2]).ok).toBe(true);
  });

  test("`count` is not auto-detected as a total (it is a page size on todos)", () => {
    const verdict = classifyRead(ok(JSON.stringify({ count: 100, rows: Array.from({ length: 100 }, (_, i) => i) })), {
      limit: 100
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.declaredTotal).toBeUndefined();
  });

  test("readDottedPath reaches a nested aggregate and returns undefined for a miss", () => {
    expect(readDottedPath({ by_scope: { global: 681 } }, "by_scope.global")).toBe(681);
    expect(readDottedPath({ by_scope: { global: 681 } }, "by_scope.shared")).toBeUndefined();
  });

  test("the clamp census resolves the longest matching verb prefix", () => {
    expect(lookupClamp(["conversations", "agents", "list", "--json"])?.cap).toBe(500);
    expect(lookupClamp(["conversations", "read", "--channel", "x"])?.cap).toBe(500);
    expect(lookupClamp(["totally", "unknown"])).toBeNull();
    for (const [key, entry] of Object.entries(KNOWN_CLAMPS)) {
      expect(entry.grade === "M" || entry.grade === "S/U").toBe(true);
      expect(key.length).toBeGreaterThan(0);
    }
  });

  test("fixtures write nowhere: the only filesystem use is an OS temp dir", () => {
    // Guards the trap that a copied fixture writes into a real log directory. Every
    // other test above is pure in-memory; this one proves the single filesystem
    // interaction is confined to mkdtemp and is cleaned up.
    const dir = mkdtempSync(join(tmpdir(), "safe-read-fixture-"));
    try {
      const file = join(dir, "capture.json");
      writeFileSync(file, JSON.stringify({ total: 1, rows: [{ id: 1 }] }));
      const verdict = classifyRead(ok(readFileSync(file, "utf8")));
      expect(verdict.ok).toBe(true);
      expect(dir.startsWith(tmpdir())).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

afterAll(() => {
  // Nothing global to tear down; asserted here so a future fixture that acquires
  // state has an obvious place to release it.
});
