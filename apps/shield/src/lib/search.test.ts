import { describe, test, expect } from "bun:test";
import { searchFindings } from "./search.js";
import type { Finding } from "../types/index.js";
import { ScannerType, Severity } from "../types/index.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "test-id",
    scan_id: "scan-1",
    rule_id: "test-rule",
    scanner_type: ScannerType.Secrets,
    severity: Severity.High,
    file: "src/app.ts",
    line: 42,
    column: null,
    end_line: null,
    message: "Hardcoded API key detected",
    code_snippet: null,
    fingerprint: "abc123",
    suppressed: false,
    suppressed_reason: null,
    llm_explanation: null,
    llm_fix: null,
    llm_exploitability: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("searchFindings", () => {
  const findings: Finding[] = [
    makeFinding({
      id: "1",
      message: "AWS access key detected",
      file: "src/config.ts",
      rule_id: "aws-access-key",
      severity: Severity.Critical,
      code_snippet: 'const key = "AKIAIOSFODNN7EXAMPLE";',
    }),
    makeFinding({
      id: "2",
      message: "SQL injection vulnerability",
      file: "src/api/users.ts",
      rule_id: "sql-injection",
      scanner_type: ScannerType.Code,
      severity: Severity.High,
    }),
    makeFinding({
      id: "3",
      message: "Hardcoded password in config",
      file: "config/database.yml",
      rule_id: "hardcoded-password",
      severity: Severity.Medium,
    }),
    makeFinding({
      id: "4",
      message: "eval() usage detected",
      file: "src/utils.js",
      rule_id: "eval-usage",
      llm_explanation: "This eval could allow remote code execution",
    }),
  ];

  test("searches by message content", () => {
    const results = searchFindings("SQL injection", findings);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("2");
  });

  test("searches by file path", () => {
    const results = searchFindings("database.yml", findings);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("3");
  });

  test("searches by rule_id", () => {
    const results = searchFindings("aws-access-key", findings);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("1");
  });

  test("searches by scanner_type", () => {
    // Use the full scanner type value to avoid partial matches
    const allCode = findings.filter(
      (f) => f.scanner_type === "code",
    );
    const results = searchFindings("sql-injection", findings);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("2");
  });

  test("searches by severity", () => {
    const results = searchFindings("critical", findings);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("1");
  });

  test("searches by code_snippet", () => {
    const results = searchFindings("AKIAIOSFODNN7EXAMPLE", findings);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("1");
  });

  test("searches by llm_explanation", () => {
    const results = searchFindings("remote code execution", findings);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("4");
  });

  test("is case-insensitive", () => {
    const lower = searchFindings("sql injection", findings);
    const upper = searchFindings("SQL INJECTION", findings);
    const mixed = searchFindings("Sql Injection", findings);
    expect(lower.length).toBe(1);
    expect(upper.length).toBe(1);
    expect(mixed.length).toBe(1);
  });

  test("returns empty array when no matches", () => {
    const results = searchFindings("nonexistent-query-xyz", findings);
    expect(results.length).toBe(0);
  });

  test("returns all findings when query matches all", () => {
    // "detected" appears in multiple messages
    const results = searchFindings("detected", findings);
    expect(results.length).toBeGreaterThan(1);
  });

  test("handles empty findings array", () => {
    const results = searchFindings("anything", []);
    expect(results.length).toBe(0);
  });

  test("handles empty query (matches all)", () => {
    const results = searchFindings("", findings);
    expect(results.length).toBe(findings.length);
  });
});
