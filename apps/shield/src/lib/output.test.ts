import { describe, expect, test } from "bun:test";
import {
  compactFinding,
  compactListResult,
  parseLimitOption,
  shortId,
  truncateText,
} from "./output.js";
import { ScannerType, Severity, type Finding } from "../types/index.js";

describe("compact output helpers", () => {
  test("truncates long text and collapses whitespace", () => {
    expect(truncateText("one\n\n two   three", 20)).toBe("one two three");
    expect(truncateText("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefg...");
  });

  test("shortens ids without changing short values", () => {
    expect(shortId("1234567890abcdef")).toBe("12345678");
    expect(shortId("abc")).toBe("abc");
  });

  test("validates and caps limit options", () => {
    expect(parseLimitOption(undefined, "limit", 20)).toBe(20);
    expect(parseLimitOption("5", "limit", 20)).toBe(5);
    expect(parseLimitOption("999", "limit", 20, 200)).toBe(200);
    expect(() => parseLimitOption("-1", "limit", 20)).toThrow("Invalid limit");
  });

  test("creates compact finding rows without snippets or explanations", () => {
    const finding: Finding = {
      id: "finding-123456789",
      scan_id: "scan-1",
      rule_id: "rule",
      scanner_type: ScannerType.Secrets,
      severity: Severity.High,
      file: "src/app.ts",
      line: 12,
      column: 3,
      end_line: null,
      message: "A".repeat(180),
      code_snippet: "const token = 'secret'",
      fingerprint: "fingerprint-1",
      suppressed: false,
      suppressed_reason: null,
      llm_explanation: "long explanation",
      llm_fix: null,
      llm_exploitability: null,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const row = compactFinding(finding);

    expect(row).toEqual({
      id: "finding-",
      severity: Severity.High,
      scanner: ScannerType.Secrets,
      location: "src/app.ts:12:3",
      message: `${"A".repeat(117)}...`,
    });
  });

  test("adds pagination metadata and hints for hidden rows", () => {
    const result = compactListResult([1, 2, 3], {
      limit: 2,
      offset: 10,
      map: (item) => ({ item }),
      detailHint: "show details",
      verboseHint: "use verbose",
    });

    expect(result).toEqual({
      items: [{ item: 1 }, { item: 2 }],
      count: 3,
      shown: 2,
      offset: 10,
      limit: 2,
      truncated: true,
      next_offset: 12,
      hint: "1 more returned item(s) hidden. use verbose",
    });
  });
});
