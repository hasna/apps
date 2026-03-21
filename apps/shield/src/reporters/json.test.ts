import { describe, test, expect } from "bun:test";
import { reportFindings } from "./json.js";
import type { Finding, Scan } from "../types/index.js";
import { ScannerType, Severity, ScanStatus } from "../types/index.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding-1",
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
    created_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const mockScan: Scan = {
  id: "scan-1",
  project_id: "proj-1",
  status: ScanStatus.Completed,
  scanner_types: [ScannerType.Secrets, ScannerType.Code],
  findings_count: 2,
  started_at: "2024-01-01T00:00:00.000Z",
  completed_at: "2024-01-01T00:00:01.000Z",
  duration_ms: 1000,
  error: null,
  created_at: "2024-01-01T00:00:00.000Z",
};

describe("JSON reporter", () => {
  test("outputs valid JSON", () => {
    const findings = [makeFinding()];
    const output = reportFindings(findings);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  test("includes findings array", () => {
    const findings = [makeFinding(), makeFinding({ id: "finding-2", file: "b.ts" })];
    const parsed = JSON.parse(reportFindings(findings));
    expect(parsed.findings).toBeArray();
    expect(parsed.findings.length).toBe(2);
  });

  test("includes summary with severity counts", () => {
    const findings = [
      makeFinding({ severity: Severity.Critical }),
      makeFinding({ id: "2", severity: Severity.High, file: "b.ts" }),
      makeFinding({ id: "3", severity: Severity.Medium, file: "c.ts" }),
    ];
    const parsed = JSON.parse(reportFindings(findings));
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.critical).toBe(1);
    expect(parsed.summary.high).toBe(1);
    expect(parsed.summary.medium).toBe(1);
    expect(parsed.summary.total_findings).toBe(3);
  });

  test("includes score in summary", () => {
    const findings = [makeFinding({ severity: Severity.High })];
    const parsed = JSON.parse(reportFindings(findings));
    expect(parsed.summary.score).toBe(90); // 100 - 10 for high
  });

  test("handles suppressed findings in score calculation", () => {
    const findings = [
      makeFinding({ severity: Severity.Critical, suppressed: true }),
      makeFinding({ id: "2", severity: Severity.High, file: "b.ts" }),
    ];
    const parsed = JSON.parse(reportFindings(findings));
    expect(parsed.summary.suppressed).toBe(1);
    expect(parsed.summary.critical).toBe(0); // suppressed
    expect(parsed.summary.score).toBe(90);
  });

  test("includes scan info when provided", () => {
    const findings = [makeFinding()];
    const parsed = JSON.parse(reportFindings(findings, mockScan));
    expect(parsed.scan).not.toBeNull();
    expect(parsed.scan.id).toBe("scan-1");
    expect(parsed.scan.status).toBe("completed");
  });

  test("scan is null when not provided", () => {
    const findings = [makeFinding()];
    const parsed = JSON.parse(reportFindings(findings));
    expect(parsed.scan).toBeNull();
  });

  test("handles empty findings array", () => {
    const parsed = JSON.parse(reportFindings([]));
    expect(parsed.findings).toEqual([]);
    expect(parsed.summary.total_findings).toBe(0);
    expect(parsed.summary.score).toBe(100);
  });

  test("preserves all finding fields", () => {
    const finding = makeFinding({
      column: 10,
      end_line: 45,
      code_snippet: "const key = 'secret';",
      llm_explanation: "This is a hardcoded key",
      llm_fix: "Use env vars",
      llm_exploitability: 0.9,
    });
    const parsed = JSON.parse(reportFindings([finding]));
    const f = parsed.findings[0];
    expect(f.column).toBe(10);
    expect(f.end_line).toBe(45);
    expect(f.code_snippet).toBe("const key = 'secret';");
    expect(f.llm_explanation).toBe("This is a hardcoded key");
    expect(f.llm_fix).toBe("Use env vars");
    expect(f.llm_exploitability).toBe(0.9);
  });
});
