import { describe, expect, test } from "bun:test";

import { parseTagList, resolveBulkTags, resolveTagArgument } from "./bulk-tags.js";

/**
 * `todos bulk` could reassign a plan across many tasks but could not add a tag
 * to them: the actions were done/complete/start/delete/plan/move-plan, and the
 * only tagging verbs (`todos tag` / `todos untag`) take ONE id and ONE tag.
 *
 * That made provenance backfill quadratic in operator effort — one process per
 * task — which is the exact thing the directive-provenance convention needs to
 * be practical. `directive:<knowledge-id>` is worth nothing as a convention if
 * stamping it onto existing work costs one CLI invocation per row.
 *
 * These cover the pure resolution half. The transport gate lives in
 * stage-a.test-adjacent coverage (remote-entrypoint.test.ts).
 */
describe("parseTagList", () => {
  test("splits on commas and trims surrounding whitespace", () => {
    expect(parseTagList("alpha, beta ,gamma")).toEqual(["alpha", "beta", "gamma"]);
  });

  test("drops empty segments rather than producing empty tags", () => {
    // A trailing comma is the common typo; an empty tag is unqueryable and
    // would silently widen every later `--tags` read.
    expect(parseTagList("alpha,,beta,")).toEqual(["alpha", "beta"]);
  });

  test("preserves colon-namespaced tags verbatim", () => {
    // The fleet already stores `repo:`, `gh:`, `class:`, `auto:` tags, and the
    // directive convention adds `directive:<knowledge-id>`. Splitting or
    // slugifying on `:` would silently rewrite the identifier and break the
    // one query the convention exists to serve.
    expect(parseTagList("directive:k_msd4cz8t_ste6f4, gh:hasna/todos")).toEqual([
      "directive:k_msd4cz8t_ste6f4",
      "gh:hasna/todos",
    ]);
  });

  test("de-duplicates within a single argument", () => {
    expect(parseTagList("a,b,a")).toEqual(["a", "b"]);
  });

  test("an absent or blank argument yields no tags", () => {
    expect(parseTagList(undefined)).toEqual([]);
    expect(parseTagList("   ")).toEqual([]);
  });
});

describe("resolveTagArgument", () => {
  /**
   * Reviewer finding (P2): the first cut read `opts.tag ?? opts.tags`, which
   * inverted the precedence used by five other sites in task-commands.ts
   * (`opts.tags || opts.tag`) AND silently discarded the loser:
   *
   *   bulk tag <id> --tag "a" --tags "b"   ->  rc=0, only "a" applied, "b" gone
   *
   * A silently dropped tag argument is the wrong failure mode for a tool whose
   * whole purpose is stamping thousands of rows. Both spellings now have to
   * agree, or the run is refused before any row is touched.
   */
  test("accepts either spelling on its own", () => {
    expect(resolveTagArgument("a,b", undefined)).toEqual({ ok: true, raw: "a,b" });
    expect(resolveTagArgument(undefined, "a,b")).toEqual({ ok: true, raw: "a,b" });
  });

  test("accepts both spellings when they agree", () => {
    expect(resolveTagArgument("a,b", "a,b")).toEqual({ ok: true, raw: "a,b" });
  });

  test("REFUSES both spellings when they differ, instead of dropping one", () => {
    const result = resolveTagArgument("a", "b");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a conflict");
    expect(result.conflict).toEqual({ tag: "a", tags: "b" });
  });

  test("treats an equivalent set written in a different order as agreement", () => {
    // `--tag "a,b" --tags "b,a"` names the same set; refusing that would be
    // pedantry rather than safety.
    expect(resolveTagArgument("a,b", "b,a")).toEqual({ ok: true, raw: "a,b" });
  });

  test("neither spelling yields no raw argument", () => {
    expect(resolveTagArgument(undefined, undefined)).toEqual({ ok: true, raw: undefined });
  });

  test("an empty --tag does not silently fall through to a populated --tags", () => {
    // `??` would have let `--tag=` (empty, but PRESENT) pass through to
    // `--tags`, applying tags the operator did not intend on that flag.
    const result = resolveTagArgument("", "a");
    expect(result.ok).toBe(false);
  });
});

describe("resolveBulkTags", () => {
  test("tag MERGES into existing tags instead of replacing them", () => {
    // `todos update --tags` REPLACES the tag list. If bulk tagging reused that
    // semantic, a provenance backfill would silently destroy every other tag
    // on 3,839 live tasks. Merge is the whole point.
    const result = resolveBulkTags(["bug", "p0"], "tag", ["directive:k_abc"]);
    expect(result.tags).toEqual(["bug", "p0", "directive:k_abc"]);
    expect(result.changed).toBe(true);
  });

  test("tag is idempotent and reports no change when the tag is already present", () => {
    // Backfill is re-run after partial failures; a second pass must not bump
    // the row version or emit a write for rows that already carry the tag.
    const result = resolveBulkTags(["bug", "directive:k_abc"], "tag", ["directive:k_abc"]);
    expect(result.tags).toEqual(["bug", "directive:k_abc"]);
    expect(result.changed).toBe(false);
  });

  test("untag removes only the named tags", () => {
    const result = resolveBulkTags(["bug", "directive:k_abc", "p0"], "untag", ["directive:k_abc"]);
    expect(result.tags).toEqual(["bug", "p0"]);
    expect(result.changed).toBe(true);
  });

  test("untag of an absent tag reports no change", () => {
    const result = resolveBulkTags(["bug"], "untag", ["directive:k_zzz"]);
    expect(result.tags).toEqual(["bug"]);
    expect(result.changed).toBe(false);
  });

  test("handles several tags in one operation", () => {
    const result = resolveBulkTags(["bug"], "tag", ["directive:k_abc", "governance"]);
    expect(result.tags).toEqual(["bug", "directive:k_abc", "governance"]);
    expect(result.changed).toBe(true);
  });

  test("a partially-present tag set still applies the missing ones", () => {
    const result = resolveBulkTags(["bug", "governance"], "tag", ["directive:k_abc", "governance"]);
    expect(result.tags).toEqual(["bug", "governance", "directive:k_abc"]);
    expect(result.changed).toBe(true);
  });

  test("existing tag order is preserved so a backfill produces a minimal diff", () => {
    const result = resolveBulkTags(["z", "a", "m"], "tag", ["directive:k_abc"]);
    expect(result.tags).toEqual(["z", "a", "m", "directive:k_abc"]);
  });

  test("tolerates a missing tag array on the current row", () => {
    // Measured on the production corpus: 1 of 3,336 pending rows carried a
    // null tag list rather than an empty array.
    const result = resolveBulkTags(undefined, "tag", ["directive:k_abc"]);
    expect(result.tags).toEqual(["directive:k_abc"]);
    expect(result.changed).toBe(true);
  });

  test("an empty tag argument never rewrites the row", () => {
    // Negative control: with nothing to apply, both actions must be no-ops.
    expect(resolveBulkTags(["bug"], "tag", [])).toEqual({ tags: ["bug"], changed: false });
    expect(resolveBulkTags(["bug"], "untag", [])).toEqual({ tags: ["bug"], changed: false });
  });
});
