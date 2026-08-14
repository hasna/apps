import { describe, expect, test } from "bun:test";
import { createIncrementalCredentialRedactor } from "../src/redaction.js";

describe("incremental credential redaction", () => {
  test("preserves matcher state across chunks for assignments and fixed token shapes", () => {
    const assignmentKey = ["AWS", "SECRET", "ACCESS", "KEY"].join("_");
    const assignmentValue = "s".repeat(600);
    const credentialPrefix = ["AK", "IA"].join("");
    const credential = `${credentialPrefix}${"A".repeat(16)}`;
    const redactor = createIncrementalCredentialRedactor();
    const output = [
      redactor.push(`${assignmentKey}=${assignmentValue}\n ${credential.slice(0, 8)}`),
      redactor.push(credential.slice(8)),
      redactor.finish(),
    ].join("");

    expect(output).toContain(`${assignmentKey}=[redacted]`);
    expect(output).not.toContain(assignmentValue);
    expect(output).not.toContain(credential);
    expect(output.match(/\[redacted\]/g)).toHaveLength(2);
  });

  test("preserves a below-minimum fixed-token candidate without over-redacting it", () => {
    const credentialPrefix = ["AK", "IA"].join("");
    const candidate = `${credentialPrefix}${"A".repeat(15)}`;
    const redactor = createIncrementalCredentialRedactor();
    const output = [
      redactor.push(candidate.slice(0, 7)),
      redactor.push(candidate.slice(7)),
      redactor.finish(),
    ].join("");

    expect(output).toBe(candidate);
    expect(output).not.toContain("[redacted]");
  });
});
