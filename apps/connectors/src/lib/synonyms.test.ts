import { describe, test, expect } from "bun:test";
import { expandQuery } from "./synonyms.js";

describe("expandQuery", () => {
  test("expands email to smtp/mail synonyms", () => {
    const { expanded } = expandQuery(["email"]);
    expect(expanded).toContain("smtp");
    expect(expanded).toContain("mail");
  });

  test("expands payment to billing/commerce", () => {
    const { expanded } = expandQuery(["payment"]);
    expect(expanded).toContain("billing");
    expect(expanded).toContain("commerce");
  });

  test("reverse lookup: smtp expands to email", () => {
    const { expanded } = expandQuery(["smtp"]);
    expect(expanded).toContain("email");
  });

  test("does not include original tokens in expanded", () => {
    const { original, expanded } = expandQuery(["email"]);
    expect(original).toEqual(["email"]);
    for (const e of expanded) {
      expect(original).not.toContain(e);
    }
  });

  test("unknown token returns no expansions", () => {
    const { expanded } = expandQuery(["xyznonexistent"]);
    expect(expanded).toEqual([]);
  });

  test("multiple tokens each expand independently", () => {
    const { expanded } = expandQuery(["email", "ai"]);
    expect(expanded).toContain("smtp");
    expect(expanded).toContain("llm");
  });

  test("deduplicates across tokens", () => {
    const { expanded } = expandQuery(["ai", "llm"]); // both map to each other
    // Should not have duplicates
    const unique = [...new Set(expanded)];
    expect(expanded.length).toBe(unique.length);
  });
});
