import { describe, test, expect } from "bun:test";
import { hasA11yIssues, formatA11yResults } from "./a11y-audit.js";
import type { A11yAuditResult } from "./a11y-audit.js";

describe("accessibility audit (OPE9-00263)", () => {
  describe("hasA11yIssues", () => {
    test("returns false when no violations", () => {
      const result: A11yAuditResult = {
        violations: [],
        passes: [],
        incomplete: [],
        url: "http://test.example",
        timestamp: "",
        totalViolations: 0,
        criticalCount: 0,
        seriousCount: 0,
        moderateCount: 0,
        minorCount: 0,
      };
      expect(hasA11yIssues(result)).toBe(false);
    });

    test("returns true for minor violation", () => {
      const result: A11yAuditResult = {
        violations: [{ id: "color-contrast", impact: "minor", description: "Color contrast", help: "", helpUrl: "", nodes: [] }],
        passes: [],
        incomplete: [],
        url: "http://test.example",
        timestamp: "",
        totalViolations: 1,
        criticalCount: 0,
        seriousCount: 0,
        moderateCount: 0,
        minorCount: 1,
      };
      expect(hasA11yIssues(result)).toBe(true);
    });

    test("returns true for critical violation", () => {
      const result: A11yAuditResult = {
        violations: [{ id: "image-alt", impact: "critical", description: "Images must have alt text", help: "", helpUrl: "", nodes: [] }],
        passes: [],
        incomplete: [],
        url: "http://test.example",
        timestamp: "",
        totalViolations: 1,
        criticalCount: 1,
        seriousCount: 0,
        moderateCount: 0,
        minorCount: 0,
      };
      expect(hasA11yIssues(result)).toBe(true);
    });
  });

  describe("formatA11yResults", () => {
    test("formats passing results", () => {
      const result: A11yAuditResult = {
        violations: [],
        passes: [{ id: "aria-allowed-role", description: "ARIA roles" }],
        incomplete: [],
        url: "http://test.example",
        timestamp: "",
        totalViolations: 0,
        criticalCount: 0,
        seriousCount: 0,
        moderateCount: 0,
        minorCount: 0,
      };
      const formatted = formatA11yResults(result);
      expect(formatted).toContain("0 violation");
      expect(formatted).toContain("Passed checks: 1");
    });

    test("formats violation details", () => {
      const result: A11yAuditResult = {
        violations: [{ id: "image-alt", impact: "critical", description: "Images must have alt text", help: "Add alt attribute", helpUrl: "https://axe.deque.com/image-alt", nodes: [{ html: '<img src="x">', target: ["img"], failureSummary: "Fix: Add alt text" }] }],
        passes: [],
        incomplete: [],
        url: "http://test.example",
        timestamp: "",
        totalViolations: 1,
        criticalCount: 1,
        seriousCount: 0,
        moderateCount: 0,
        minorCount: 0,
      };
      const formatted = formatA11yResults(result);
      expect(formatted).toContain("CRITICAL");
      expect(formatted).toContain("image-alt");
      expect(formatted).toContain("Add alt attribute");
    });

    test("formats incomplete checks", () => {
      const result: A11yAuditResult = {
        violations: [],
        passes: [],
        incomplete: [{ id: "aria-hidden-focus", description: "Needs manual review" }],
        url: "http://test.example",
        timestamp: "",
        totalViolations: 0,
        criticalCount: 0,
        seriousCount: 0,
        moderateCount: 0,
        minorCount: 0,
      };
      const formatted = formatA11yResults(result);
      expect(formatted).toContain("INCOMPLETE CHECKS");
      expect(formatted).toContain("aria-hidden-focus");
    });
  });
});