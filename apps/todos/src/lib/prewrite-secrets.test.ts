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
    // Token families carry their own placeholder ("[REDACTED_GITHUB_TOKEN]"), while
    // key-name matches stay generic ("[REDACTED]"). Redacting a key must not redact
    // the clean value underneath it.
    expect(sanitized).toEqual({
      metadata: { access_token: "[REDACTED]" },
      note: "see [REDACTED_GITHUB_TOKEN]",
      "[REDACTED_GITHUB_TOKEN]": "key text is sanitized too",
    });
    expect(JSON.stringify(sanitized)).not.toContain(FAKE_TOKEN);
  });

  test("redacts the value under a key the sanitizer itself rewrites to NAME=[REDACTED]", () => {
    // sanitizePreWriteText rewrites a "<credential-ish name>=<secret>" key into
    // "<same name>=[REDACTED]". The value beneath is opaque and matches no text pattern, so
    // only key-based redaction can catch it — exempting placeholder-shaped keys too loosely
    // here would emit it in cleartext.
    const awsSecret = ["wJalrXUtnFEMIK7MDENG", "bPxRfiCYzEXAMPLEK"].join("");
    const sanitized = sanitizePreWriteValue({ [`AWS_SECRET_ACCESS_KEY=${awsSecret}`]: awsSecret });

    expect(sanitized).toEqual({ "AWS_SECRET_ACCESS_KEY=[REDACTED]": "[REDACTED]" });
    expect(JSON.stringify(sanitized)).not.toContain(awsSecret);
  });

  test("can block writes when callers opt into fail-closed behavior", () => {
    expect(() => sanitizePreWriteText(`token ${FAKE_TOKEN}`, "verification.output", { mode: "block" }))
      .toThrow(PreWriteSecretError);
  });
});

describe("BUG-0004 regression: dollar amounts and $<digit> sequences survive pre-write sanitization", () => {
  // BUG-0004 (hosted todos, 2026-09-07): POST /v1/tasks create silently stripped
  // `$<digit>` sequences (a $27,658.51 payoff amount and a $300 payment came back
  // empty) while PATCH preserved them — the classic signature of a text pass that
  // treats `$N` in a replacement string as a capture-group reference. This
  // sanitizer is the only transform task title/description pass through on the
  // create AND update lanes, so it must never consume or rewrite currency text.
  const samples = [
    "Pay the $27,658.51 payoff amount",
    "Send $300 payment today",
    "Refund $1 and $12 and $27568",
    "Invoice total $27568.00 due",
    "$300 deposit, $27,658.51 balance, $1 fee",
  ];

  for (const context of ["task.title", "task.description"]) {
    test(`preserves dollar samples verbatim in ${context}`, () => {
      for (const sample of samples) {
        expect(sanitizePreWriteText(sample, context)).toBe(sample);
        expect(scanPreWriteText(sample, context).clean).toBe(true);
      }
    });
  }

  test("does not confuse currency with credential-key redaction placeholders", () => {
    // A task title that quotes a credential-shaped env line is still redacted, but
    // plain money text next to it survives untouched (the credential redactors'
    // `$1=`/`$1 ` replacement strings must never be able to reach currency text).
    const mixed = "Record payout of $27,658.51 for TOKEN=abc12345secret then $300";
    const out = sanitizePreWriteText(mixed, "task.description");
    expect(out).toContain("$27,658.51");
    expect(out).toContain("$300");
    expect(out).toContain("TOKEN=[REDACTED]");
    expect(out).not.toContain("abc12345secret");
  });
});
