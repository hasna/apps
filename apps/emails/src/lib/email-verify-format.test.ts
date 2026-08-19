// Agent-authored test-gap addition (SOL consult route was capacity-limited).
//
// formatVerifyResult renders the verify-email CLI's human output. It is pure
// formatting, but the interesting contract is the SMTP check column: it must
// render ONLY when the result carries an smtp value (MX-only verification is
// a different answer from MX+SMTP verification, and a CLI that prints
// "SMTP: undefined" has lied about its method). The boolean-to-glyph mapping
// must also stay consistent with the validity verdict.

import { describe, expect, it } from "bun:test";
import { formatVerifyResult, type VerifyResult } from "./email-verify-format.js";

function result(overrides: Partial<VerifyResult>): VerifyResult {
  return {
    email: "ada@example.com",
    valid: true,
    reason: "MX records found for example.com",
    checks: { format: true, mx: true },
    ...overrides,
  };
}

describe("formatVerifyResult", () => {
  it("renders a valid result with the check glyphs", () => {
    const out = formatVerifyResult(result({ checks: { format: true, mx: true, smtp: true } }));
    expect(out).toContain("✓ ada@example.com: valid");
    expect(out).toContain("Format: ✓");
    expect(out).toContain("MX: ✓");
    expect(out).toContain("SMTP: ✓");
  });

  it("renders an invalid result with the cross glyphs", () => {
    const out = formatVerifyResult(
      result({
        valid: false,
        reason: "Invalid email format",
        checks: { format: false, mx: false },
      }),
    );
    expect(out).toContain("✗ ada@example.com: invalid");
    expect(out).toContain("Format: ✗");
    expect(out).toContain("MX: ✗");
  });

  it("omits the SMTP column entirely when smtp is undefined", () => {
    const out = formatVerifyResult(result({ checks: { format: true, mx: true } }));
    expect(out).not.toContain("SMTP:");
    expect(out).toContain("Format: ✓");
    expect(out).toContain("MX: ✓");
  });

  it("renders smtp:false as a cross, distinct from the MX-only case", () => {
    const out = formatVerifyResult(result({ checks: { format: true, mx: true, smtp: false } }));
    expect(out).toContain("SMTP: ✗");
  });

  it("keeps the reason line on every render", () => {
    const out = formatVerifyResult(result({ reason: "No MX records for domain example.com" }));
    expect(out).toContain("Reason: No MX records for domain example.com");
  });
});
