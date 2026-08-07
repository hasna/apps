import { describe, expect, test } from "bun:test";
import { MAX_REDACTED_LOG_BYTES, redactLogText } from "./redact-log-lines.mjs";

describe("ECS log evidence redaction", () => {
  test("redacts credential-shaped values and preserves migration evidence", () => {
    const result = redactLogText([
      "DATABASE_URL=postgresql://service:password@example.test/projects?sslmode=require",
      "Authorization: Bearer header.payload.signature",
      "HASNA_PROJECTS_API_SIGNING_KEY=top-secret-value",
      "projects-serve fatal: Applied migration 'projects:0002_tenants' (checksum 'sha256:abc123') is not recognized.",
    ].join("\n"));

    expect(result).not.toContain("service:password");
    expect(result).not.toContain("header.payload.signature");
    expect(result).not.toContain("top-secret-value");
    expect(result).toContain("DATABASE_URL=[REDACTED]");
    expect(result).toContain("Bearer [REDACTED]");
    expect(result).toContain("projects:0002_tenants");
    expect(result).toContain("sha256:abc123");
  });

  test("bounds rendered evidence", () => {
    const result = redactLogText("x".repeat(MAX_REDACTED_LOG_BYTES + 1024));
    expect(Buffer.byteLength(result)).toBeLessThan(MAX_REDACTED_LOG_BYTES + 100);
    expect(result).toContain(`[TRUNCATED at ${MAX_REDACTED_LOG_BYTES} bytes]`);
  });
});
