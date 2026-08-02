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
