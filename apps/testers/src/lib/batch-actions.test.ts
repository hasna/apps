import { describe, test, expect } from "bun:test";
import { hasBatchFailures, formatBatchResults } from "./batch-actions.js";

describe("batch browser actions (OPE9-00236)", () => {
  describe("hasBatchFailures", () => {
    test("returns false when all actions pass", () => {
      const results = [
        { id: "a", status: "passed" as const, durationMs: 10 },
        { id: "b", status: "passed" as const, durationMs: 20 },
      ];
      expect(hasBatchFailures(results)).toBe(false);
    });

    test("returns true when any action fails", () => {
      const results = [
        { id: "a", status: "passed" as const, durationMs: 10 },
        { id: "b", status: "failed" as const, durationMs: 5, error: "not found" },
      ];
      expect(hasBatchFailures(results)).toBe(true);
    });

    test("returns true for timeout status", () => {
      const results = [
        { id: "a", status: "timeout" as const, durationMs: 5000 },
      ];
      expect(hasBatchFailures(results)).toBe(true);
    });
  });

  describe("formatBatchResults", () => {
    test("formats passing results", () => {
      const results = [
        { id: "fill-name", status: "passed" as const, durationMs: 100 },
        { id: "fill-email", status: "passed" as const, durationMs: 120 },
      ];
      const formatted = formatBatchResults(results);
      expect(formatted).toContain("2/2 passed");
      expect(formatted).toContain("220ms total");
    });

    test("formats failure details", () => {
      const results = [
        { id: "click-btn", status: "passed" as const, durationMs: 50 },
        { id: "click-modal", status: "failed" as const, durationMs: 30, error: "Element not found" },
      ];
      const formatted = formatBatchResults(results);
      expect(formatted).toContain("1/2 passed");
      expect(formatted).toContain("FAIL [click-modal]");
      expect(formatted).toContain("Element not found");
    });

    test("handles empty results", () => {
      const formatted = formatBatchResults([]);
      expect(formatted).toContain("0/0 passed");
    });
  });
});
