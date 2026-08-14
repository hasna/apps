import { describe, expect, test } from "bun:test";
import { scanFile } from "./secrets.js";
import { Severity } from "../types/index.js";

describe("secrets scanner env assignments", () => {
  test("detects unquoted generic API keys in env-style assignments", () => {
    const keyName = "API" + "_KEY";
    const keyValue = "abc123".repeat(4);
    const findings = scanFile(".env", `${keyName}=${keyValue}\n`);

    const finding = findings.find((f) => f.rule_id === "generic-api-key");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe(Severity.High);
  });

  test("does not treat code identifiers as unquoted secret values", () => {
    const content = "const headers = { apiKey: API_KEY_FROM_ENV };";
    const findings = scanFile("headers.ts", content);

    const genericFindings = findings.filter((f) => f.rule_id === "generic-api-key");
    expect(genericFindings).toHaveLength(0);
  });
});
