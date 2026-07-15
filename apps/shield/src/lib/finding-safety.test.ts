import { describe, expect, test } from "bun:test";
import { ScannerType, Severity, type FindingInput } from "../types/index.js";
import {
  isCredentialFinding,
  sanitizeFindingForOutput,
  sanitizeFindingForPersistence,
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
});
