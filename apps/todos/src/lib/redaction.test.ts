import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfig, saveConfig } from "./config.js";
import { listSecretFindings, redactEvidenceText, redactValue } from "./redaction.js";

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env["HOME"];
  home = mkdtempSync(join(tmpdir(), "todos-redaction-home-"));
  process.env["HOME"] = home;
  resetConfig();
});

afterEach(() => {
  if (previousHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = previousHome;
  resetConfig();
  rmSync(home, { recursive: true, force: true });
});

describe("local secret redaction", () => {
  test("applies configurable local redaction patterns and key names", () => {
    saveConfig({
      secret_safety: {
        redaction_patterns: ["INTERNAL-[0-9]{4}", "client-secret-[a-z0-9]+"],
        redaction_keys: ["license"],
      },
    });

    expect(redactEvidenceText("id INTERNAL-1234 and client-secret-abc123")).toBe("id [REDACTED] and [REDACTED]");
    expect(redactValue({ license: "should-not-export", note: "INTERNAL-9999" })).toEqual({
      license: "[REDACTED]",
      note: "[REDACTED]",
    });
  });

  test("reports deterministic secret findings without exposing values", () => {
    saveConfig({ secret_safety: { redaction_patterns: ["TEAM-[A-Z]{3}-[0-9]{3}"] } });

    const findings = listSecretFindings("TEAM-ABC-123\nOPENAI_API_KEY=sk-testsecret123456789");

    expect(findings).toEqual([
      { pattern: "custom:TEAM-[A-Z]{3}-[0-9]{3}", count: 1 },
      { pattern: "openai-token", count: 1 },
      { pattern: "env-secret-assignment", count: 1 },
    ]);
    expect(JSON.stringify(findings)).not.toContain("TEAM-ABC-123");
    expect(JSON.stringify(findings)).not.toContain("sk-testsecret");
  });
});
