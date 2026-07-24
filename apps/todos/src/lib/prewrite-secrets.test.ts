import { describe, expect, test } from "bun:test";
import {
  PreWriteSecretError,
  sanitizePreWriteText,
  sanitizePreWriteValue,
  scanPreWriteText,
} from "./prewrite-secrets.js";

const FAKE_TOKEN = ["ghp", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"].join("_");

describe("pre-write secret scanner", () => {
  test("reports deterministic findings without exposing matched values", () => {
    const scan = scanPreWriteText(`token ${FAKE_TOKEN}`, "task.description");

    expect(scan.clean).toBe(false);
    expect(scan.context).toBe("task.description");
    expect(scan.findings.some((finding) => finding.pattern === "github_pat")).toBe(true);
    expect(JSON.stringify(scan)).not.toContain(FAKE_TOKEN);
  });

  test("redacts text and nested values before persistence", () => {
    expect(sanitizePreWriteText(`token ${FAKE_TOKEN}`)).not.toContain(FAKE_TOKEN);
    const sanitized = sanitizePreWriteValue({
      metadata: { access_token: FAKE_TOKEN },
      note: `see ${FAKE_TOKEN}`,
      [FAKE_TOKEN]: "key text is sanitized too",
    });
    expect(sanitized).toEqual({
      metadata: { access_token: "[REDACTED]" },
      note: "see [REDACTED]",
      "[REDACTED]": "key text is sanitized too",
    });
    expect(JSON.stringify(sanitized)).not.toContain(FAKE_TOKEN);
  });

  test("can block writes when callers opt into fail-closed behavior", () => {
    expect(() => sanitizePreWriteText(`token ${FAKE_TOKEN}`, "verification.output", { mode: "block" }))
      .toThrow(PreWriteSecretError);
  });
});
