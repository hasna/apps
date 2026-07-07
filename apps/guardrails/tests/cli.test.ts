import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../src/cli/index";

const output: string[] = [];
const errors: string[] = [];
const originalLog = console.log;
const originalError = console.error;

async function captureCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: string | number | undefined }> {
  output.length = 0;
  errors.length = 0;
  process.exitCode = undefined;
  console.log = (value?: unknown) => {
    output.push(String(value ?? ""));
  };
  console.error = (value?: unknown) => {
    errors.push(String(value ?? ""));
  };
  await runCli(args);
  return { stdout: output.join("\n"), stderr: errors.join("\n"), exitCode: process.exitCode };
}

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  process.exitCode = undefined;
});

describe("CLI output disclosure", () => {
  test("evaluate defaults to compact output with detail hints", async () => {
    const result = await captureCli(["evaluate", "--input", "examples/requests/secret-redaction.json"]);

    expect(result.exitCode).toBeUndefined();
    expect(result.stdout.split("\n").length).toBeLessThanOrEqual(5);
    expect(result.stdout).toContain("REDACT redact");
    expect(result.stdout).toContain("2 redactions");
    expect(result.stdout).toContain("use --verbose or guardrails inspect");
    expect(result.stdout).not.toContain("originalSha256");
  });

  test("evaluate --verbose discloses sectioned details without full JSON", async () => {
    const result = await captureCli(["evaluate", "--input", "examples/requests/secret-redaction.json", "--verbose"]);

    expect(result.stdout).toContain("matched policies: showing 1 of 1");
    expect(result.stdout).toContain("redactions: showing 2 of 2");
    expect(result.stdout).toContain("sha256=");
    expect(result.stdout).not.toContain("\"matchedPolicies\"");
  });

  test("inspect is a verbose detail path and supports limit/cursor", async () => {
    const result = await captureCli([
      "inspect",
      "--input",
      "examples/requests/secret-redaction.json",
      "--limit",
      "1",
      "--cursor",
      "1",
    ]);

    expect(result.stdout).toContain("redactions: showing 1 of 2 from 1");
    expect(result.stdout).not.toContain("matched policies: showing 0");
    expect(result.stdout).not.toContain("evidence: showing 0");
    expect(result.stdout).toContain("json: use --json");
  });

  test("--json remains the full machine-readable decision", async () => {
    const result = await captureCli(["evaluate", "--input", "examples/requests/secret-redaction.json", "--json"]);
    const parsed = JSON.parse(result.stdout);

    expect(parsed.status).toBe("redact");
    expect(parsed.redactions).toHaveLength(2);
    expect(parsed.audit.policySetId).toBe("open-guardrails-starter");
  });

  test("validate --verbose shows policy counts while default stays one line", async () => {
    const compact = await captureCli(["validate", "--policy", "examples/policies/starter.guardrails.json"]);
    const verbose = await captureCli(["validate", "--policy", "examples/policies/starter.guardrails.json", "--verbose"]);

    expect(compact.stdout.split("\n")).toHaveLength(1);
    expect(verbose.stdout).toContain("policies:");
    expect(verbose.stdout).toContain("effects:");
  });
});
