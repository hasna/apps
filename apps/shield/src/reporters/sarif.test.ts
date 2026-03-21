import { describe, test, expect } from "bun:test";
import { reportFindings } from "./sarif.js";
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
    fingerprint: "abc123def456",
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
  scanner_types: [ScannerType.Secrets],
  findings_count: 1,
  started_at: "2024-01-01T00:00:00.000Z",
  completed_at: "2024-01-01T00:00:01.000Z",
  duration_ms: 1000,
  error: null,
  created_at: "2024-01-01T00:00:00.000Z",
};

describe("SARIF reporter", () => {
  test("outputs valid JSON", () => {
    const output = reportFindings([makeFinding()]);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  test("has SARIF 2.1.0 schema and version", () => {
    const parsed = JSON.parse(reportFindings([makeFinding()]));
    expect(parsed.version).toBe("2.1.0");
    expect(parsed.$schema).toContain("sarif-schema-2.1.0");
  });

  test("has correct tool driver info", () => {
    const parsed = JSON.parse(reportFindings([makeFinding()]));
    const driver = parsed.runs[0].tool.driver;
    expect(driver.name).toBe("open-security");
    expect(driver.version).toBe("0.1.0");
    expect(driver.informationUri).toContain("open-security");
  });

  test("maps findings to SARIF results", () => {
    const findings = [
      makeFinding({ rule_id: "aws-key", message: "AWS key found" }),
      makeFinding({
        id: "2",
        rule_id: "sql-injection",
        message: "SQL injection",
        file: "api.ts",
        severity: Severity.Critical,
      }),
    ];
    const parsed = JSON.parse(reportFindings(findings));
    const results = parsed.runs[0].results;
    expect(results.length).toBe(2);
  });

  test("maps severity to correct SARIF levels", () => {
    const findings = [
      makeFinding({ id: "1", severity: Severity.Critical, file: "a.ts" }),
      makeFinding({ id: "2", severity: Severity.High, file: "b.ts" }),
      makeFinding({ id: "3", severity: Severity.Medium, file: "c.ts" }),
      makeFinding({ id: "4", severity: Severity.Low, file: "d.ts" }),
      makeFinding({ id: "5", severity: Severity.Info, file: "e.ts" }),
    ];
    const parsed = JSON.parse(reportFindings(findings));
    const results = parsed.runs[0].results;

    expect(results[0].level).toBe("error"); // Critical
    expect(results[1].level).toBe("error"); // High
    expect(results[2].level).toBe("warning"); // Medium
    expect(results[3].level).toBe("note"); // Low
    expect(results[4].level).toBe("none"); // Info
  });

  test("includes physical location with file and line", () => {
    const parsed = JSON.parse(reportFindings([makeFinding({ file: "src/app.ts", line: 42 })]));
    const location = parsed.runs[0].results[0].locations[0].physicalLocation;
    expect(location.artifactLocation.uri).toBe("src/app.ts");
    expect(location.region.startLine).toBe(42);
  });

  test("includes column when present", () => {
    const parsed = JSON.parse(reportFindings([makeFinding({ column: 10 })]));
    const region = parsed.runs[0].results[0].locations[0].physicalLocation.region;
    expect(region.startColumn).toBe(10);
  });

  test("omits column when null", () => {
    const parsed = JSON.parse(reportFindings([makeFinding({ column: null })]));
    const region = parsed.runs[0].results[0].locations[0].physicalLocation.region;
    expect(region.startColumn).toBeUndefined();
  });

  test("includes end_line when present", () => {
    const parsed = JSON.parse(reportFindings([makeFinding({ end_line: 50 })]));
    const region = parsed.runs[0].results[0].locations[0].physicalLocation.region;
    expect(region.endLine).toBe(50);
  });

  test("includes fingerprints", () => {
    const parsed = JSON.parse(
      reportFindings([makeFinding({ fingerprint: "abc123def456" })]),
    );
    const result = parsed.runs[0].results[0];
    expect(result.fingerprints["open-security/fingerprint"]).toBe("abc123def456");
  });

  test("deduplicates rules in the driver", () => {
    const findings = [
      makeFinding({ id: "1", rule_id: "same-rule", file: "a.ts" }),
      makeFinding({ id: "2", rule_id: "same-rule", file: "b.ts" }),
      makeFinding({ id: "3", rule_id: "other-rule", file: "c.ts", message: "Other" }),
    ];
    const parsed = JSON.parse(reportFindings(findings));
    const rules = parsed.runs[0].tool.driver.rules;
    expect(rules.length).toBe(2);
  });

  test("includes invocations when scan is provided", () => {
    const parsed = JSON.parse(reportFindings([makeFinding()], mockScan));
    const invocations = parsed.runs[0].invocations;
    expect(invocations).toBeDefined();
    expect(invocations.length).toBe(1);
    expect(invocations[0].executionSuccessful).toBe(true);
    expect(invocations[0].startTimeUtc).toBe("2024-01-01T00:00:00.000Z");
  });

  test("omits invocations when no scan provided", () => {
    const parsed = JSON.parse(reportFindings([makeFinding()]));
    expect(parsed.runs[0].invocations).toBeUndefined();
  });

  test("handles empty findings array", () => {
    const parsed = JSON.parse(reportFindings([]));
    expect(parsed.runs[0].results).toEqual([]);
    expect(parsed.runs[0].tool.driver.rules).toEqual([]);
  });
});
