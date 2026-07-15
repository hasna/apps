import { describe, expect, test } from "bun:test";
import { ScanStatus, ScannerType, Severity, type Finding, type FindingInput, type Scan } from "../types/index.js";
import {
  isCredentialFinding,
  sanitizeFindingForOutput,
  sanitizeFindingForPersistence,
  sanitizeScanForOutput,
  sanitizeTextForBoundary,
} from "./finding-safety.js";

function finding(overrides: Partial<FindingInput> = {}): FindingInput {
  return {
    rule_id: "code-rule",
    scanner_type: ScannerType.Code,
    severity: Severity.High,
    file: "src/app.ts",
    line: 1,
    message: "Unsafe code path",
    ...overrides,
  };
}

describe("finding safety", () => {
  test("classifies credential findings by scanner and semantic rule name", () => {
    expect(isCredentialFinding(finding({ scanner_type: ScannerType.Secrets }))).toBe(true);
    expect(isCredentialFinding(finding({ rule_id: "hardcoded-password" }))).toBe(true);
    expect(isCredentialFinding(finding())).toBe(false);
  });

  test("redacts credential persistence and every output snippet", () => {
    const syntheticSecret = "ghp_" + "SYNTHETICONLYABCDEFGHIJKLMNOPQRSTUVWXYZ12";
    const credential = finding({
      scanner_type: ScannerType.Secrets,
      rule_id: "github-token",
      message: `GitHub token detected: ${syntheticSecret}`,
      code_snippet: `GITHUB_TOKEN=${syntheticSecret}`,
    });

    const persisted = sanitizeFindingForPersistence(credential);
    const output = sanitizeFindingForOutput(credential);

    expect(JSON.stringify(persisted)).not.toContain(syntheticSecret);
    expect(JSON.stringify(output)).not.toContain(syntheticSecret);
    expect(persisted.code_snippet).toBe("[REDACTED]");
    expect(output.message).toContain("Potential credential exposure");
  });

  test("caps and control-cleans non-sensitive output fields", () => {
    const output = sanitizeFindingForOutput(finding({
      file: `src/${"a".repeat(700)}\nsecret.ts`,
      message: `Unsafe\u0000code ${"x".repeat(700)}`,
      code_snippet: "raw source text",
    }));

    expect(output.file.length).toBeLessThanOrEqual(512);
    expect(output.message.length).toBeLessThanOrEqual(512);
    expect(output.file).not.toContain("\n");
    expect(output.message).not.toContain("\u0000");
    expect(output.code_snippet).toBe("[REDACTED]");
  });

  test("redacts credential values in non-credential context and metadata", () => {
    const syntheticSecret = "sk_test_" + "SYNTHETICONLY0123456789";
    const input = finding({
      rule_id: `unsafe-${syntheticSecret}`,
      file: `src/${syntheticSecret}/app.ts`,
      message: `Unsafe code next to api_key=${syntheticSecret}`,
    });
    const persisted = sanitizeFindingForPersistence(input);
    const output = sanitizeFindingForOutput(input);

    for (const serialized of [JSON.stringify(persisted), JSON.stringify(output)]) {
      expect(serialized).not.toContain(syntheticSecret);
      expect(serialized).toContain("REDACTED");
    }
    expect(persisted.rule_id).toMatch(/^\[REDACTED-RULE:[a-f0-9]{12}\]$/);
    expect(persisted.file).toMatch(/^\[REDACTED-LOCATION:[a-f0-9]{12}\]$/);
  });

  test("sanitizes arbitrary adjacent context independent of finding classification", () => {
    const syntheticSecret = "ghp_" + "SYNTHETICONLYABCDEFGHIJKLMNOPQRSTUVWXYZ12";
    const sanitized = sanitizeTextForBoundary(`ordinary config issue; adjacent=${syntheticSecret}`, 12_000);
    expect(sanitized).not.toContain(syntheticSecret);
    expect(sanitized).toContain("[REDACTED]");
  });

  test("sanitizes every exported finding and scan string recursively", () => {
    const syntheticCredential = `gh${"o"}_${"G_".repeat(18)}`;
    const unsafeFinding = {
      ...finding(),
      id: syntheticCredential,
      scan_id: syntheticCredential,
      fingerprint: syntheticCredential,
      suppressed: false,
      suppressed_reason: syntheticCredential,
      llm_explanation: syntheticCredential,
      llm_fix: syntheticCredential,
      llm_exploitability: null,
      created_at: syntheticCredential,
    } as Finding;
    const unsafeScan: Scan = {
      id: syntheticCredential,
      project_id: syntheticCredential,
      status: syntheticCredential as ScanStatus,
      scanner_types: [syntheticCredential as ScannerType],
      findings_count: 1,
      started_at: syntheticCredential,
      completed_at: syntheticCredential,
      duration_ms: 1,
      error: syntheticCredential,
      created_at: syntheticCredential,
    };

    expect(JSON.stringify(sanitizeFindingForOutput(unsafeFinding))).not.toContain(syntheticCredential);
    expect(JSON.stringify(sanitizeScanForOutput(unsafeScan))).not.toContain(syntheticCredential);
  });
});
