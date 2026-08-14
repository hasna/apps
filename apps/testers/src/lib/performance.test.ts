import { describe, test, expect } from "bun:test";
import { checkBudget, formatPerformanceResult, DEFAULT_BUDGET } from "./performance.js";
import type { PerformanceResult, WebVitals } from "./performance.js";

describe("performance testing (OPE9-00264)", () => {
  describe("checkBudget", () => {
    test("returns no violations when under budget", () => {
      const vitals: WebVitals = {
        lcp: 1500, cls: 0.05, ttfb: 200, fcp: 1000, tbt: 100, tti: 2000, domContentLoaded: 800, loadComplete: 3000, fid: null,
      };
      const violations = checkBudget(vitals, DEFAULT_BUDGET);
      expect(violations).toHaveLength(0);
    });

    test("returns violation when over budget", () => {
      const vitals: WebVitals = {
        lcp: 5000, cls: 0.05, ttfb: 200, fcp: 1000, tbt: 100, tti: 2000, domContentLoaded: 800, loadComplete: 3000, fid: null,
      };
      const violations = checkBudget(vitals, DEFAULT_BUDGET);
      expect(violations).toHaveLength(1);
      expect(violations[0].metric).toBe("lcp");
      expect(violations[0].actual).toBe(5000);
      expect(violations[0].budget).toBe(2500);
    });

    test("returns multiple violations", () => {
      const vitals: WebVitals = {
        lcp: 5000, cls: 0.5, ttfb: 1000, fcp: 1000, tbt: 500, tti: 5000, domContentLoaded: 800, loadComplete: 3000, fid: null,
      };
      const violations = checkBudget(vitals, DEFAULT_BUDGET);
      expect(violations.length).toBeGreaterThan(1);
    });

    test("ignores null values", () => {
      const vitals: WebVitals = {
        lcp: null, cls: null, ttfb: null, fcp: null, tbt: null, tti: null, domContentLoaded: null, loadComplete: null, fid: null,
      };
      const violations = checkBudget(vitals, DEFAULT_BUDGET);
      expect(violations).toHaveLength(0);
    });
  });

  describe("formatPerformanceResult", () => {
    test("formats passing results", () => {
      const result: PerformanceResult = {
        vitals: { lcp: 1500, cls: 0.05, ttfb: 200, fcp: 1000, tbt: 100, tti: 2000, domContentLoaded: 800, loadComplete: 3000, fid: null },
        budgetViolations: [],
        url: "http://test.example",
        timestamp: "",
        pass: true,
      };
      const formatted = formatPerformanceResult(result);
      expect(formatted).toContain("Performance Report");
      expect(formatted).toContain("All performance budgets passed");
    });

    test("formats budget violations", () => {
      const result: PerformanceResult = {
        vitals: { lcp: 5000, cls: 0.05, ttfb: 200, fcp: 1000, tbt: 100, tti: 2000, domContentLoaded: 800, loadComplete: 3000, fid: null },
        budgetViolations: [{ metric: "lcp", actual: 5000, budget: 2500, unit: "ms" }],
        url: "http://test.example",
        timestamp: "",
        pass: false,
      };
      const formatted = formatPerformanceResult(result);
      expect(formatted).toContain("Budget Violations");
      expect(formatted).toContain("lcp: 5000ms (budget: 2500ms)");
    });
  });

  describe("DEFAULT_BUDGET", () => {
    test("has all core web vital thresholds", () => {
      expect(DEFAULT_BUDGET.lcp).toBe(2500);
      expect(DEFAULT_BUDGET.cls).toBe(0.1);
      expect(DEFAULT_BUDGET.ttfb).toBe(800);
    });
  });
});
