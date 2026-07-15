import { afterEach, describe, expect, test } from "bun:test";
import { ScannerType, Severity, type Finding } from "../types/index.js";
import { reportFindings } from "./terminal.js";

const originalLog = console.log;

afterEach(() => {
  console.log = originalLog;
});

describe("terminal reporter safety", () => {
  test("never prints secret finding snippets or analysis text", () => {
    const syntheticSecret = "ghp_" + "SYNTHETICONLYABCDEFGHIJKLMNOPQRSTUVWXYZ12";
    const output: string[] = [];
    console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));

    const finding: Finding = {
      id: "finding-1",
      scan_id: "scan-1",
      rule_id: "github-token",
      scanner_type: ScannerType.Secrets,
      severity: Severity.Critical,
      file: "synthetic.env",
      line: 1,
      column: 1,
      end_line: null,
      message: `GitHub token detected: ${syntheticSecret}`,
      code_snippet: `GITHUB_TOKEN=${syntheticSecret}`,
      fingerprint: "synthetic-fingerprint",
      suppressed: false,
      suppressed_reason: null,
      llm_explanation: `Credential ${syntheticSecret} is exposed`,
      llm_fix: null,
      llm_exploitability: null,
      created_at: "2026-07-15T00:00:00.000Z",
    };

    reportFindings([finding]);

    const rendered = output.join("\n");
    expect(rendered).not.toContain(syntheticSecret);
    expect(rendered).toContain("[REDACTED]");
  });
});
