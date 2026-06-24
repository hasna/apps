import { describe, expect, test } from "bun:test";
import { reportFindings } from "./terminal.js";
import { ScannerType, Severity, type Finding } from "../types/index.js";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding-1",
    scan_id: "scan-1",
    rule_id: "rule-1",
    scanner_type: ScannerType.Secrets,
    severity: Severity.High,
    file: "src/app.ts",
    line: 42,
    column: null,
    end_line: null,
    message: "Hardcoded token detected ".repeat(12),
    code_snippet: "const token = 'secret';",
    fingerprint: "fingerprint-1",
    suppressed: false,
    suppressed_reason: null,
    llm_explanation: "This token can be used to access production.",
    llm_fix: null,
    llm_exploitability: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function captureLogs(fn: () => void): string {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

describe("terminal reporter compact output", () => {
  test("limits findings and hides bulky details by default", () => {
    const output = captureLogs(() => {
      reportFindings([
        makeFinding({ id: "finding-1" }),
        makeFinding({ id: "finding-2", file: "src/other.ts", severity: Severity.Medium }),
      ], { limit: 1 });
    });

    expect(output).toContain("Security Findings (showing 1/2)");
    expect(output).toContain("1 more finding(s) hidden");
    expect(output).toContain("Use --verbose");
    expect(output).not.toContain("const token = 'secret';");
    expect(output).not.toContain("access production");
  });

  test("shows snippets and explanations in verbose mode", () => {
    const output = captureLogs(() => {
      reportFindings([makeFinding()], { verbose: true });
    });

    expect(output).toContain("Security Findings (showing 1/1)");
    expect(output).toContain("const token = 'secret';");
    expect(output).toContain("access production");
  });
});
