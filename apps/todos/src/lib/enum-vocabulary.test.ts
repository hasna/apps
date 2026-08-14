import { describe, expect, it } from "bun:test";
import { collapseEnumValues, resolveEnumVocabulary, suggestVocabularyMatches } from "./enum-vocabulary.js";
import { TASK_PRIORITIES, TASK_STATUSES } from "../types/index.js";

const statusSpec = {
  name: "--status",
  vocabulary: TASK_STATUSES,
  normalize: (value: string) => value.toLowerCase().trim(),
} as const;

describe("resolveEnumVocabulary", () => {
  it("accepts every member of the vocabulary it is given", () => {
    for (const status of TASK_STATUSES) {
      expect(resolveEnumVocabulary(status, statusSpec)).toEqual({ ok: true, values: [status] });
    }
  });

  it("rejects a value outside the vocabulary instead of passing it through", () => {
    const result = resolveEnumVocabulary("open", statusSpec);
    expect(result.ok).toBe(false);
  });

  it("names every allowed value in the rejection message, sourced from the constant", () => {
    const result = resolveEnumVocabulary("totally_bogus_value", statusSpec);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    for (const status of TASK_STATUSES) expect(result.message).toContain(status);
  });

  it("validates every element of a comma-separated list, not just the first", () => {
    const result = resolveEnumVocabulary("pending,bogus,in_progress", statusSpec);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.invalid).toEqual(["bogus"]);
  });

  it("accepts a fully valid comma-separated list and de-duplicates it", () => {
    expect(resolveEnumVocabulary("pending, in_progress ,pending", statusSpec))
      .toEqual({ ok: true, values: ["pending", "in_progress"] });
  });

  it("rejects a comma list when the flag takes a single value", () => {
    const result = resolveEnumVocabulary("pending,completed", { ...statusSpec, allowList: false });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.invalid).toEqual(["pending,completed"]);
  });

  it("applies the caller's normalizer before the membership check", () => {
    expect(resolveEnumVocabulary(" PENDING ", statusSpec)).toEqual({ ok: true, values: ["pending"] });
  });

  it("leaves a value the normalizer does not recognise invalid rather than rewriting it", () => {
    const result = resolveEnumVocabulary("Opened", statusSpec);
    expect(result.ok).toBe(false);
  });

  it("attaches the caller's remediation hint for a plausible non-member", () => {
    const result = resolveEnumVocabulary("all", {
      ...statusSpec,
      hints: { all: "Use -a/--all instead." },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.message).toContain("Use -a/--all instead.");
  });

  it("rejects an empty value with the allowed list", () => {
    const result = resolveEnumVocabulary("  ", statusSpec);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.message).toContain("pending");
  });

  /**
   * A blank element used to be dropped by the `length > 0` filter, so `pending,`
   * and `high,,critical` were accepted as if the operator had typed a clean list.
   * That is the same silent-acceptance this module exists to remove — the doctrine
   * above is that ONE bad element fails the whole value rather than being dropped,
   * and an empty element is a bad element. A shell that expands `--status
   * "$STATUS,$EXTRA"` with `$EXTRA` unset produces exactly this shape.
   */
  it("rejects a trailing comma instead of silently dropping the blank element", () => {
    const result = resolveEnumVocabulary("pending,", statusSpec);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.message).toContain("pending");
  });

  it("rejects a doubled comma instead of silently dropping the blank element", () => {
    const result = resolveEnumVocabulary("pending,,in_progress", statusSpec);
    expect(result.ok).toBe(false);
  });

  it("rejects a leading comma", () => {
    expect(resolveEnumVocabulary(",pending", statusSpec).ok).toBe(false);
  });

  it("rejects a whitespace-only element between commas", () => {
    expect(resolveEnumVocabulary("pending,   ,completed", statusSpec).ok).toBe(false);
  });

  /**
   * The discriminating control. Tightening blank handling must not cost the
   * surrounding-whitespace tolerance the accept-side test above relies on, or the
   * fix would break `--status "pending, in_progress"` — a shape operators type.
   */
  it("still accepts a list whose elements merely carry surrounding whitespace", () => {
    expect(resolveEnumVocabulary(" pending , in_progress ", statusSpec))
      .toEqual({ ok: true, values: ["pending", "in_progress"] });
  });

  it("validates priorities from TASK_PRIORITIES with the same helper", () => {
    const prioritySpec = {
      name: "--priority",
      vocabulary: TASK_PRIORITIES,
      normalize: (value: string) => value.toLowerCase().trim(),
    } as const;
    expect(resolveEnumVocabulary("critical", prioritySpec)).toEqual({ ok: true, values: ["critical"] });
    expect(resolveEnumVocabulary("crit1cal", prioritySpec).ok).toBe(false);
  });
});

describe("suggestVocabularyMatches", () => {
  it("suggests the intended member for a typo", () => {
    expect(suggestVocabularyMatches("pendign", TASK_STATUSES)).toContain("pending");
  });

  it("suggests a member for a prefix", () => {
    expect(suggestVocabularyMatches("cancel", TASK_STATUSES)).toContain("cancelled");
  });

  it("offers nothing rather than a misleading guess for an unrelated word", () => {
    expect(suggestVocabularyMatches("zzzzzzzzzz", TASK_STATUSES)).toEqual([]);
  });
});

describe("collapseEnumValues", () => {
  it("keeps a single value a bare string so the emitted filter shape is unchanged", () => {
    expect(collapseEnumValues(["pending"])).toBe("pending");
  });

  it("keeps a real list an array", () => {
    expect(collapseEnumValues(["pending", "in_progress"])).toEqual(["pending", "in_progress"]);
  });
});
