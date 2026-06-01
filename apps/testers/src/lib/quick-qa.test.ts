import { describe, expect, test } from "bun:test";
import type { HealthScanSummary } from "./health-scan.js";
import type { SmokeResult } from "./smoke.js";
import {
  buildQuickQaResult,
  formatQuickQaReport,
  getQuickQaExitCode,
  normalizeQuickQaWcagLevel,
  resolveQuickQaSelection,
} from "./quick-qa.js";

function health(overrides: Partial<HealthScanSummary> = {}): HealthScanSummary {
  return {
    url: "https://app.example.com",
    scannedAt: "2026-06-01T00:00:00.000Z",
    durationMs: 120,
    totalIssues: 0,
    newIssues: 0,
    regressedIssues: 0,
    existingIssues: 0,
    results: [],
    ...overrides,
  };
}

function smoke(overrides: Partial<SmokeResult> = {}): SmokeResult {
  return {
    run: { url: "https://app.example.com", model: "quick" },
    result: { status: "passed", durationMs: 300, tokensUsed: 0 },
    pagesVisited: 3,
    issuesFound: [],
    ...overrides,
  } as SmokeResult;
}

describe("quick-qa orchestration", () => {
  test("resolves skip aliases and accessibility selection", () => {
    const selection = resolveQuickQaSelection({
      skip: ["perf", "smoke"],
      includeA11y: true,
    });

    expect(selection.scanners).toEqual(["console", "network", "links", "a11y"]);
    expect(selection.includeSmoke).toBe(false);
    expect(selection.skipped).toContain("performance");
    expect(selection.skipped).toContain("smoke");
  });

  test("rejects unknown quick-qa checks", () => {
    expect(() => resolveQuickQaSelection({ skip: ["screenshots"] })).toThrow("Unknown quick-qa check");
  });

  test("normalizes WCAG level option values", () => {
    expect(normalizeQuickQaWcagLevel(undefined)).toBe("AA");
    expect(normalizeQuickQaWcagLevel(true)).toBe("AA");
    expect(normalizeQuickQaWcagLevel("aaa")).toBe("AAA");
    expect(() => normalizeQuickQaWcagLevel("best")).toThrow("Invalid WCAG level");
  });

  test("fails when the health scan finds new or regressed issues", () => {
    const result = buildQuickQaResult({
      url: "https://app.example.com",
      health: health({ totalIssues: 2, newIssues: 1, regressedIssues: 1 }),
      smoke: smoke(),
      durationMs: 500,
    });

    expect(result.status).toBe("failed");
    expect(result.issueCounts.actionable).toBe(2);
    expect(getQuickQaExitCode(result)).toBe(1);
  });

  test("fails when smoke reports high severity issues even if health is clean", () => {
    const result = buildQuickQaResult({
      url: "https://app.example.com",
      health: health(),
      smoke: smoke({
        issuesFound: [{
          type: "js-error",
          severity: "high",
          description: "Checkout button throws",
          url: "https://app.example.com/checkout",
        }],
      }),
      durationMs: 500,
    });

    expect(result.status).toBe("failed");
    expect(result.issueCounts.actionable).toBe(1);
    expect(getQuickQaExitCode(result)).toBe(1);
  });

  test("warns without failing for known health issues and low smoke findings", () => {
    const result = buildQuickQaResult({
      url: "https://app.example.com",
      health: health({ totalIssues: 1, existingIssues: 1 }),
      smoke: smoke({
        issuesFound: [{
          type: "visual",
          severity: "low",
          description: "Minor spacing issue",
          url: "https://app.example.com/settings",
        }],
      }),
      durationMs: 500,
    });

    expect(result.status).toBe("warn");
    expect(result.issueCounts.actionable).toBe(0);
    expect(getQuickQaExitCode(result)).toBe(0);
    expect(formatQuickQaReport(result)).toContain("Quick QA Report");
  });
});
